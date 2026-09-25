import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { Dialog } from "primereact/dialog";
import { TabView, TabPanel } from "primereact/tabview";
import { Tag } from "primereact/tag";
import { Badge } from "primereact/badge";
import { ProgressSpinner } from "primereact/progressspinner";
import { Message } from "primereact/message";
import api, { errorMessage } from "../api/client";
import { useToast } from "../contexts/ToastContext";
import "../assets/styles/Acts.css";

function formatDate(iso: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short", year: "numeric" });
}

// Section content/footnote come from India Code as light HTML. Strip anything
// that isn't inert markup before handing it to dangerouslySetInnerHTML.
function sanitizeActHtml(html: string) {
  if (!html) return "";
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*(?:"(?:javascript|data):[^"]*"|'(?:javascript|data):[^']*')/gi, "");
}

const Spinner = () => (
  <div className="flex justify-content-center p-3"><ProgressSpinner style={{ width: 32, height: 32 }} strokeWidth="5" /></div>
);

// One section row: expands in place, body fetched lazily on first open.
function SectionRow({ actId, section }: { actId: any; section: any }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !detail && !loading) {
      setLoading(true);
      try {
        const res = await api.get(`/api/acts/${actId}/sections/${section.id}`);
        setDetail(res.data);
        setError("");
      } catch (err) {
        setError(errorMessage(err, "Couldn't load this section."));
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="act-section-row">
      <button type="button" className="act-section-link" onClick={toggle}>
        <i className={`pi ${open ? "pi-chevron-down" : "pi-chevron-right"} mr-2`} style={{ fontSize: 11 }} />
        Section {section.number} : {section.title}
      </button>
      {open && (
        <div className="act-section-body">
          {loading && <Spinner />}
          {error && <Message severity="error" text={error} />}
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

const TABS = ["sections", "papers", "cases"];

// Drop the "Summary of <title>" restatement at the start of India Code abstracts.
function cleanSummary(text: string, title: string) {
  if (!text) return "";
  const out = String(text).replace(/\s+/g, " ").trim();
  const t = (title || "").replace(/\s+/g, " ").trim();
  if (t) {
    const lower = out.toLowerCase();
    for (const prefix of ["summary of the " + t.toLowerCase(), "summary of " + t.toLowerCase()]) {
      if (lower.startsWith(prefix)) {
        return out.slice(prefix.length).replace(/^[\s:,.-]+/, "").trim();
      }
    }
  }
  return out.replace(/^summary(\s+of(\s+the)?)?[\s:,.-]+/i, "").trim();
}

export default function ActDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { success } = useToast() as any;
  const [act, setAct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("sections");
  const [descOpen, setDescOpen] = useState(false);

  // Cases Linked tab
  const [linkedCases, setLinkedCases] = useState<any[] | null>(null); // null = not loaded yet
  const [linkedCasesLoading, setLinkedCasesLoading] = useState(false);
  const [linkedCasesError, setLinkedCasesError] = useState("");

  // Link Cases dialog
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [myCases, setMyCases] = useState<any[]>([]);
  const [myCasesLoading, setMyCasesLoading] = useState(false);
  const [selectedCase, setSelectedCase] = useState<any>(null); // case id
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState("");

  const fetchAct = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/api/acts/${id}`);
      setAct(res.data);
      setError("");
    } catch (err) {
      setError(errorMessage(err, "Couldn't load this act."));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchAct(); }, [fetchAct]);

  const loadLinkedCases = useCallback(async () => {
    setLinkedCasesLoading(true);
    try {
      const res = await api.get(`/api/acts/${id}/cases`);
      setLinkedCases(res.data || []);
      setLinkedCasesError("");
    } catch (err) {
      setLinkedCasesError(errorMessage(err, "Couldn't load linked cases."));
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
        const res = await api.get("/api/cases/my-cases");
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
      await api.post(`/api/acts/${id}/cases`, { caseId: selectedCase });
      setShowLinkModal(false);
      await Promise.all([fetchAct(), loadLinkedCases()]);
      success("Case linked to this Act.");
    } catch (err) {
      setLinkError(errorMessage(err, "Couldn't link this case."));
    } finally {
      setLinking(false);
    }
  };

  const unlinkCase = async (caseId: any) => {
    try {
      await api.delete(`/api/acts/${id}/cases/${caseId}`);
      await Promise.all([fetchAct(), loadLinkedCases()]);
    } catch { /* leave the row - user can retry */ }
  };

  if (loading) return <div className="acts-container"><Spinner /></div>;
  if (error) return <div className="acts-container"><Message severity="error" text={error} /></div>;
  if (!act) return null;

  const tabHeader = (label: string, count?: number | null) => (
    <span className="flex align-items-center gap-2">
      {label}
      {count != null && <Badge value={count} severity="secondary" />}
    </span>
  );

  const summary = act.description ? cleanSummary(act.description, act.title) : "";

  return (
    <div className="acts-container">
      <Button text icon="pi pi-chevron-left" label="Back to Acts" className="mb-2" onClick={() => navigate("/dashboard/acts")} />

      <div className="act-detail-card">
        <div className="flex align-items-center gap-2 flex-wrap mb-3">
          <Tag value={act.jurisdiction} />
          <Tag severity="secondary" value={`Act ${act.actNumber} of ${act.actYear}`} />
          {act.pdfUrl && (
            <a className="ml-auto p-button p-button-sm p-button-outlined no-underline" href={act.pdfUrl} target="_blank" rel="noreferrer">
              <i className="pi pi-file-pdf mr-2" /> View PDF
            </a>
          )}
        </div>

        <div className="act-detail-body">
          <div>
            <h2 className="act-detail-title">{act.title}</h2>
            {summary && (
              <div className="act-detail-summary">
                <p className={`act-detail-desc${descOpen ? " open" : ""}`}>{summary}</p>
                {/* Only offer the toggle when there is more than a line to show. */}
                {summary.length > 120 && (
                  <Button link size="small" className="p-0" aria-expanded={descOpen}
                    label={descOpen ? "Show less" : "Show more"} onClick={() => setDescOpen((v) => !v)} />
                )}
              </div>
            )}
          </div>
          <div className="act-detail-meta">
            {act.department && <div><strong>Department</strong> : {act.department}</div>}
            {act.ministry && <div><strong>Ministry</strong> : {act.ministry}</div>}
            {act.enactmentDate && <div><strong>Enactment Date</strong> : {formatDate(act.enactmentDate)}</div>}
            {act.enforcementDate && <div><strong>Enforcement Date</strong> : {act.enforcementDate}</div>}
            {act.repealed && <Tag severity="danger" value="Repealed" />}
          </div>
        </div>

        <div className="flex justify-content-end my-2">
          <Button icon="pi pi-link" label="Link Cases" onClick={openLinkModal} />
        </div>

        <TabView activeIndex={TABS.indexOf(tab)} onTabChange={(e) => setTab(TABS[e.index])}>
          <TabPanel header={tabHeader("Sections", act.sections?.length > 0 ? act.sections.length : null)}>
            {act.noOfChapter > 0 && act.chapters?.length ? (
              <div className="act-sections-grid">
                <div className="act-chapters-col">
                  {act.chapters.map((c: any) => (
                    <div key={c.id} className="act-chapter-item">Chapter {c.number}: {c.title}</div>
                  ))}
                </div>
                <div className="act-sections-col">
                  {act.sections.map((s: any) => <SectionRow key={s.id} actId={act.id} section={s} />)}
                </div>
              </div>
            ) : act.sections?.length ? (
              <div className="act-sections-col">
                {act.sections.map((s: any) => <SectionRow key={s.id} actId={act.id} section={s} />)}
              </div>
            ) : (
              <p className="no-data">No sections found for this act.</p>
            )}
          </TabPanel>

          <TabPanel header={tabHeader("Act Papers", act.papers?.length > 0 ? act.papers.length : null)}>
            {!act.papers?.length ? (
              <p className="no-data">No Act Papers found for this act.</p>
            ) : (
              <div className="act-list-rows">
                {act.papers.map((p: any) => (
                  <div key={p.id} className="act-list-row">
                    <Tag severity="info" value={p.paperType} />
                    {p.pdfUrl ? (
                      <a className="act-section-link" href={p.pdfUrl} target="_blank" rel="noreferrer">{p.title}</a>
                    ) : (
                      <span className="act-papers-title">{p.title}</span>
                    )}
                    <span className="act-row-date">{formatDate(p.paperDate)}</span>
                  </div>
                ))}
              </div>
            )}
          </TabPanel>

          <TabPanel header={tabHeader("Cases Linked", act.caseLinksCount ?? 0)}>
            {linkedCasesLoading ? (
              <Spinner />
            ) : linkedCasesError ? (
              <Message severity="error" text={linkedCasesError} />
            ) : !linkedCases?.length ? (
              <p className="no-data">No cases linked to this act yet.</p>
            ) : (
              <div className="act-list-rows">
                {linkedCases.map((lc) => (
                  <div key={lc.id} className="act-list-row">
                    <button type="button" className="act-section-link" onClick={() => navigate(`/dashboard/cases/${lc.caseId}`)}>
                      {lc.caseTitle || lc.caseNumber || `Case #${lc.caseId}`}
                    </button>
                    <span className="act-row-date">{formatDate(lc.linkedAt)}</span>
                    <Button icon="pi pi-trash" text rounded severity="danger" size="small" tooltip="Unlink"
                      aria-label="Unlink" onClick={() => unlinkCase(lc.caseId)} />
                  </div>
                ))}
              </div>
            )}
          </TabPanel>
        </TabView>
      </div>

      <Dialog
        header="Link a Case"
        visible={showLinkModal}
        onHide={() => setShowLinkModal(false)}
        style={{ width: "32rem" }}
        breakpoints={{ "640px": "95vw" }}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button text label="Cancel" onClick={() => setShowLinkModal(false)} />
            <Button label={linking ? "Linking…" : "Link Case"} loading={linking} disabled={!selectedCase || linking} onClick={confirmLink} />
          </div>
        }
      >
        <p className="act-link-modal-hint">Choose one of your cases to link to this act.</p>
        <Dropdown
          className="w-full"
          value={selectedCase}
          options={myCases.map((c) => ({ value: c.id, label: `${c.caseNumber} — ${c.caseTitle}` }))}
          onChange={(e) => setSelectedCase(e.value)}
          placeholder={myCasesLoading ? "Loading your cases…" : "Select a case"}
          loading={myCasesLoading}
          filter
          showClear
        />
        {linkError && <small className="block mt-2" style={{ color: "var(--danger)" }}>{linkError}</small>}
      </Dialog>
    </div>
  );
}
