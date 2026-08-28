import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { FiSearch } from "react-icons/fi";
import Pagination from "../components/Pagination";
import useDebouncedValue from "../hooks/useDebouncedValue";
import usePagination from "../hooks/usePagination";
import { InlineLoader } from "../components/Loader";
import "../assets/styles/Acts.css";

const FIELD_CHIPS = [
  ["all", "All"],
  ["short_title", "Short Title"],
  ["long_title", "Long Title"],
  ["department", "Department Name"],
  ["section_title", "Section Title"],
  ["section_contents", "Section Contents"],
  ["act_number", "Act Number"],
  ["act_year", "Act Year"],
];

// Only what's actually been imported so far (Central + Tamil Nadu) - see
// acts-importer's README for the current jurisdiction list.
const JURISDICTIONS = [
  ["", "All jurisdictions"],
  ["CENTRAL", "Central Acts"],
  ["Tamil Nadu", "Tamil Nadu"],
];

// What the search box should ask for, per chip. One generic "Search Bare Acts"
// gave no clue that Act Year wants a year, so selecting that chip with a word
// in the box returned nothing and looked broken.
const FIELD_PLACEHOLDERS = {
  all: "Search Bare Acts",
  short_title: "Search the short title, e.g. Anna University Act",
  long_title: "Search the long title",
  department: "Search the department, e.g. Higher Education",
  section_title: "Search section headings, e.g. Definitions",
  section_contents: "Search inside section text, e.g. vice-chancellor",
  act_number: "Search the act number, e.g. 26",
  act_year: "Year (2015) or range (2010-2015)",
};

// Mirrors the backend's year parsing so the page can explain an unusable year
// itself rather than showing an unexplained empty list.
const YEAR_RE = /^\d{4}$/;
const YEAR_RANGE_RE = /^(\d{4})\s*(?:-|–|to)\s*(\d{4})$/i;

function yearQueryProblem(raw) {
  const v = (raw || "").trim();
  if (!v) return null;                       // empty is fine: shows everything
  if (YEAR_RE.test(v) || YEAR_RANGE_RE.test(v)) return null;
  return /^\d+$/.test(v)
    ? `"${v}" is not a four-digit year.`
    : `"${v}" is not a year.`;
}

function authHeaders() {
  const token = localStorage.getItem("token");
  return { headers: { Authorization: `Bearer ${token}` } };
}

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// India Code's "abstract" field ranges from a short one-line purpose
// statement to a full multi-section AI-generated summary (Objectives / Key
// Provisions / Significance / Conclusion, bullet points and all) depending
// on the act - not something we control at the source. Keep the card compact
// regardless by cutting to one short line at a word boundary.
function shortDescription(text, max = 140) {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return clean.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

export default function Acts() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  // The input updates on every keystroke; the request waits until typing stops.
  // Section Contents searches ~28k section bodies, so a request per character
  // was both slow and prone to out-of-order replies.
  const debouncedQuery = useDebouncedValue(query, 300);
  const [field, setField] = useState("all");
  const [jurisdiction, setJurisdiction] = useState("");
  const [acts, setActs] = useState([]);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Declared after `field` and `query`: reading either above their useState
  // calls is a temporal-dead-zone crash, not a lint nit.
  // Explained as soon as it is typed, not after the round trip: the request is
  // debounced, so waiting for the response would leave the message lagging.
  const yearProblem = field === "act_year" ? yearQueryProblem(query) : null;
  const { page, setPage, size, setSize } = usePagination({
    defaultSize: 20, resetOn: [debouncedQuery, field, jurisdiction],
  });

  const fetchActs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, size, field };
      if (debouncedQuery.trim()) params.q = debouncedQuery.trim();
      if (jurisdiction) params.jurisdiction = jurisdiction;
      const res = await axios.get("/api/acts", { ...authHeaders(), params });
      setActs(res.data.content || []);
      setTotalPages(res.data.totalPages || 0);
      setTotalElements(res.data.totalElements || 0);
      setError("");
    } catch (err) {
      setError(err?.response?.data?.error || "Failed to load acts.");
    } finally {
      setLoading(false);
    }
  }, [page, size, debouncedQuery, field, jurisdiction]);

  useEffect(() => { fetchActs(); }, [fetchActs]);

  return (
    <div className="acts-container">
      <h2>Acts</h2>

      <div className="acts-search-bar">
        <FiSearch className="acts-search-icon" />
        <input
          type="text"
          placeholder={FIELD_PLACEHOLDERS[field] || "Search Bare Acts"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
          {JURISDICTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>

      <div className="acts-field-chips">
        {FIELD_CHIPS.map(([v, l]) => (
          <label key={v} className={field === v ? "active" : ""}>
            <input type="radio" name="actsField" checked={field === v} onChange={() => setField(v)} />
            {l}
          </label>
        ))}
      </div>

      {/* Shown while typing, so the year format is corrected before the user
          waits for an empty result to explain it. */}
      {yearProblem && (
        <p className="acts-filter-warning">
          {yearProblem} Enter a year like <code>2015</code> or a range like{" "}
          <code>2010-2015</code>.
        </p>
      )}

      {error && <p className="error-message">{error}</p>}

      <div className="acts-list">
        {loading ? (
          <InlineLoader type="card" count={6} />
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

      <Pagination
        page={page} totalPages={totalPages} totalElements={totalElements}
        size={size} onPageChange={setPage} onSizeChange={setSize}
      />
    </div>
  );
}
