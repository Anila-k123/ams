import { useState, useEffect, useRef, useCallback } from "react";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { TabMenu } from "primereact/tabmenu";
import { Tag } from "primereact/tag";
import { ProgressSpinner } from "primereact/progressspinner";
import api from "../api/client";
import "../assets/styles/LawCodes.css";

// The three act pairs replaced on 1 July 2024.
const PAIRS = [
  { key: "IPC-BNS", oldAct: "IPC", newAct: "BNS", label: "IPC → BNS" },
  { key: "CrPC-BNSS", oldAct: "CrPC", newAct: "BNSS", label: "CrPC → BNSS" },
  { key: "IEA-BSA", oldAct: "IEA", newAct: "BSA", label: "IEA → BSA" },
];

export default function LawCodes() {
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

  const badge = (r: any) =>
    r.repealed ? <Tag severity="danger" value="Repealed" className="lc-badge" />
      : r.changed ? <Tag severity="warning" value="Changed" className="lc-badge" /> : null;

  const activeIndex = Math.max(0, PAIRS.findIndex((p) => p.key === pair));

  return (
    <div className="lc-container">
      <p className="lc-subtitle">
        Find the new section for an old IPC / CrPC / Evidence Act reference.
      </p>

      <TabMenu
        className="mb-3"
        model={PAIRS.map((p) => ({ label: p.label }))}
        activeIndex={activeIndex}
        onTabChange={(e) => { setPair(PAIRS[e.index].key); setSelected(null); }}
      />

      <div className="flex gap-2 mb-3 flex-wrap">
        <div className="flex align-items-center gap-2 flex-1" style={{ minWidth: 260 }}>
          <span className="p-input-icon-left flex-1">
            <i className="pi pi-search" />
            <InputText
              autoFocus
              className="w-full"
              placeholder={direction === "new-old"
                ? `Search a new ${activePair.newAct} section or keyword…`
                : `Search an old ${activePair.oldAct} section (e.g. 302) or keyword…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </span>
          {query && <Button icon="pi pi-times" text rounded severity="secondary" aria-label="Clear" onClick={() => setQuery("")} />}
        </div>
        <Button
          outlined
          icon="pi pi-sync"
          label={`Search by ${direction === "new-old" ? activePair.newAct : activePair.oldAct}`}
          tooltip="Switch which side your search matches"
          tooltipOptions={{ position: "bottom" }}
          onClick={() => setDirection((d) => (d === "old-new" ? "new-old" : "old-new"))}
        />
      </div>

      <div className="lc-body">
        <div className="lc-results">
          {loading && (
            <div className="flex align-items-center gap-2 lc-muted">
              <ProgressSpinner style={{ width: 20, height: 20, margin: 0 }} strokeWidth="6" /> Loading…
            </div>
          )}
          {!loading && rows.length === 0 && (
            <p className="lc-muted">No mappings found{query ? ` for “${query}”` : ""}.</p>
          )}
          {!loading && rows.length > 0 && (
            <div className="lc-count">
              {browsing ? `${activePair.label} — showing ${rows.length}` : `${rows.length} match${rows.length !== 1 ? "es" : ""}`}
            </div>
          )}
          {rows.map((r) => (
            <button key={r.id}
              className={`lc-result ${selected?.id === r.id ? "active" : ""}`}
              onClick={() => setSelected(r)}>
              <span className="lc-map">
                <span className="lc-old">{r.oldAct} §{r.oldSection}</span>
                <i className="pi pi-arrow-right lc-arrow" />
                <span className={`lc-new ${r.repealed ? "repealed" : ""}`}>
                  {r.repealed ? "Repealed" : `${r.newAct} §${r.newSection}`}
                </span>
                {badge(r)}
              </span>
              {r.description && <span className="lc-desc">{r.description}</span>}
            </button>
          ))}
        </div>

        <div className="lc-detail">
          {selected ? (
            <>
              <div className="lc-detail-map">
                <div className="lc-detail-side">
                  <div className="lc-detail-act">{selected.oldAct}</div>
                  <div className="lc-detail-sec">Section {selected.oldSection}</div>
                </div>
                <i className="pi pi-arrow-right lc-detail-arrow" />
                <div className="lc-detail-side">
                  <div className="lc-detail-act new">{selected.newAct}</div>
                  <div className="lc-detail-sec">
                    {selected.repealed ? "Repealed" : `Section ${selected.newSection}`}
                  </div>
                </div>
              </div>
              {badge(selected)}
              {selected.description && <p className="lc-detail-desc">{selected.description}</p>}
              {selected.repealed && (
                <p className="lc-detail-note">This provision was repealed with no direct equivalent in the new code.</p>
              )}
              {selected.changed && !selected.repealed && (
                <p className="lc-detail-note">The wording or penalty was substantively changed — verify against the bare Act before relying on it.</p>
              )}
            </>
          ) : (
            <div className="lc-detail-empty">
              <i className="pi pi-sync" style={{ fontSize: 38 }} />
              <p>Select a mapping to see the details.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
