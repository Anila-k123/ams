import { useState, useEffect, useRef, useCallback } from "react";
import api from "../api/client";
import { useToast } from "../contexts/ToastContext";
import { PageHead, EmptyState, Icon, Skel, Button, Spinner } from "../ui/kit";
import { FilterChip, Segmented } from "../ui/forms";
import "../ui/pages/research.css";

// Starting points while the box is empty (the API needs 2+ letters, so no A-Z browse).
const COMMON_TERMS = ["affidavit", "bail", "res judicata", "ex parte", "mesne profits", "caveat", "injunction", "tort"];

export default function LegalDictionary() {
  const { success } = useToast() as any;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [termLoading, setTermLoading] = useState(false);
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
    setTermLoading(true);
    try {
      const res = await api.get(`/api/dictionary/term/${id}`);
      setSelected(res.data);
      setShowHindi(false);
    } catch (err) {
      console.error("Dictionary term error:", err);
    } finally {
      setTermLoading(false);
    }
  };

  const copyDefinition = () => {
    try { navigator.clipboard?.writeText(`${selected.term}: ${selected.definition || ""}`); } catch { /* clipboard blocked */ }
    success(`Copied the definition of ${selected.term}`);
  };

  const q = query.trim();
  const hint = q.length === 1 ? "Keep typing: search starts at 2 letters."
    : !q ? "Type at least 2 letters to search 11,000+ legal terms." : "";

  const hindiList: string[] = selected?.hindi ? selected.hindi.split(" ; ") : [];

  return (
    <div>
      <PageHead title="Legal Dictionary" sub="11,000+ legal terms with plain definitions and official Hindi equivalents." />

      <div className="input-icon pp-big-wrap" style={{ maxWidth: 720, marginBottom: 6 }}>
        <Icon name="search" />
        <input className="input pp-big" type="search" autoFocus aria-label="Search legal terms"
          placeholder="Look up a term, like mesne profits" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="faint small" style={{ marginBottom: 12, minHeight: 18 }} aria-live="polite">
        {loading ? <Spinner label="Searching" /> : hint || (searched ? `${results.length} match${results.length !== 1 ? "es" : ""}` : "")}
      </div>

      {!q && (
        <div className="row wrap" role="group" aria-label="Common terms" style={{ marginBottom: 18 }}>
          {COMMON_TERMS.map((t) => <FilterChip key={t} on={false} onClick={() => setQuery(t)}>{t}</FilterChip>)}
        </div>
      )}

      {searched && !loading && results.length === 0 ? (
        <div className="panel">
          <EmptyState icon="dict" title={`No term matches "${q}"`}
            text='Check the spelling, or try the Latin form, like "res judicata" or "ex parte".' />
        </div>
      ) : results.length > 0 || selected ? (
        <div className="split left-rail" style={{ gridTemplateColumns: "300px minmax(0, 1fr)" }}>
          <div className="panel rs-list" style={{ padding: "6px 0" }} role="listbox" aria-label="Terms">
            {results.length === 0 && <div className="faint small" style={{ padding: "10px 20px" }}>Search to see more terms.</div>}
            {results.map((r) => (
              <button key={r.id} type="button" role="option" aria-selected={selected?.id === r.id}
                className={`list-item${selected?.id === r.id ? " sel" : ""}`} onClick={() => openTerm(r.id)}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 500 }}>{r.term}</div>
                  {r.snippet && <div className="faint xs pp-clamp" style={{ marginTop: 2 }}>{r.snippet}</div>}
                </div>
                {r.hasHindi && <span className="faint xs" lang="hi" title="Hindi available">हिं</span>}
              </button>
            ))}
          </div>

          <div className="panel">
            <div className="panel-body" style={{ padding: "26px 28px", opacity: termLoading ? 0.6 : 1 }}>
              {selected ? (
                <>
                  <div className="row between wrap" style={{ gap: 12 }}>
                    <h2 className="serif" style={{ fontSize: "var(--t-3xl)", fontWeight: 500 }} lang={showHindi && hindiList.length ? "hi" : undefined}>
                      {showHindi && hindiList.length ? hindiList[0] : selected.term}
                    </h2>
                    {hindiList.length > 0 && (
                      <Segmented label="Language" value={showHindi ? "hi" : "en"} onChange={(v) => setShowHindi(v === "hi")}
                        options={[{ value: "en", label: "English" }, { value: "hi", label: <span lang="hi">हिंदी</span> }]} />
                    )}
                  </div>
                  {showHindi && hindiList.length ? (
                    <>
                      <p className="faint small" style={{ marginTop: 4 }}>Hindi equivalent of <b>{selected.term}</b></p>
                      <ul className="rs-def" lang="hi">
                        {hindiList.map((h, i) => <li key={i}>{h}</li>)}
                      </ul>
                    </>
                  ) : (
                    <div className="rs-def">
                      {(selected.definition || "").split(/\n{2,}/).filter(Boolean).map((para: string, i: number) => (
                        <p key={i}>{para}</p>
                      ))}
                    </div>
                  )}
                  <div className="row wrap" style={{ marginTop: 20 }}>
                    <Button size="sm" icon="copy" onClick={copyDefinition}>Copy definition</Button>
                  </div>
                </>
              ) : termLoading ? (
                <div className="stack"><Skel h={32} w="40%" /><Skel h={14} /><Skel h={14} w="85%" /></div>
              ) : (
                <EmptyState icon="dict" title="Select a term" text="Choose a term on the left to read its full definition." />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
