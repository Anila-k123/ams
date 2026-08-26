import React, { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { FiChevronLeft } from "react-icons/fi";
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
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
}

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

export default function ActDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [act, setAct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("sections");

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
        </div>

        <div className="act-detail-body">
          <div>
            <h2 className="act-detail-title">{act.title}</h2>
            {act.description && <p className="act-detail-desc">{act.description}</p>}
          </div>
          <div className="act-detail-meta">
            {act.department && <div><strong>Department</strong> : {act.department}</div>}
            {act.ministry && <div><strong>Ministry</strong> : {act.ministry}</div>}
            {act.enactmentDate && <div><strong>Enactment Date</strong> : {formatDate(act.enactmentDate)}</div>}
            {act.enforcementDate && <div><strong>Enforcement Date</strong> : {act.enforcementDate}</div>}
            {act.repealed && <div className="act-repealed-flag">Repealed</div>}
          </div>
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
            <p className="no-data">Act Papers aren't available yet.</p>
          )}

          {tab === "cases" && (
            <p className="no-data">Linking cases to acts isn't available yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
