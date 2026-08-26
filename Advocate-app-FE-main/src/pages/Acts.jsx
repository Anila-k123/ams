import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { FiSearch } from "react-icons/fi";
import Pagination from "../components/Pagination";
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
  const [field, setField] = useState("all");
  const [jurisdiction, setJurisdiction] = useState("");
  const [acts, setActs] = useState([]);
  const [totalPages, setTotalPages] = useState(0);
  const [totalElements, setTotalElements] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { page, setPage, size, setSize } = usePagination({
    defaultSize: 20, resetOn: [query, field, jurisdiction],
  });

  const fetchActs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, size, field };
      if (query.trim()) params.q = query.trim();
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
  }, [page, size, query, field, jurisdiction]);

  useEffect(() => { fetchActs(); }, [fetchActs]);

  return (
    <div className="acts-container">
      <h2>Acts</h2>

      <div className="acts-search-bar">
        <FiSearch className="acts-search-icon" />
        <input
          type="text"
          placeholder="Search Bare Acts"
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

      {error && <p className="error-message">{error}</p>}

      <div className="acts-list">
        {loading ? (
          <InlineLoader type="card" count={6} />
        ) : acts.length === 0 ? (
          <p className="no-data">No acts found.</p>
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
