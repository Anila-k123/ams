import React, { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import Select from "react-select";
import { FiChevronLeft, FiX, FiTrash2 } from "react-icons/fi";
import { InlineLoader } from "../components/Loader";
import "../assets/styles/Acts.css";

function authHeaders() {
  const token = localStorage.getItem("token");
  return { headers: { Authorization: `Bearer ${token}` } };
}

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
}

const customSelectStyles = {
  control: (base, state) => ({
    ...base,
    backgroundColor: "var(--bg-primary)",
    borderColor: state.isFocused ? "var(--accent)" : "var(--border-color)",
    color: "var(--text-primary)",
    borderRadius: "8px",
    boxShadow: "none",
  }),
  menu: (base) => ({
    ...base,
    backgroundColor: "var(--bg-secondary)",
    border: "1px solid var(--border-color)",
    zIndex: 9999,
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected ? "var(--accent)" : state.isFocused ? "var(--border-color)" : "transparent",
    color: state.isSelected ? "#fff" : "var(--text-primary)",
    cursor: "pointer",
  }),
  singleValue: (base) => ({ ...base, color: "var(--text-primary)" }),
  placeholder: (base) => ({ ...base, color: "var(--text-muted)" }),
  input: (base) => ({ ...base, color: "var(--text-primary)" }),
};

// Section content/footnote come from India Code as light HTML (<span>, <hr>,
// <i>, <sup> for footnote markers) - real formatting, not something to strip
// down to plain text. Still third-party content landing in the DOM, so strip
// anything that isn't inert markup before it's ever handed to
// dangerouslySetInnerHTML: script/style tags, event-handler attributes, and
// javascript:/data: URLs.
function sanitizeActHtml(html) {
  if (!html) return "";
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*(?:"(?:javascript|data):[^"]*"|'(?:javascript|data):[^']*')/gi, "");
}

// One section row: expands in place to show Contents/Footnotes, fetched
// lazily on first open (matches the source Sections tab - titles first,
// body text only once you open one).
function SectionRow({ actId, section }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail && !loading) {
      setLoading(true);
      try {
        const res = await axios.get(`/api/acts/${actId}/sections/${section.id}`, authHeaders());
        setDetail(res.data);
        setError("");
      } catch (err) {
        setError(err?.response?.data?.error || "Couldn't load this section.");
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="act-section-row">
      <button type="button" className="act-section-link" onClick={toggle}>
        Section {section.number} : {section.title}
      </button>
      {open && (
        <div className="act-section-body">
          {loading && <InlineLoader type="spinner" />}
          {error && <p className="error-message">{error}</p>}
          {detail && (
            <>
              <div className="act-section-block-label">Contents:</div>
              {detail.content ? (
                <div className="act-section-block" dangerouslySetInnerHTML={{ __html: sanitizeActHtml(detail.content) }} />
              ) : (
                <div className="act-section-block">
                  <span className="muted-dash">No digitized text available for this section.</span>
                </div>
              )}
              <div className="act-section-block-label">Footnotes:</div>
              {detail.footnote ? (
                <div className="act-section-block" dangerouslySetInnerHTML={{ __html: sanitizeActHtml(detail.footnote) }} />
              ) : (
                <div className="act-section-block"><span className="muted-dash">—</span></div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

const TABS = [
  ["sections", "Sections"],
  ["papers", "Act Papers"],
  ["cases", "Cases Linked"],
];

// India Code's "abstract" ranges from a one-line purpose statement to a full
// multi-section AI summary. Whatever it is, it arrives as one unbroken blob
// and buried the rest of the page.
//
// Most of these summaries open by restating the act's name - "Summary of The
// Administrative Tribunals Act, 1985 Purpose ..." - directly under a heading
// that already says it. When the whole summary is collapsed to one line, that
// line has to carry something, so the restatement is dropped.
function cleanSummary(text, title) {
  if (!text) return "";
  const out = String(text).replace(/\s+/g, " ").trim();
  const t = (title || "").replace(/\s+/g, " ").trim();
  if (t) {
    // Plain prefix match rather than a regex built from the title: the title
    // is arbitrary text full of regex metacharacters (brackets, dots, the
    // occasional parenthesis), and escaping it buys nothing here.
    const lower = out.toLowerCase();
    for (const prefix of ["summary of the " + t.toLowerCase(),
                          "summary of " + t.toLowerCase()]) {
      if (lower.startsWith(prefix)) {
        return out.slice(prefix.length).replace(/^[\s:,.-]+/, "").trim();
      }
    }
  }
  // Fallback for summaries that open with "Summary" / "Summary of ..." but
  // do not restate this act's exact title.
  return out.replace(/^summary(\s+of(\s+the)?)?[\s:,.-]+/i, "").trim();
}

export default function ActDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [act, setAct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("sections");
  // The summary is collapsed to a single line by default; it is often several
  // hundred words and pushed the sections list off the screen.
  const [descOpen, setDescOpen] = useState(false);

  // Cases Linked tab
  const [linkedCases, setLinkedCases] = useState(null); // null = not loaded yet
  const [linkedCasesLoading, setLinkedCasesLoading] = useState(false);
  const [linkedCasesError, setLinkedCasesError] = useState("");

  // Link Cases modal
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [myCases, setMyCases] = useState([]);
  const [myCasesLoading, setMyCasesLoading] = useState(false);
  const [selectedCase, setSelectedCase] = useState(null);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState("");

  const fetchAct = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/acts/${id}`, authHeaders());
      setAct(res.data);
      setError("");
    } catch (err) {
      setError(err?.response?.data?.error || "Couldn't load this act.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchAct(); }, [fetchAct]);

  const loadLinkedCases = useCallback(async () => {
    setLinkedCasesLoading(true);
    try {
      const res = await axios.get(`/api/acts/${id}/cases`, authHeaders());
      setLinkedCases(res.data || []);
      setLinkedCasesError("");
    } catch (err) {
      setLinkedCasesError(err?.response?.data?.error || "Couldn't load linked cases.");
    } finally {
      setLinkedCasesLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (tab === "cases" && linkedCases === null && !linkedCasesLoading) loadLinkedCases();
  }, [tab, linkedCases, linkedCasesLoading, loadLinkedCases]);

  const openLinkModal = async () => {
    setShowLinkModal(true);
    setSelectedCase(null);
    setLinkError("");
    if (!myCases.length) {
      setMyCasesLoading(true);
      try {
        const res = await axios.get("/api/cases/my-cases", authHeaders());
        setMyCases(res.data || []);
      } catch {
        setLinkError("Couldn't load your cases.");
      } finally {
        setMyCasesLoading(false);
      }
    }
  };

  const confirmLink = async () => {
    if (!selectedCase) return;
    setLinking(true);
    try {
      await axios.post(`/api/acts/${id}/cases`, { caseId: selectedCase.value }, authHeaders());
      setShowLinkModal(false);
      await Promise.all([fetchAct(), loadLinkedCases()]);
    } catch (err) {
      setLinkError(err?.response?.data?.error || "Couldn't link this case.");
    } finally {
      setLinking(false);
    }
  };

  const unlinkCase = async (caseId) => {
    try {
      await axios.delete(`/api/acts/${id}/cases/${caseId}`, authHeaders());
      await Promise.all([fetchAct(), loadLinkedCases()]);
    } catch { /* leave the row - user can retry */ }
  };

  if (loading) return <div className="acts-container"><InlineLoader type="page" /></div>;
  if (error) return <div className="acts-container"><p className="error-message">{error}</p></div>;
  if (!act) return null;

  return (
    <div className="acts-container">
      <button type="button" className="act-back" onClick={() => navigate("/dashboard/acts")}>
        <FiChevronLeft /> Back to Acts
      </button>

      <div className="act-detail-card">
        <div className="act-detail-head">
          <span className="act-jurisdiction-badge">{act.jurisdiction}</span>
          <span className="act-number-badge">Act {act.actNumber} of {act.actYear}</span>
          {act.pdfUrl && (
            <a className="act-view-pdf-btn" href={act.pdfUrl} target="_blank" rel="noreferrer">
              View PDF
            </a>
          )}
        </div>

        <div className="act-detail-body">
          <div>
            <h2 className="act-detail-title">{act.title}</h2>
            {act.description && (() => {
              const summary = cleanSummary(act.description, act.title);
              if (!summary) return null;
              return (
                <div className="act-detail-summary">
                  <p className={`act-detail-desc${descOpen ? " open" : ""}`}>{summary}</p>
                  {/* Only offer the toggle when there is more than a line to
                      show. A "Show more" that reveals nothing is worse than
                      no button at all. */}
                  {summary.length > 120 && (
                    <button
                      type="button"
                      className="act-detail-desc-toggle"
                      aria-expanded={descOpen}
                      onClick={() => setDescOpen((v) => !v)}
                    >
                      {descOpen ? "Show less" : "Show more"}
                    </button>
                  )}
                </div>
              );
            })()}
          </div>
          <div className="act-detail-meta">
            {act.department && <div><strong>Department</strong> : {act.department}</div>}
            {act.ministry && <div><strong>Ministry</strong> : {act.ministry}</div>}
            {act.enactmentDate && <div><strong>Enactment Date</strong> : {formatDate(act.enactmentDate)}</div>}
            {act.enforcementDate && <div><strong>Enforcement Date</strong> : {act.enforcementDate}</div>}
            {act.repealed && <div className="act-repealed-flag">Repealed</div>}
          </div>
        </div>

        <div className="act-link-cases-row">
          <button type="button" className="act-link-cases-btn" onClick={openLinkModal}>Link Cases</button>
        </div>

        <div className="act-tabs">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={tab === key ? "active" : ""}
              onClick={() => setTab(key)}
            >
              {label}
              {key === "sections" && act.sections?.length > 0 && (
                <span className="act-tab-count">{act.sections.length}</span>
              )}
              {key === "papers" && act.papers?.length > 0 && (
                <span className="act-tab-count">{act.papers.length}</span>
              )}
              {key === "cases" && (
                <span className="act-tab-count">{act.caseLinksCount ?? 0}</span>
              )}
            </button>
          ))}
        </div>

        <div className="act-tab-panel">
          {tab === "sections" && (
            act.noOfChapter > 0 && act.chapters?.length ? (
              <div className="act-sections-grid">
                <div className="act-chapters-col">
                  {act.chapters.map((c) => (
                    <div key={c.id} className="act-chapter-item">Chapter {c.number}: {c.title}</div>
                  ))}
                </div>
                <div className="act-sections-col">
                  {act.sections.map((s) => <SectionRow key={s.id} actId={act.id} section={s} />)}
                </div>
              </div>
            ) : act.sections?.length ? (
              <div className="act-sections-col act-sections-col-full">
                {act.sections.map((s) => <SectionRow key={s.id} actId={act.id} section={s} />)}
              </div>
            ) : (
              <p className="no-data">No sections found for this act.</p>
            )
          )}

          {tab === "papers" && (
            !act.papers?.length ? (
              <p className="no-data">No Act Papers found for this act.</p>
            ) : (
              <div className="act-papers-list">
                {act.papers.map((p) => (
                  <div key={p.id} className="act-papers-row">
                    <span className="act-papers-type">{p.paperType}</span>
                    {p.pdfUrl ? (
                      <a className="act-section-link" href={p.pdfUrl} target="_blank" rel="noreferrer">
                        {p.title}
                      </a>
                    ) : (
                      <span className="act-papers-title">{p.title}</span>
                    )}
                    <span className="act-cases-linked-date">{formatDate(p.paperDate)}</span>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === "cases" && (
            linkedCasesLoading ? (
              <InlineLoader type="spinner" />
            ) : linkedCasesError ? (
              <p className="error-message">{linkedCasesError}</p>
            ) : !linkedCases?.length ? (
              <p className="no-data">No cases linked to this act yet.</p>
            ) : (
              <div className="act-cases-linked-list">
                {linkedCases.map((lc) => (
                  <div key={lc.id} className="act-cases-linked-row">
                    <button
                      type="button" className="act-section-link"
                      onClick={() => navigate(`/dashboard/cases/${lc.caseId}`)}
                    >
                      {lc.caseTitle || lc.caseNumber || `Case #${lc.caseId}`}
                    </button>
                    <span className="act-cases-linked-date">{formatDate(lc.linkedAt)}</span>
                    <button
                      type="button" className="act-cases-unlink-btn"
                      title="Unlink" onClick={() => unlinkCase(lc.caseId)}
                    >
                      <FiTrash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {showLinkModal && (
        <div className="modal-overlay" onClick={() => setShowLinkModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="case-docs-header">
              <h3>Link a Case</h3>
              <button className="close-btn" onClick={() => setShowLinkModal(false)}><FiX /></button>
            </div>
            <p className="act-link-modal-hint">Choose one of your cases to link to this act.</p>
            <Select
              options={myCases.map((c) => ({ value: c.id, label: `${c.caseNumber} — ${c.caseTitle}` }))}
              value={selectedCase}
              onChange={setSelectedCase}
              isLoading={myCasesLoading}
              placeholder={myCasesLoading ? "Loading your cases…" : "Select a case"}
              styles={customSelectStyles}
              isClearable
            />
            {linkError && <p className="field-error">{linkError}</p>}
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button type="button" onClick={confirmLink} disabled={!selectedCase || linking}>
                {linking ? "Linking…" : "Link Case"}
              </button>
              <button type="button" className="close-btn" onClick={() => setShowLinkModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
