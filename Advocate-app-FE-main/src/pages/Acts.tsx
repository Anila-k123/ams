import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { SelectButton } from "primereact/selectbutton";
import { Paginator } from "primereact/paginator";
import { Skeleton } from "primereact/skeleton";
import { Message } from "primereact/message";
import api, { errorMessage } from "../api/client";
import useDebouncedValue from "../hooks/useDebouncedValue";
import usePagination from "../hooks/usePagination";
import "../assets/styles/Acts.css";

const FIELD_CHIPS: [string, string][] = [
  ["all", "All"],
  ["short_title", "Short Title"],
  ["long_title", "Long Title"],
  ["department", "Department Name"],
  ["section_title", "Section Title"],
  ["section_contents", "Section Contents"],
  ["act_number", "Act Number"],
  ["act_year", "Act Year"],
];

// Only what's actually been imported so far (Central + Tamil Nadu).
const JURISDICTIONS: [string, string][] = [
  ["", "All jurisdictions"],
  ["CENTRAL", "Central Acts"],
  ["Tamil Nadu", "Tamil Nadu"],
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
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Keep the card compact by cutting the abstract to one short line at a word boundary.
function shortDescription(text: string, max = 140) {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

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

  return (
    <div className="acts-container">
      <div className="flex gap-2 flex-wrap mb-3">
        <span className="p-input-icon-left flex-1" style={{ minWidth: 240 }}>
          <i className="pi pi-search" />
          <InputText
            className="w-full"
            placeholder={FIELD_PLACEHOLDERS[field] || "Search Bare Acts"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </span>
        <Dropdown
          value={jurisdiction}
          options={JURISDICTIONS.map(([value, label]) => ({ value, label }))}
          onChange={(e) => setJurisdiction(e.value)}
        />
      </div>

      <SelectButton
        className="acts-field-chips mb-3"
        value={field}
        options={FIELD_CHIPS.map(([value, label]) => ({ value, label }))}
        onChange={(e) => { if (e.value) setField(e.value); }}
      />

      {yearProblem && (
        <p className="acts-filter-warning">
          {yearProblem} Enter a year like <code>2015</code> or a range like <code>2010-2015</code>.
        </p>
      )}

      {error && <Message severity="error" text={error} className="mb-3" />}

      <div className="acts-list">
        {loading ? (
          [1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} height="92px" className="mb-2" />)
        ) : acts.length === 0 ? (
          <div className="acts-empty">
            {yearProblem ? (
              <>
                <p className="no-data">{yearProblem}</p>
                <p className="acts-empty-hint">
                  The <strong>Act Year</strong> filter takes a four-digit year such
                  as <code>2015</code>, or a range such as <code>2010-2015</code>.
                  To search text instead, pick another filter above.
                </p>
              </>
            ) : debouncedQuery.trim() ? (
              <>
                <p className="no-data">
                  No acts match &ldquo;{debouncedQuery.trim()}&rdquo; in{" "}
                  {(FIELD_CHIPS.find(([v]) => v === field) || ["", "All"])[1]}
                  {jurisdiction ? ` (${jurisdiction})` : ""}.
                </p>
                <p className="acts-empty-hint">
                  Try a different filter above
                  {jurisdiction ? ", or set the jurisdiction back to All" : ""}.
                </p>
              </>
            ) : (
              <p className="no-data">No acts found.</p>
            )}
          </div>
        ) : (
          acts.map((act) => (
            <div key={act.id} className="act-card" onClick={() => navigate(`/dashboard/acts/${act.id}`)}>
              <div className="act-card-head">
                <span className="act-card-title">{act.title} - {act.jurisdiction}</span>
                <span className="act-card-number">Act {act.actNumber} of {act.actYear}</span>
              </div>
              {act.description && <p className="act-card-desc">Description : {shortDescription(act.description)}</p>}
              <div className="act-card-meta">
                {act.ministry && <span><strong>Ministry</strong> : {act.ministry}</span>}
                {act.department && <span><strong>Department</strong> : {act.department}</span>}
                {act.enactmentDate && <span><strong>Enactment Date</strong> : {formatDate(act.enactmentDate)}</span>}
              </div>
            </div>
          ))
        )}
      </div>

      {totalElements > 0 && (
        <Paginator
          first={page * size}
          rows={size}
          totalRecords={totalElements}
          rowsPerPageOptions={[10, 20, 50, 100]}
          onPageChange={(e) => {
            if (e.rows !== size) { setSize(e.rows); setPage(0); } else setPage(e.page);
          }}
        />
      )}
    </div>
  );
}
