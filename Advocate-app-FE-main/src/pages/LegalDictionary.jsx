import { useState, useEffect, useRef, useCallback } from "react";
import axios from "axios";
import { FiSearch, FiBookOpen, FiX } from "react-icons/fi";
import "../assets/styles/LegalDictionary.css";

const SOURCE_LABEL = { "aiyar-1997": "Aiyar's Law Lexicon (1997)", "india-code": "India Code" };
const SOURCE_SHORT = { "aiyar-1997": "Aiyar's", "india-code": "India Code" };
const srcClass = (s) => (s === "india-code" ? "ld-src india" : "ld-src aiyar");

export default function LegalDictionary() {
  const token = localStorage.getItem("token");
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounce = useRef(null);

  const runSearch = useCallback(async (q) => {
    if (q.trim().length < 2) { setResults([]); setSearched(false); return; }
    setLoading(true);
    try {
      const res = await axios.get(`/api/dictionary/search?q=${encodeURIComponent(q.trim())}&limit=30`, authHeaders);
      setResults(res.data || []);
      setSearched(true);
    } catch (err) {
      console.error("Dictionary search error:", err);
      setResults([]);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(query), 300);
    return () => debounce.current && clearTimeout(debounce.current);
  }, [query, runSearch]);

  const openTerm = async (id) => {
    try {
      const res = await axios.get(`/api/dictionary/term/${id}`, authHeaders);
      setSelected(res.data);
    } catch (err) {
      console.error("Dictionary term error:", err);
    }
  };

  return (
    <div className="ld-container">
      <div className="ld-header">
        <FiBookOpen className="ld-header-icon" />
        <div>
          <h2>Legal Dictionary</h2>
          <p className="subtle">Search legal terms and their meanings.</p>
        </div>
      </div>

      <div className="ld-search-box">
        <FiSearch className="ld-search-icon" />
        <input
          autoFocus
          type="text"
          placeholder="Search a legal term (e.g. abatement, affidavit, tort, bail)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && <button className="ld-search-clear" onClick={() => setQuery("")}><FiX /></button>}
      </div>

      <div className="ld-body">
        <div className="ld-results">
          {loading && <p className="ld-muted">Searching…</p>}
          {!loading && searched && results.length === 0 && (
            <p className="ld-muted">No terms found for “{query}”.</p>
          )}
          {!loading && !searched && (
            <p className="ld-muted">Type at least 2 letters to search 26,000+ legal terms.</p>
          )}
          {!loading && results.length > 0 && (
            <div className="ld-count">{results.length} match{results.length !== 1 ? "es" : ""}</div>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              className={`ld-result-item ${selected?.id === r.id ? "active" : ""}`}
              onClick={() => openTerm(r.id)}
            >
              <span className="ld-result-head">
                <span className="ld-result-term">{r.term}</span>
                <span className={srcClass(r.source)}>{SOURCE_SHORT[r.source] || r.source}</span>
              </span>
              <span className="ld-result-snippet">{r.snippet}</span>
            </button>
          ))}
        </div>

        <div className="ld-detail">
          {selected ? (
            <>
              <div className="ld-term-head">
                <h3 className="ld-term-title">{selected.term}</h3>
                <span className={srcClass(selected.source)}>{SOURCE_SHORT[selected.source] || selected.source}</span>
              </div>
              <div className="ld-term-def">
                {(selected.definition || "").split(/\n{2,}/).filter(Boolean).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
              </div>
              <div className="ld-term-source">Source: {SOURCE_LABEL[selected.source] || selected.source}</div>
            </>
          ) : (
            <div className="ld-detail-empty">
              <FiBookOpen size={40} />
              <p>Select a term to see its full definition.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
