import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api, { errorMessage } from "../api/client";
import { useToast } from "../contexts/ToastContext";
import { Button, Chip, EmptyState, Icon, Skel, Spinner } from "../ui/kit";
import { SelectField, SearchInput, Tabs } from "../ui/forms";
import { Modal, confirm } from "../ui/overlays";
import "../ui/pages/research.css";

function formatDate(iso: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
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

// One section: a pp-acc accordion whose body is fetched lazily on first open.
function SectionRow({ actId, section }: { actId: any; section: any }) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const onToggle = async (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (!e.currentTarget.open || detail || loading) return;
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
  };

  return (
    <details className="pp-acc" onToggle={onToggle}>
      <summary>
        <Icon name="chevron" size="sm" className="chev" />
        <span className="mono small nowrap">Sec. {section.number}</span>
        <span className="small" style={{ fontWeight: 500 }}>{section.title}</span>
      </summary>
      <div className="rs-sec-body">
        {loading && <Spinner />}
        {error && <div className="callout bad"><Icon name="warn" size="sm" /><div>{error}</div></div>}
        {detail && (
          <>
            {detail.content ? (
              <div dangerouslySetInnerHTML={{ __html: sanitizeActHtml(detail.content) }} />
            ) : (
              <p className="faint">No digitised text available for this section.</p>
            )}
            {detail.footnote && (
              <>
                <div className="rs-sec-label">Footnotes</div>
                <div className="small" dangerouslySetInnerHTML={{ __html: sanitizeActHtml(detail.footnote) }} />
              </>
            )}
          </>
        )}
      </div>
    </details>
  );
}

type TabKey = "sections" | "papers" | "cases";

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
  const { success, error: toastError } = useToast() as any;
  const [act, setAct] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<TabKey>("sections");
  const [descOpen, setDescOpen] = useState(false);
  const [secQuery, setSecQuery] = useState("");

  // Cases Linked tab
  const [linkedCases, setLinkedCases] = useState<any[] | null>(null); // null = not loaded yet
  const [linkedCasesLoading, setLinkedCasesLoading] = useState(false);
  const [linkedCasesError, setLinkedCasesError] = useState("");

  // Link Cases dialog
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [myCases, setMyCases] = useState<any[]>([]);
  const [myCasesLoading, setMyCasesLoading] = useState(false);
  const [selectedCase, setSelectedCase] = useState<any>(""); // case id
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
    setSelectedCase("");
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
    if (!selectedCase) { setLinkError("Choose the case to link."); return; }
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

  const unlinkCase = (lc: any) => {
    confirm({
      title: "Unlink this case?",
      message: `${lc.caseNumber || lc.caseTitle || "This case"} will no longer list this act. You can link it again later.`,
      confirmLabel: "Unlink",
      danger: true,
      accept: async () => {
        try {
          await api.delete(`/api/acts/${id}/cases/${lc.caseId}`);
          await Promise.all([fetchAct(), loadLinkedCases()]);
        } catch (err) {
          toastError(errorMessage(err, "Couldn't unlink this case."));
        }
      },
    });
  };

  if (loading) {
    return (
      <div className="stack">
        <div className="panel"><div className="panel-body stack"><Skel h={14} w="25%" /><Skel h={28} w="60%" /><Skel h={12} /><Skel h={12} w="80%" /></div></div>
        <Skel h={320} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="panel">
        <EmptyState icon="book" title="This act could not be opened" text={error}
          action={<Link className="btn" to="/dashboard/acts">Back to Bare Acts</Link>} />
      </div>
    );
  }
  if (!act) return null;

  const summary = act.description ? cleanSummary(act.description, act.title) : "";
  const central = String(act.jurisdiction || "").toUpperCase() === "CENTRAL";
  const sections: any[] = act.sections || [];
  const sq = secQuery.trim().toLowerCase().replace(/^(sec\.?|section)\s*/, "");
  const shownSections = sq
    ? sections.filter((s) => String(s.number).toLowerCase().includes(sq) || String(s.title || "").toLowerCase().includes(sq))
    : sections;

  return (
    <div>
      <nav className="crumbs small" aria-label="Breadcrumb" style={{ marginBottom: 10 }}>
        <Link className="link" to="/dashboard/acts">Bare Acts</Link>
      </nav>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-body" style={{ padding: 24 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <Chip tone={central ? "info" : "tape"}>{central ? "Central" : act.jurisdiction}</Chip>
            <span className="mono faint small">Act {act.actNumber} of {act.actYear}</span>
            {act.repealed && <Chip tone="bad">Repealed</Chip>}
          </div>
          <div className="row between wrap" style={{ alignItems: "flex-start", gap: 16, marginTop: 8 }}>
            <h1 style={{ fontSize: "var(--t-2xl)", maxWidth: "30ch" }}>{act.title}</h1>
            <div className="row wrap">
              {act.pdfUrl && (
                <a className="btn" href={act.pdfUrl} target="_blank" rel="noreferrer"><Icon name="file" size="sm" />View PDF</a>
              )}
              <Button variant="primary" icon="link" onClick={openLinkModal}>Link to a case</Button>
            </div>
          </div>
          {summary && (
            <>
              <p className={`muted${descOpen ? "" : " pp-clamp"}`} style={{ marginTop: 10, maxWidth: "75ch" }}>{summary}</p>
              {/* Only offer the toggle when there is more than a line to show. */}
              {summary.length > 120 && (
                <button type="button" className="link small" aria-expanded={descOpen}
                  style={{ background: "none", border: 0, padding: 0, marginTop: 4 }}
                  onClick={() => setDescOpen((v) => !v)}>{descOpen ? "Show less" : "Show more"}</button>
              )}
            </>
          )}
          <dl className="kv" style={{ marginTop: 16 }}>
            {act.ministry && <><dt>Ministry</dt><dd>{act.ministry}</dd></>}
            {act.department && <><dt>Department</dt><dd>{act.department}</dd></>}
            {act.enactmentDate && <><dt>Enactment date</dt><dd>{formatDate(act.enactmentDate)}</dd></>}
            {act.enforcementDate && <><dt>Enforcement date</dt><dd>{act.enforcementDate}</dd></>}
            <dt>Sections</dt><dd className="num">{sections.length}</dd>
          </dl>
        </div>
      </div>

      <Tabs<TabKey> label="Act" value={tab} onChange={setTab} tabs={[
        { value: "sections", label: "Sections", count: sections.length || undefined },
        { value: "papers", label: "Act papers", count: act.papers?.length || undefined },
        { value: "cases", label: "Cases linked", count: act.caseLinksCount ?? 0 },
      ]} />

      {tab === "sections" && (
        <div className="tab-panel">
          {!sections.length ? (
            <div className="panel"><EmptyState icon="book" title="No sections found for this act" /></div>
          ) : (
            <div className={act.noOfChapter > 0 && act.chapters?.length ? "split left-rail" : ""}>
              {act.noOfChapter > 0 && act.chapters?.length > 0 && (
                <div className="panel" style={{ padding: "6px 0" }}>
                  <div className="faint xs" style={{ padding: "8px 20px 4px" }}>Chapters</div>
                  <ul className="rs-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                    {act.chapters.map((c: any) => (
                      <li key={c.id} className="list-item small"><span className="mono faint">{c.number}</span><span className="grow">{c.title}</span></li>
                    ))}
                  </ul>
                </div>
              )}
              <div>
                <div className="toolbar">
                  <SearchInput value={secQuery} onChange={setSecQuery} placeholder="Find a section by number or heading" />
                  {sq && <span className="faint small">{shownSections.length} of {sections.length}</span>}
                </div>
                {shownSections.length ? shownSections.map((s) => <SectionRow key={s.id} actId={act.id} section={s} />)
                  : <div className="panel"><EmptyState icon="search" title="No section matches" text="Check the section number, or search the heading." /></div>}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "papers" && (
        <div className="tab-panel">
          {!act.papers?.length ? (
            <div className="panel"><EmptyState icon="file" title="No act papers for this act" /></div>
          ) : (
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th scope="col">Type</th><th scope="col">Title</th><th scope="col">Date</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {act.papers.map((p: any) => (
                    <tr key={p.id}>
                      <td><Chip tone="info">{p.paperType}</Chip></td>
                      <td>{p.title}</td>
                      <td className="num nowrap">{formatDate(p.paperDate) || "—"}</td>
                      <td className="right">
                        {p.pdfUrl && <a className="btn ghost sm" href={p.pdfUrl} target="_blank" rel="noreferrer" aria-label={`PDF of ${p.title}`}><Icon name="download" size="sm" />PDF</a>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "cases" && (
        <div className="tab-panel">
          <div className="panel">
            {linkedCasesLoading ? (
              <div className="panel-body"><Spinner /></div>
            ) : linkedCasesError ? (
              <div className="panel-body"><div className="callout bad"><Icon name="warn" size="sm" /><div>{linkedCasesError}</div></div></div>
            ) : !linkedCases?.length ? (
              <EmptyState icon="link" title="No cases linked yet" text="Link this act to a case so it shows up in the case file."
                action={<Button size="sm" icon="link" onClick={openLinkModal}>Link to a case</Button>} />
            ) : (
              linkedCases.map((lc) => (
                <div key={lc.id} className="list-item">
                  <Icon name="case" size="sm" />
                  <div className="grow">
                    <button type="button" className="link mono" style={{ background: "none", border: 0, padding: 0 }}
                      onClick={() => navigate(`/dashboard/cases/${lc.caseId}`)}>
                      {lc.caseNumber || `Case #${lc.caseId}`}
                    </button>
                    {lc.caseTitle && <div className="faint xs">{lc.caseTitle}</div>}
                  </div>
                  <span className="faint xs hide-sm">Linked {formatDate(lc.linkedAt)}</span>
                  <Button variant="ghost" size="sm" icon="x" aria-label={`Unlink ${lc.caseNumber || lc.caseTitle || "case"}`}
                    onClick={() => unlinkCase(lc)}>Unlink</Button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <Modal open={showLinkModal} onClose={() => setShowLinkModal(false)} size="narrow"
        title="Link to a case" sub={act.title}
        footer={<>
          <Button variant="ghost" onClick={() => setShowLinkModal(false)}>Cancel</Button>
          <Button variant="primary" loading={linking} disabled={linking} onClick={confirmLink}>Link act</Button>
        </>}>
        <SelectField label="Case" required value={selectedCase}
          onChange={(e) => { setSelectedCase(e.target.value); setLinkError(""); }}
          placeholder={myCasesLoading ? "Loading your cases…" : "Select a case"}
          disabled={myCasesLoading}
          options={myCases.map((c) => ({ value: c.id, label: `${c.caseNumber} — ${c.caseTitle}` }))}
          error={linkError || undefined} />
      </Modal>
    </div>
  );
}
