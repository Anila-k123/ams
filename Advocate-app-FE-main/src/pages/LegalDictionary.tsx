import { useState, useEffect, useRef, useCallback } from "react";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import { ProgressSpinner } from "primereact/progressspinner";
import api from "../api/client";
import "../assets/styles/LegalDictionary.css";

export default function LegalDictionary() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  // Official Hindi from the Legal Glossary (dictionary/import_glossary_hindi), when the term has it.
  const [showHindi, setShowHindi] = useState(false);
  const debounce = useRef<any>(null);

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); setSearched(false); return; }
    setLoading(true);
    try {
      const res = await api.get(`/api/dictionary/search?q=${encodeURIComponent(q.trim())}&limit=30`);
      setResults(res.data || []);
      setSearched(true);
    } catch (err) {
      console.error("Dictionary search error:", err);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => runSearch(query), 300);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query, runSearch]);

  const openTerm = async (id: any) => {
    try {
      const res = await api.get(`/api/dictionary/term/${id}`);
      setSelected(res.data);
      setShowHindi(false);
    } catch (err) {
      console.error("Dictionary term error:", err);
    }
  };

  return (
    <div className="ld-container">
      <p className="ld-subtitle">Search legal terms and their meanings.</p>

      <div className="flex align-items-center gap-2 mb-3" style={{ maxWidth: 720 }}>
        <span className="p-input-icon-left flex-1">
          <i className="pi pi-search" />
          <InputText
            autoFocus
            className="w-full"
            placeholder="Search a legal term (e.g. abatement, affidavit, tort, bail)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </span>
        {query && <Button icon="pi pi-times" text rounded severity="secondary" aria-label="Clear" onClick={() => setQuery("")} />}
      </div>

      <div className="ld-body">
        <div className="ld-results">
          {loading && (
            <div className="flex align-items-center gap-2 ld-muted">
              <ProgressSpinner style={{ width: 20, height: 20, margin: 0 }} strokeWidth="6" /> Searching…
            </div>
          )}
          {!loading && searched && results.length === 0 && (
            <p className="ld-muted">No terms found for “{query}”.</p>
          )}
          {!loading && !searched && (
            <p className="ld-muted">Type at least 2 letters to search 11,000+ legal terms.</p>
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
              <span className="ld-result-term">
                {r.term}
                {r.hasHindi && <span className="ld-hi-tag" title="Hindi available">हिं</span>}
              </span>
              <span className="ld-result-snippet">{r.snippet}</span>
            </button>
          ))}
        </div>

        <div className="ld-detail">
          {selected ? (
            <>
              <div className="flex align-items-start justify-content-between gap-3">
                {showHindi && selected.hindi ? (
                  <div>
                    <h3 className="ld-term-title ld-hindi" lang="hi">{selected.hindi.split(" ; ")[0]}</h3>
                    <div className="ld-muted text-sm">English: {selected.term}</div>
                  </div>
                ) : (
                  <h3 className="ld-term-title">{selected.term}</h3>
                )}
                {selected.hindi && (
                  <Button size="small" outlined label={showHindi ? "English" : "हिंदी"}
                    icon="pi pi-language" onClick={() => setShowHindi((v) => !v)}
                    aria-label={showHindi ? "Show in English" : "Show in Hindi"} />
                )}
              </div>
              {showHindi && selected.hindi ? (
                <div className="ld-term-def ld-hindi" lang="hi">
                  <ul className="ld-hindi-list">
                    {selected.hindi.split(" ; ").map((h: string, i: number) => <li key={i}>{h}</li>)}
                  </ul>
                </div>
              ) : (
                <div className="ld-term-def">
                  {(selected.definition || "").split(/\n{2,}/).filter(Boolean).map((para: string, i: number) => (
                    <p key={i}>{para}</p>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="ld-detail-empty">
              <i className="pi pi-book" style={{ fontSize: 40 }} />
              <p>Select a term to see its full definition.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
