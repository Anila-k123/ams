import { useState, useEffect, useRef, useCallback } from "react";
import api from "../api/client";
import { useToast } from "../contexts/ToastContext";
import { PageHead, Chip, EmptyState, Icon, Skel, Button } from "../ui/kit";
import { SearchInput, Segmented, Tabs } from "../ui/forms";
import "../ui/pages/research.css";

// The three act pairs replaced on 1 July 2024.
const PAIRS = [
  { key: "IPC-BNS", oldAct: "IPC", newAct: "BNS", label: "IPC to BNS", oldName: "Indian Penal Code", newName: "Bharatiya Nyaya Sanhita" },
  { key: "CrPC-BNSS", oldAct: "CrPC", newAct: "BNSS", label: "CrPC to BNSS", oldName: "Code of Criminal Procedure", newName: "Bharatiya Nagarik Suraksha Sanhita" },
  { key: "IEA-BSA", oldAct: "IEA", newAct: "BSA", label: "IEA to BSA", oldName: "Indian Evidence Act", newName: "Bharatiya Sakshya Adhiniyam" },
];

const kindChip = (r: any) =>
  r.repealed ? <Chip tone="bad">Repealed</Chip>
    : r.changed ? <Chip tone="warn">Changed</Chip> : <Chip tone="ok">Same</Chip>;

export default function LawCodes() {
  const { success } = useToast() as any;
  const [pair, setPair] = useState("IPC-BNS");
  const [direction, setDirection] = useState("old-new"); // which side the query matches
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [browsing, setBrowsing] = useState(true);
  const debounce = useRef<any>(null);

  const activePair = PAIRS.find((p) => p.key === pair) || PAIRS[0];

  const load = useCallback(async (p: string, q: string, dir: string) => {
    setLoading(true);
    try {
      let data;
      if (q.trim().length >= 1) {
        const res = await api.get(
          `/api/lawcodes/search?q=${encodeURIComponent(q.trim())}&pair=${p}&direction=${dir}&limit=60`);
        data = res.data || [];
        setBrowsing(false);
      } else {
        const res = await api.get(`/api/lawcodes?pair=${p}&page=0&size=60`);
        data = res.data?.content || res.data || [];
        setBrowsing(true);
      }
      setRows(data);
    } catch (err) {
      console.error("Law codes load error:", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(pair, query, direction), 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [pair, query, direction, load]);

  // Keep a mapping open on the right: the clicked one, else the first result.
  const sel = rows.find((r) => r.id === selected?.id) || rows[0] || null;

  const copyCitation = () => {
    const text = sel.repealed
      ? `Sec. ${sel.oldSection} ${sel.oldAct} (repealed, no ${sel.newAct} equivalent)`
      : `Sec. ${sel.oldSection} ${sel.oldAct} (now Sec. ${sel.newSection} ${sel.newAct})`;
    try { navigator.clipboard?.writeText(text); } catch { /* clipboard blocked */ }
    success(`Copied: ${text}`);
  };

  return (
    <div>
      <PageHead title="Section Cross-Reference"
        sub="Find the new section for an old one, or trace a new section back. The new criminal codes apply to offences from 1 July 2024." />

      <Tabs label="Code pair" value={pair} onChange={(v) => { setPair(v); setSelected(null); }}
        tabs={PAIRS.map((p) => ({ value: p.key, label: p.label }))} />

      <div className="toolbar" style={{ marginTop: 16 }}>
        <SearchInput autoFocus value={query} onChange={setQuery} style={{ width: "min(420px, 100%)" }}
          aria-label="Search sections"
          placeholder={direction === "new-old"
            ? `${activePair.newAct} section or keyword, like 318`
            : `${activePair.oldAct} section or keyword, like 420`} />
        <Segmented label="Search direction" value={direction} onChange={setDirection} options={[
          { value: "old-new", label: `Search ${activePair.oldAct}` },
          { value: "new-old", label: `Search ${activePair.newAct}` },
        ]} />
      </div>

      <div className="faint small" style={{ marginBottom: 10 }} aria-live="polite">
        {!loading && rows.length > 0 && (browsing
          ? `${activePair.label}: showing ${rows.length}`
          : `${rows.length} match${rows.length !== 1 ? "es" : ""}`)}
      </div>

      {loading && !rows.length ? (
        <div className="split wide-rail">
          <div className="panel"><div className="panel-body stack">{[1, 2, 3, 4, 5, 6].map((i) => <Skel key={i} h={16} />)}</div></div>
          <Skel h={220} />
        </div>
      ) : !rows.length ? (
        <div className="panel">
          <EmptyState icon="swap" title="No section found"
            text={query ? `Nothing in ${activePair.label} matches "${query}". Check the section number, or switch the search direction.` : "No mappings available for this pair."}
            action={query ? <button type="button" className="btn sm" onClick={() => setQuery("")}>Clear search</button> : undefined} />
        </div>
      ) : (
        <div className="split wide-rail" style={{ opacity: loading ? 0.6 : 1 }}>
          <div className="panel rs-list" style={{ padding: "6px 0" }} role="listbox" aria-label="Mappings">
            {rows.map((r) => (
              <button key={r.id} type="button" role="option" aria-selected={sel?.id === r.id}
                className={`list-item${sel?.id === r.id ? " sel" : ""}`} onClick={() => setSelected(r)}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="row wrap" style={{ gap: 8 }}>
                    <span className="mono small nowrap">{r.oldAct} {r.oldSection}</span>
                    <Icon name="swap" size="sm" className="faint" />
                    <span className="mono small nowrap">{r.repealed ? <span className="faint">None</span> : `${r.newAct} ${r.newSection}`}</span>
                  </div>
                  {r.description && <div className="faint xs ellipsis" style={{ marginTop: 2 }}>{r.description}</div>}
                </div>
                {(r.repealed || r.changed) && kindChip(r)}
              </button>
            ))}
          </div>

          {sel && (
            <div className="panel">
              <div className="panel-body" style={{ padding: 22 }}>
                <div className="row" style={{ gap: 8, marginBottom: 12 }}>{kindChip(sel)}</div>
                <div className="pp-two" style={{ gap: 12 }}>
                  <div className="panel tinted"><div className="panel-body" style={{ padding: "14px 16px" }}>
                    <div className="faint xs">{activePair.oldName}</div>
                    <div className="rs-big-sec">{sel.oldAct} {sel.oldSection}</div>
                  </div></div>
                  <div className="panel tinted"><div className="panel-body" style={{ padding: "14px 16px" }}>
                    <div className="faint xs">{activePair.newName}</div>
                    <div className="rs-big-sec">{sel.repealed ? <span className="faint">No section</span> : `${sel.newAct} ${sel.newSection}`}</div>
                  </div></div>
                </div>
                {sel.description && <p style={{ marginTop: 16, lineHeight: 1.65 }}>{sel.description}</p>}
                {sel.repealed && (
                  <div className="callout warn" style={{ marginTop: 14 }}><Icon name="alert" size="sm" />
                    <div>This provision was repealed with no direct equivalent in the {activePair.newAct}. For offences committed before 1 July 2024, the {activePair.oldAct} continues to apply to pending proceedings.</div></div>
                )}
                {sel.changed && !sel.repealed && (
                  <div className="callout warn" style={{ marginTop: 14 }}><Icon name="alert" size="sm" />
                    <div>The wording or penalty was substantively changed. Verify against the bare act before relying on it.</div></div>
                )}
                <div className="row wrap" style={{ marginTop: 18 }}>
                  <Button size="sm" icon="copy" onClick={copyCitation}>Copy citation</Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
