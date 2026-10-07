import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api, { errorMessage } from "../api/client";
import useDebouncedValue from "../hooks/useDebouncedValue";
import usePagination from "../hooks/usePagination";
import { PageHead, Chip, EmptyState, Skel, Icon } from "../ui/kit";
import { SearchInput, FilterChip, Segmented } from "../ui/forms";
import "../ui/pages/research.css";

const FIELD_CHIPS: [string, string][] = [
  ["all", "All"],
  ["short_title", "Short title"],
  ["long_title", "Long title"],
  ["department", "Department"],
  ["section_title", "Section title"],
  ["section_contents", "Section contents"],
  ["act_number", "Act number"],
  ["act_year", "Act year"],
];

// Only what's actually been imported so far (Central + Tamil Nadu).
const JURISDICTIONS = [
  { value: "", label: "All" },
  { value: "CENTRAL", label: "Central" },
  { value: "Tamil Nadu", label: "Tamil Nadu" },
];

// What the search box should ask for, per chip.
const FIELD_PLACEHOLDERS: Record<string, string> = {
  all: "Search Bare Acts",
  short_title: "Search the short title, e.g. Anna University Act",
  long_title: "Search the long title",
  department: "Search the department, e.g. Higher Education",
  section_title: "Search section headings, e.g. Definitions",
  section_contents: "Search inside section text, e.g. vice-chancellor",
  act_number: "Search the act number, e.g. 26",
  act_year: "Year (2015) or range (2010-2015)",
};

// Mirrors the backend's year parsing so the page can explain an unusable year itself.
const YEAR_RE = /^\d{4}$/;
const YEAR_RANGE_RE = /^(\d{4})\s*(?:-|–|to)\s*(\d{4})$/i;

function yearQueryProblem(raw: string) {
  const v = (raw || "").trim();
  if (!v) return null;
  if (YEAR_RE.test(v) || YEAR_RANGE_RE.test(v)) return null;
  return /^\d+$/.test(v) ? `"${v}" is not a four-digit year.` : `"${v}" is not a year.`;
}

function formatDate(iso: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// Keep the card compact by cutting the abstract to one short line at a word boundary.
function shortDescription(text: string, max = 140) {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

const isCentral = (j: string) => String(j || "").toUpperCase() === "CENTRAL";

export default function Acts() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 300) as string;
  const [field, setField] = useState("all");
  const [jurisdiction, setJurisdiction] = useState("");
  const [acts, setActs] = useState<any[]>([]);
  const [totalElements, setTotalElements] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const yearProblem = field === "act_year" ? yearQueryProblem(query) : null;
  const { page, setPage, size, setSize } = usePagination({
    defaultSize: 20, resetOn: [debouncedQuery, field, jurisdiction],
  }) as any;

  const fetchActs = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, size, field };
      if (debouncedQuery.trim()) params.q = debouncedQuery.trim();
      if (jurisdiction) params.jurisdiction = jurisdiction;
      const res = await api.get("/api/acts", { params });
      setActs(res.data.content || []);
      setTotalElements(res.data.totalElements || 0);
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Failed to load acts."));
    } finally {
      setLoading(false);
    }
  }, [page, size, debouncedQuery, field, jurisdiction]);

  useEffect(() => { fetchActs(); }, [fetchActs]);

  const pages = Math.max(1, Math.ceil(totalElements / size));
  const fieldLabel = (FIELD_CHIPS.find(([v]) => v === field) || ["", "All"])[1];

  return (
    <div>
      <PageHead title="Bare Acts" sub="Central and Tamil Nadu bare acts with sections, act papers and the cases you have linked to them." />

      <div className="toolbar">
        <SearchInput value={query} onChange={setQuery} style={{ width: "min(420px, 100%)" }}
          placeholder={FIELD_PLACEHOLDERS[field] || "Search Bare Acts"}
          aria-label={`Search acts by ${fieldLabel.toLowerCase()}`}
          inputMode={field === "act_number" || field === "act_year" ? "numeric" : "text"}
          aria-invalid={!!yearProblem || undefined} />
        <Segmented label="Jurisdiction" value={jurisdiction} onChange={setJurisdiction} options={JURISDICTIONS} />
      </div>

      <div className="row wrap" role="group" aria-label="Search in" style={{ marginBottom: 8 }}>
        {FIELD_CHIPS.map(([v, l]) => <FilterChip key={v} on={field === v} onClick={() => setField(v)}>{l}</FilterChip>)}
      </div>

      {yearProblem && (
        <div className="field invalid" style={{ marginBottom: 12 }}>
          <span className="err" role="alert"><Icon name="warn" size="sm" />{yearProblem} Enter a year like 2015 or a range like 2010-2015.</span>
        </div>
      )}

      {error && <div className="callout bad" style={{ marginBottom: 12 }}><Icon name="warn" size="sm" /><div>{error}</div></div>}

      {!loading && !error && acts.length > 0 && (
        <div className="faint small" style={{ margin: "8px 0 10px" }}>{totalElements.toLocaleString("en-IN")} {totalElements === 1 ? "act" : "acts"}</div>
      )}

      <div className="stack">
        {loading ? (
          [1, 2, 3, 4, 5].map((i) => <div key={i} className="panel"><div className="panel-body stack"><Skel h={12} w="30%" /><Skel h={18} w="70%" /><Skel h={12} /></div></div>)
        ) : acts.length === 0 ? (
          <div className="panel">
            {yearProblem ? (
              <EmptyState icon="book" title={yearProblem}
                text="The Act year filter takes a four-digit year such as 2015, or a range such as 2010-2015. To search text instead, pick another filter above." />
            ) : debouncedQuery.trim() ? (
              <EmptyState icon="book" title="No acts match"
                text={<>Nothing matches &ldquo;{debouncedQuery.trim()}&rdquo; in {fieldLabel}{jurisdiction ? ` (${jurisdiction})` : ""}. Try a different filter{jurisdiction ? ", or set the jurisdiction back to All" : ""}.</>}
                action={<button type="button" className="btn sm" onClick={() => setQuery("")}>Clear search</button>} />
            ) : (
              <EmptyState icon="book" title="No acts found" />
            )}
          </div>
        ) : (
          acts.map((act) => (
            <button key={act.id} type="button" className="panel rs-card" onClick={() => navigate(`/dashboard/acts/${act.id}`)}>
              <div className="panel-body" style={{ padding: "16px 20px" }}>
                <div className="row wrap" style={{ gap: 10, marginBottom: 6 }}>
                  <Chip tone={isCentral(act.jurisdiction) ? "info" : "tape"}>{isCentral(act.jurisdiction) ? "Central" : act.jurisdiction}</Chip>
                  <span className="mono faint small">Act {act.actNumber} of {act.actYear}</span>
                </div>
                <h3>{act.title}</h3>
                {act.description && <p className="muted small" style={{ marginTop: 4 }}>{shortDescription(act.description)}</p>}
                <div className="faint xs" style={{ marginTop: 8 }}>
                  {[act.ministry, act.department && act.department !== act.ministry ? act.department : null,
                    act.enactmentDate ? `Enacted ${formatDate(act.enactmentDate)}` : null].filter(Boolean).join(" · ")}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {totalElements > 0 && (
        <div className="rs-pager">
          <span>{page * size + 1}–{Math.min(totalElements, page * size + size)} of {totalElements.toLocaleString("en-IN")}</span>
          <div className="row" style={{ gap: 8 }}>
            <label className="row small" style={{ gap: 6 }}>Per page
              <select className="input" style={{ width: "auto" }} value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>
                {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="pager" role="navigation" aria-label="Pages">
              <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">‹</button>
              <button type="button" aria-current="true">{page + 1} / {pages}</button>
              <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page">›</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
