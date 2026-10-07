import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { useToast } from "../contexts/ToastContext";
import { Icon, Chip, PageHead, EmptyState, Skel, titleCase } from "../ui/kit";
import { DataTable, type Column } from "../ui/DataTable";
import "../ui/pages/court.css";

// Appeal Alert is entirely automatic: the nightly scan_appeals sweep reads each
// decided case, works out which higher court would hear an appeal, and searches
// it by party name. Nothing here computes a limitation period - a confidently
// wrong date would be worse than none.
const STATUS_TONE: Record<string, "ok" | "warn" | ""> = { CONFIRMED: "ok", NEW: "warn", DISMISSED: "" };
const fdate = (s?: string) => {
  if (!s) return "—";
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

function AppealAlert() {
  const [detections, setDetections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<any>(null);
  const { success, error } = useToast() as any;

  const fetchDetections = useCallback(async () => {
    try {
      const res = await api.get("/api/appeal-detections");
      setDetections(res.data || []);
    } catch {
      error("Couldn't load detected appeals.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetchDetections();
  }, [fetchDetections]);

  const setDetectionStatus = async (id: any, status: string) => {
    setBusyId(id);
    try {
      await api.put(`/api/appeal-detections/${id}`, { status });
      success(status === "CONFIRMED" ? "Marked as a real appeal. Check the limitation and file your appearance."
        : status === "DISMISSED" ? "Dismissed as unrelated. You can restore it below." : "Restored to the review list.");
      fetchDetections();
    } catch {
      error("Couldn't update that detection.");
    } finally {
      setBusyId(null);
    }
  };

  const open = detections.filter((d) => d.status !== "DISMISSED");
  const dismissed = detections.filter((d) => d.status === "DISMISSED");
  const nNew = open.filter((d) => d.status === "NEW").length;

  const yourCase = (d: any) => d.sourceCaseId
    ? <Link className="mono link" to={`/dashboard/cases/${d.sourceCaseId}`}>{d.sourceCaseNumber || "—"}</Link>
    : <span className="mono">{d.sourceCaseNumber || "—"}</span>;

  const columns: Column<any>[] = [
    { key: "source", label: "Your case", sort: (d) => d.sourceCaseNumber || "", render: (d) => <>{yourCase(d)}{d.sourceCaseTitle && <div className="cell-sub">{d.sourceCaseTitle}</div>}</> },
    { key: "appeal", label: "Appeal found", render: (d) => d.appealCaseNumber ? <span className="mono">{d.appealCaseNumber}</span> : <span className="faint">(number not listed)</span> },
    { key: "forum", label: "Forum", sort: (d) => d.forum || d.forumCourtId || "", hideSm: true, render: (d) => d.forum || d.forumCourtId || "—" },
    { key: "parties", label: "Parties", hideSm: true, render: (d) => <span className="small">{d.appealParties || "—"}</span> },
    { key: "filed", label: "Filed", sort: (d) => d.appealFiledOn || "", hideSm: true, render: (d) => <span className="nowrap">{fdate(d.appealFiledOn)}</span> },
    {
      key: "matched", label: "Matched", sort: (d) => d.matchedOn || "",
      render: (d) => {
        const score = typeof d.matchScore === "number" ? Math.round(d.matchScore * 100) : null;
        return (
          <>
            <div className="small nowrap">{fdate(d.matchedOn)}</div>
            {score != null && (
              <div className="pp-score" title={`Match score ${score} of 100`}>
                <div className="bar-track"><i style={{ width: `${score}%`, background: score >= 80 ? "var(--ink)" : "var(--ink-3)" }} /></div>
                <span className="mono xs">{score}</span>
              </div>
            )}
          </>
        );
      },
    },
    { key: "status", label: "Status", sort: true, render: (d) => <Chip tone={STATUS_TONE[d.status] ?? "info"}>{d.status === "NEW" ? "New" : titleCase(d.status)}</Chip> },
    {
      key: "act", label: <span className="sr-only">Actions</span>, className: "actions",
      render: (d) => (
        <div className="row court-acts">
          {d.status !== "CONFIRMED" && (
            <button type="button" className="btn sm primary" disabled={busyId === d.id} onClick={() => setDetectionStatus(d.id, "CONFIRMED")}>It's an appeal</button>
          )}
          <button type="button" className="btn sm ghost" disabled={busyId === d.id} onClick={() => setDetectionStatus(d.id, "DISMISSED")}>Not related</button>
        </div>
      ),
    },
  ];

  return (
    <div className="court">
      <PageHead title="Appeal Alerts"
        sub="Appeals filed in higher courts against your decided cases, found by the nightly court-record check. Verify before acting; no limitation period is calculated." />

      {loading ? (
        <div className="panel"><div className="panel-body stack"><Skel h={36} /><Skel h={36} /><Skel h={36} /></div></div>
      ) : (
        <>
          {nNew === 0 && (
            <div className="panel court-gap-b">
              <EmptyState icon="ok" title="No new appeals to review"
                text={open.length ? "The nightly check found nothing new. Confirmed matches stay listed below." : "No appeals have been detected against your decided cases."} />
            </div>
          )}
          {open.length > 0 && (
            <>
              <div className="callout info court-gap-b"><Icon name="info" size="sm" /><div>Candidates matched from the court record by party name. Verify before acting.</div></div>
              <DataTable rows={open} columns={columns} rowKey={(d) => d.id} initialSort={{ key: "matched", dir: "desc" }}
                rowClass={(d) => (d.status === "NEW" ? "hl" : undefined)}
                empty={{ icon: "alert", title: "No appeals found", text: "Matches from the nightly check appear here." }} />
            </>
          )}

          <section className="panel court-gap-t">
            <div className="panel-head"><h3>Dismissed as unrelated</h3><span className="sub">{dismissed.length}</span></div>
            <div className={`panel-body${dismissed.length ? " flush" : ""}`}>
              {dismissed.length ? (
                <div className="list">
                  {dismissed.map((d) => (
                    <div className="list-item" key={d.id}>
                      <div className="grow court-min0">
                        <div className="small"><span className="mono">{d.appealCaseNumber || "(number not listed)"}</span> <span className="faint">{d.forum || d.forumCourtId}</span></div>
                        <div className="faint xs">{d.appealParties ? `${d.appealParties}. ` : ""}Matched to <span className="mono">{d.sourceCaseNumber || "—"}</span></div>
                      </div>
                      <button type="button" className="btn sm" disabled={busyId === d.id} onClick={() => setDetectionStatus(d.id, "NEW")}>
                        <Icon name="restore" size="sm" />Restore
                      </button>
                    </div>
                  ))}
                </div>
              ) : <p className="muted small">Nothing dismissed. Dismissed matches are kept so the nightly check does not report them again.</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default AppealAlert;
