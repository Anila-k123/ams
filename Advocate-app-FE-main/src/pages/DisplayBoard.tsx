// Court Display Board: where each court hall has reached in its list, read live
// from the court scraper through /api/workspace/display-board. Each forum is an
// accordion that loads its board the first time it is opened, then refreshes
// itself while open. Halls holding one of your matters are highlighted.
import { useState, useEffect, useCallback, useRef } from "react";
import api from "../api/client";
import { Icon, Chip, PageHead, Skel } from "../ui/kit";
import { Segmented } from "../ui/forms";
import "../ui/pages/court.css";

// Fallback list until the courts endpoint responds.
const FALLBACK_COURTS: any[] = [
  { value: "delhi", label: "Delhi High Court" },
  { value: "chennai", label: "Madras High Court" },
  { value: "madurai", label: "Madras High Court at Madurai" },
  { value: "kochi", label: "Kerala High Court" },
];
// An open board refreshes itself this often, so "now at item" stays current.
const POLL_MS = 2 * 60 * 1000;

function formatFetchedAt(iso: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}
const fmtBoardDate = (s: string) => {
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

// The Supreme Court's own site splits its board into "Regular Court" and
// "Video Conferencing" toggles (same hearings), so the scraper exposes them as
// two court ids (sci / sci_vc). Collapse them into one entry for the accordion.
function mergeSciCourts(list: any[]) {
  let inserted = false;
  return list.reduce((acc: any[], c) => {
    if (c.value === "sci" || c.value === "sci_vc") {
      if (!inserted) {
        acc.push({
          value: "sci",
          label: "Supreme Court of India",
          note: "Regular Court and Video Conferencing listings, shown together.",
        });
        inserted = true;
      }
      return acc;
    }
    acc.push(c);
    return acc;
  }, []);
}

// Merge two boards' rows by courtroom number, preferring whichever side has
// an actual case listed for that room.
function mergeSciRows(rowsA: any[] = [], rowsB: any[] = []) {
  const byNumber = new Map();
  const order: any[] = [];
  for (const r of [...rowsA, ...rowsB]) {
    const existing = byNumber.get(r.courtNumber);
    if (!existing) order.push(r.courtNumber);
    if (!existing || (r.status === "listed" && existing.status !== "listed")) {
      byNumber.set(r.courtNumber, r);
    }
  }
  return order.map((cn) => byNumber.get(cn));
}

// Fetches several underlying bench court ids in parallel; a failed fetch for
// one bench resolves to null. Used only for SCI's Regular/VC toggle merge.
async function fetchBenches(benchValues: string[]) {
  const results = await Promise.allSettled(
    benchValues.map((v) => api.get("/api/workspace/display-board", { params: { bench: v } }))
  );
  return results.map((r) => (r.status === "fulfilled" ? r.value.data : null));
}

// How far a hall is from your item: numbers when both parse, else null.
const gapOf = (r: any) => {
  const a = parseInt(r.itemNumber, 10), b = parseInt(r.yourItem, 10);
  return Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
};
const isOver = (r: any) => r.status === "list_over" || r.status === "no_case";

// One catalog entry per possible board field. The table shows a column whenever
// any row in the loaded board populates it. Never hardcode a court's column set.
const FIELD_CATALOG: { key: string; label: string; hideSm?: boolean; has: (r: any) => boolean; render: (r: any) => any }[] = [
  { key: "itemNumber", label: "Now at item", has: (r) => !!r.itemNumber, render: (r) => <span className="pp-now-item">{r.itemNumber}</span> },
  // Where YOUR case sits in this courtroom's list today, from the stored cause list.
  {
    key: "yourItem", label: "Your item", has: (r) => !!r.yourItem,
    render: (r) => {
      const gap = gapOf(r);
      const hot = gap != null && gap >= 0 && gap <= 5 && !isOver(r);
      return (
        <span className="nowrap">
          <span className={`mono${hot ? " pp-yours-hot" : ""}`}>{r.yourItem}</span>{" "}
          {hot ? <span className="xs pp-yours-hot">Coming up</span>
            : gap != null && gap < 0 ? <span className="faint xs">Passed</span>
            : gap != null ? <span className="faint xs">{gap} to go</span> : null}
        </span>
      );
    },
  },
  { key: "listType", label: "List", hideSm: true, has: (r) => !!r.listType, render: (r) => r.listType },
  { key: "caseString", label: "Case no.", has: (r) => !!r.caseString, render: (r) => <span className="mono small">{r.caseString}</span> },
  { key: "title", label: "Title", hideSm: true, has: (r) => !!r.title, render: (r) => r.title },
  {
    key: "judges", label: "Judge(s)", hideSm: true,
    has: (r) => !!(r.judge || (r.judges && r.judges.length)),
    render: (r) => <span className="small">{r.judges && r.judges.length ? r.judges.map((j: string, k: number) => <div key={k}>{j}</div>) : r.judge || "—"}</span>,
  },
  { key: "advocates", label: "Advocates", hideSm: true, has: (r) => !!r.advocates, render: (r) => <span className="small">{r.advocates}</span> },
  {
    key: "vcLink", label: "VC", has: (r) => !!r.vcLink,
    render: (r) => <a className="btn sm ghost" href={r.vcLink} target="_blank" rel="noreferrer"><Icon name="external" size="sm" />Join</a>,
  },
  { key: "cino", label: "CNR", hideSm: true, has: (r) => !!r.cino, render: (r) => <span className="mono small">{r.cino}</span> },
  { key: "keptBack", label: "Kept back", hideSm: true, has: (r) => !!r.keptBack, render: (r) => r.keptBack },
  { key: "venue", label: "Venue", hideSm: true, has: (r) => !!r.venue, render: (r) => r.venue },
  { key: "message", label: "Message", hideSm: true, has: (r) => !!r.message, render: (r) => r.message },
  { key: "stage", label: "Stage", hideSm: true, has: (r) => !!r.stage, render: (r) => r.stage },
  { key: "progress", label: "Progress", has: (r) => !!r.progress, render: (r) => <Chip tone={isOver(r) ? "" : "info"}>{r.progress}</Chip> },
  { key: "reference", label: "Reference", hideSm: true, has: (r) => !!r.reference, render: (r) => r.reference },
];

// One forum: <details> toggles open; the board loads lazily on first open and
// polls while open. `tick` bumps when the page-level Refresh is pressed.
function CourtPanel({ court, tick }: { court: any; tick: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const [state, setState] = useState<{ status: string; board: any; error: string; down?: boolean }>({ status: "idle", board: null, error: "" });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: s.board ? "refreshing" : "loading", error: "" }));
    try {
      if (court.value === "sci") {
        const [rcBoard, vcBoard] = await fetchBenches(["sci", "sci_vc"]);
        if (!rcBoard && !vcBoard) throw new Error("SCI board unavailable");
        setState({
          status: "done",
          board: {
            boardDate: rcBoard?.boardDate || vcBoard?.boardDate || "",
            fetchedAt: rcBoard?.fetchedAt || vcBoard?.fetchedAt || "",
            rows: mergeSciRows(rcBoard?.rows, vcBoard?.rows),
          },
          error: "",
        });
        return;
      }
      const res = await api.get("/api/workspace/display-board", { params: { bench: court.value } });
      setState({ status: "done", board: res.data, error: "" });
    } catch (err: any) {
      const down = err?.response?.status === 503;
      const msg = err?.response?.data?.error || (down ? "The court data service is not reachable." : `Couldn't reach the ${court.label} board.`);
      // Keep the last board on screen when a refresh fails.
      setState((s) => ({ status: "error", board: s.board, error: msg, down }));
    }
  }, [court.value, court.label]);

  // Fetch the first time this panel is opened.
  useEffect(() => {
    if (isOpen && state.status === "idle") load();
  }, [isOpen, state.status, load]);

  // Poll while open.
  useEffect(() => {
    if (!isOpen) return;
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [isOpen, load]);

  // Page-level refresh: reload boards that are open and already loaded.
  const lastTick = useRef(tick);
  useEffect(() => {
    if (tick !== lastTick.current) { lastTick.current = tick; if (isOpen && state.status !== "idle") load(); }
  }, [tick, isOpen, state.status, load]);

  const { status, board, error, down } = state;
  const rows: any[] = board?.rows || [];
  const visibleFields = FIELD_CATALOG.filter((f) => rows.some(f.has));
  const yours = rows.filter((r) => r.yourItem).length;

  return (
    <details className="pp-acc" open={isOpen} onToggle={(e) => setIsOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <Icon name="chevron" size="sm" className="chev" />
        <span className="grow court-acc-title">
          <h3>{court.label}</h3>
          {court.note && <span className="faint xs">{court.note}</span>}
        </span>
        {board && <span className="faint small hide-sm">{rows.length} hall{rows.length === 1 ? "" : "s"}{yours ? `, ${yours} with your matters` : ""}</span>}
      </summary>

      {(board || status === "error") && (
        <div className="court-board-meta">
          {board?.boardDate && <span className="small muted">Board of {fmtBoardDate(board.boardDate)}</span>}
          {board?.fetchedAt && status !== "error" && <span className="pp-live"><i aria-hidden="true" />Live, updated {formatFetchedAt(board.fetchedAt)}</span>}
          <span className="grow" />
          <button type="button" className={`btn sm${status === "refreshing" ? " loading" : ""}`} onClick={load}><Icon name="refresh" size="sm" />Refresh</button>
        </div>
      )}

      {status === "error" && (
        <div className="court-pad">
          <div className={`callout ${down ? "warn" : "bad"}`} role="alert">
            <Icon name="warn" size="sm" />
            <div className="grow">{error}{board?.fetchedAt ? ` Showing data from ${formatFetchedAt(board.fetchedAt)}.` : ""}</div>
            <button type="button" className="btn sm" onClick={load}>Retry</button>
          </div>
        </div>
      )}

      {status === "loading" && <div className="court-pad stack"><Skel h={36} /><Skel h={36} /><Skel h={36} /></div>}

      {board && rows.length > 0 && (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th scope="col">Court hall</th>
                {visibleFields.map((f) => <th key={f.key} scope="col" className={f.hideSm ? "hide-sm" : undefined}>{f.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.courtNumber}-${i}`} className={`pp-board-row${isOver(r) ? " over" : ""}${r.yourItem ? " hl" : ""}`}>
                  <td>{r.courtNumber || "—"}</td>
                  {visibleFields.map((f) => <td key={f.key} className={f.hideSm ? "hide-sm" : undefined}>{f.has(r) ? f.render(r) : <span className="faint">—</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {board && status !== "loading" && rows.length === 0 && (
        <div className="court-pad faint small">No courts are currently on the board.</div>
      )}
    </details>
  );
}

export default function DisplayBoard() {
  const [courts, setCourts] = useState<any[]>(FALLBACK_COURTS);
  const [myForums, setMyForums] = useState<any[]>([]);
  // Default to All Forums and switch once we know the practice has courts of its own.
  const [tab, setTab] = useState<"mine" | "all">("all");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/api/workspace/display-board/courts");
        if (res.data?.courts?.length) setCourts(mergeSciCourts(res.data.courts));
      } catch { /* keep the fallback list */ }
    })();
  }, []);

  // My Forums (courts the practice has cases in) is cheap stored data, so it loads up front.
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/api/causelist/my-forums");
        const mine = res.data?.courts || [];
        setMyForums(mine);
        if (mine.length) setTab("mine");
      } catch { /* leave My Forums empty; All Forums still works */ }
    })();
  }, []);

  // SCI is shown as one entry but is two provider keys; a case resolves to "sci".
  const mineKeys = new Set(myForums.map((c) => c.value));
  const shown = tab === "mine" ? courts.filter((c) => mineKeys.has(c.value)) : courts;

  return (
    <div className="court">
      <PageHead title="Court Display Board" sub="Where each court hall has reached in its list, so you know when to walk in. Open a forum to see its live board."
        actions={<button type="button" className="btn" onClick={() => setTick((t) => t + 1)}><Icon name="refresh" size="sm" />Refresh</button>} />

      <div className="toolbar">
        <Segmented<"mine" | "all"> label="Forums" value={tab} onChange={(v) => { if (v === "mine" && !myForums.length) return; setTab(v); }}
          options={[
            { value: "mine", label: `My forums${myForums.length ? ` (${myForums.length})` : ""}` },
            { value: "all", label: `All forums (${courts.length})` },
          ]} />
      </div>

      {shown.map((c) => <CourtPanel key={c.value} court={c} tick={tick} />)}
      {tab === "mine" && !shown.length && (
        <div className="callout info"><Icon name="info" size="sm" /><div>None of your cases could be matched to a court yet. Import a case from the court record to link it, or use All forums.</div></div>
      )}
    </div>
  );
}
