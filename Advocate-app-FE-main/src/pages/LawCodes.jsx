import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { FiSearch, FiRepeat, FiX, FiArrowRight } from "react-icons/fi";
import "../assets/styles/LawCodes.css";

// The three act pairs replaced on 1 July 2024.
const PAIRS = [
  { key: "IPC-BNS", oldAct: "IPC", newAct: "BNS", label: "IPC → BNS" },
  { key: "CrPC-BNSS", oldAct: "CrPC", newAct: "BNSS", label: "CrPC → BNSS" },
  { key: "IEA-BSA", oldAct: "IEA", newAct: "BSA", label: "IEA → BSA" },
];

export default function LawCodes() {
  const token = localStorage.getItem("token");
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

  const [pair, setPair] = useState("IPC-BNS");
  const [direction, setDirection] = useState("old-new"); // which side the query matches
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [browsing, setBrowsing] = useState(true);
  const debounce = useRef(null);

  const activePair = PAIRS.find((p) => p.key === pair) || PAIRS[0];

  const load = useCallback(async (p, q, dir) => {
    setLoading(true);
    try {
      let data;
      if (q.trim().length >= 1) {
        const res = await axios.get(
          `/api/lawcodes/search?q=${encodeURIComponent(q.trim())}&pair=${p}&direction=${dir}&limit=60`,
          authHeaders);
        data = res.data || [];
        setBrowsing(false);
      } else {
        const res = await axios.get(`/api/lawcodes?pair=${p}&page=0&size=60`, authHeaders);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => load(pair, query, direction), 250);
    return () => debounce.current && clearTimeout(debounce.current);
  }, [pair, query, direction, load]);

  const badge = (r) =>
    r.repealed ? <span className="lc-badge repealed">Repealed</span>
      : r.changed ? <span className="lc-badge changed">Changed</span> : null;

  return (
    <div className="lc-container">
      <div className="lc-header">
        <FiRepeat className="lc-header-icon" />
        <div>
          <h2>Law Codes — BNS / BNSS / BSA</h2>
          <p className="subtle">
            Find the new section for an old IPC / CrPC / Evidence Act reference (effective 1 July 2024).
          </p>
        </div>
      </div>

      <div className="lc-tabs">
        {PAIRS.map((p) => (
          <button key={p.key}
            className={`lc-tab ${pair === p.key ? "active" : ""}`}
            onClick={() => { setPair(p.key); setSelected(null); }}>
            {p.label}
          </button>
        ))}
      </div>

      <div className="lc-controls">
        <div className="lc-search-box">
          <FiSearch className="lc-search-icon" />
          <input
            autoFocus
            type="text"
            placeholder={direction === "new-old"
              ? `Search a new ${activePair.newAct} section or keyword…`
              : `Search an old ${activePair.oldAct} section (e.g. 302) or keyword…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && <button className="lc-search-clear" onClick={() => setQuery("")}><FiX /></button>}
        </div>
        <button className="lc-dir-toggle"
          title="Switch which side your search matches"
          onClick={() => setDirection((d) => (d === "old-new" ? "new-old" : "old-new"))}>
          <FiRepeat /> Search by {direction === "new-old" ? activePair.newAct : activePair.oldAct}
        </button>
      </div>

      <div className="lc-body">
        <div className="lc-results">
          {loading && <p className="lc-muted">Loading…</p>}
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
                <FiArrowRight className="lc-arrow" />
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
                <FiArrowRight className="lc-detail-arrow" />
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
              <FiRepeat size={38} />
              <p>Select a mapping to see the details.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
