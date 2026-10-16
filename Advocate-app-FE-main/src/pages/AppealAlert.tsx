import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import api from "../api/client";
import { useToast } from "../contexts/ToastContext";
import { usePermission } from "../contexts/PermissionContext";
import { Icon, Chip, PageHead, EmptyState, Skel, titleCase } from "../ui/kit";
import { DataTable, type Column } from "../ui/DataTable";
import "../ui/pages/court.css";

// Appeal Alerts (docs/APPEALS.md): every decided case and what it means for an appeal, from the order sync
// (appeals/decisions.py), plus appeals actually found in a higher court by the evening appeal check.
//   You can appeal            - decided against our client (or partly)
//   The other side may appeal - decided for our client; the higher court is watched every evening
//   Needs a look              - the court's wording is unclear, or our client's side isn't known
//   Appeals found             - candidates from the higher court (confirm / dismiss)
// No limitation period is calculated yet: that is separate, reviewed work.
const STATUS_TONE: Record<string, "ok" | "warn" | ""> = { CONFIRMED: "ok", NEW: "warn", DISMISSED: "" };
const fdate = (s?: string) => {
  if (!s) return "—";
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00`);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};
const DECISION_STATUS: Record<string, { label: string; tone: "ok" | "warn" | "info" | "" }> = {
  open: { label: "To decide", tone: "warn" },
  appealing: { label: "Appealing", tone: "info" },
  no_appeal: { label: "No appeal", tone: "" },
  watching: { label: "Watching", tone: "info" },
  watch_stopped: { label: "Not watched", tone: "" },
};

function AppealAlert() {
  const [detections, setDetections] = useState<any[]>([]);
  const [decisions, setDecisions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<any>(null);
  const { success, error } = useToast() as any;
  const { hasPermission } = usePermission() as any;
  const canEdit = hasPermission("CASE_EDIT");

  const fetchAll = useCallback(async () => {
    try {
      const [det, dec] = await Promise.all([api.get("/api/appeal-detections"), api.get("/api/appeal-decisions")]);
      setDetections(det.data || []);
      setDecisions(dec.data || []);
    } catch {
      error("Couldn't load appeal alerts.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `error` is a new function each render; load once
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const setDetectionStatus = async (id: any, status: string) => {
    setBusyId(`det${id}`);
    try {
      await api.put(`/api/appeal-detections/${id}`, { status });
      success(status === "CONFIRMED" ? "Marked as a real appeal. Check the limitation and file your appearance."
        : status === "DISMISSED" ? "Dismissed as unrelated. You can restore it below." : "Restored to the review list.");
      fetchAll();
    } catch {
      error("Couldn't update that detection.");
    } finally {
      setBusyId(null);
    }
  };

  const updateDecision = async (d: any, body: Record<string, string>, done: string) => {
    setBusyId(`dec${d.id}`);
    try {
      const res = await api.patch(`/api/appeal-decisions/${d.id}`, body);
      setDecisions((list) => list.map((x) => (x.id === d.id ? res.data : x)));
      success(done);
    } catch (e: any) {
      error(e?.response?.data?.error || "Couldn't save that.");
    } finally {
      setBusyId(null);
    }
  };

  const canAppeal = decisions.filter((d) => d.position === "lost" || d.position === "partly");
  const mayAppeal = decisions.filter((d) => d.position === "won" || d.position === "partly");
  const look = decisions.filter((d) => d.position === "look");
  const openDet = detections.filter((d) => d.status !== "DISMISSED");
  const dismissed = detections.filter((d) => d.status === "DISMISSED");
  const nNew = openDet.filter((d) => d.status === "NEW").length;

  const caseCell = (d: any) => (
    <>
      <Link className="mono link" to={`/dashboard/cases/${d.caseId}`}>{d.caseNumber || "—"}</Link>
      {(d.caseTitle || d.clientName) && <div className="cell-sub">{d.caseTitle || d.clientName}</div>}
    </>
  );
  const decidedCell = (d: any) => (
    <>
      <div className="nowrap">{fdate(d.decidedOn)}</div>
      <div className="cell-sub">{d.nature ? titleCase(String(d.nature).replace(/^[-A-Za-z]*--/, "")) : "Decided"}</div>
    </>
  );
  const statusCell = (d: any) => {
    const s = DECISION_STATUS[d.status] || { label: d.status, tone: "" as const };
    return <Chip tone={s.tone}>{s.label}</Chip>;
  };
  const busy = (d: any) => busyId === `dec${d.id}`;

  const canAppealCols: Column<any>[] = [
    { key: "case", label: "Case", sort: (d) => d.caseNumber || "", render: caseCell },
    { key: "decided", label: "Decided", sort: (d) => d.decidedOn || "", render: decidedCell },
    { key: "forum", label: "Usual next forum", hideSm: true, render: (d) => <span className="small">{d.nextForum || "—"}</span> },
    { key: "limit", label: "Limitation", hideSm: true, render: () => <span className="faint small" title="The limitation date calculation is coming next.">Coming soon</span> },
    { key: "status", label: "Status", render: statusCell },
    {
      key: "act", label: <span className="sr-only">Actions</span>, className: "actions",
      render: (d) => canEdit && (
        <div className="row court-acts">
          {d.status !== "appealing" && <button type="button" className="btn sm primary" disabled={busy(d)}
            onClick={() => updateDecision(d, { status: "appealing" }, "Marked: we will appeal. Check the limitation period before filing.")}>We will appeal</button>}
          {d.status !== "no_appeal" && <button type="button" className="btn sm ghost" disabled={busy(d)}
            onClick={() => updateDecision(d, { status: "no_appeal" }, "Marked: no appeal.")}>No appeal</button>}
        </div>
      ),
    },
  ];
  const mayAppealCols: Column<any>[] = [
    { key: "case", label: "Case", sort: (d) => d.caseNumber || "", render: caseCell },
    { key: "decided", label: "Decided", sort: (d) => d.decidedOn || "", render: decidedCell },
    { key: "watch", label: "Appeal watch", hideSm: true,
      render: (d) => d.status === "watching"
        ? <span className="small">{d.watchedAt ? `Last checked ${fdate(d.watchedAt)}` : "First check this evening"}</span>
        : <span className="faint small">Not watched</span> },
    { key: "status", label: "Status", render: statusCell },
    {
      key: "act", label: <span className="sr-only">Actions</span>, className: "actions",
      render: (d) => canEdit && (
        <div className="row court-acts">
          {d.status === "watching"
            ? <button type="button" className="btn sm ghost" disabled={busy(d)} onClick={() => updateDecision(d, { status: "watch_stopped" }, "Stopped watching for an appeal.")}>Stop watching</button>
            : <button type="button" className="btn sm" disabled={busy(d)} onClick={() => updateDecision(d, { status: "watching" }, "Watching the higher court again.")}>Watch again</button>}
        </div>
      ),
    },
  ];
  const lookCols: Column<any>[] = [
    { key: "case", label: "Case", sort: (d) => d.caseNumber || "", render: caseCell },
    { key: "decided", label: "Decided", sort: (d) => d.decidedOn || "", render: decidedCell },
    { key: "why", label: "Why", hideSm: true,
      render: (d) => <span className="small">{d.ourSide ? "The court's wording doesn't say who won." : "Which side is your client on?"}</span> },
    {
      key: "act", label: <span className="sr-only">Actions</span>, className: "actions",
      render: (d) => canEdit && (
        <div className="row court-acts">
          {!d.ourSide ? (
            <>
              <span className="faint xs">Our client is the</span>
              <button type="button" className="btn sm" disabled={busy(d)} onClick={() => updateDecision(d, { ourSide: "petitioner" }, "Saved: your client is the petitioner / plaintiff.")}>Petitioner</button>
              <button type="button" className="btn sm" disabled={busy(d)} onClick={() => updateDecision(d, { ourSide: "respondent" }, "Saved: your client is the respondent / defendant.")}>Respondent</button>
            </>
          ) : (
            <>
              {d.status !== "appealing" && <button type="button" className="btn sm" disabled={busy(d)} onClick={() => updateDecision(d, { status: "appealing" }, "Marked: we will appeal.")}>We will appeal</button>}
              {d.status !== "no_appeal" && <button type="button" className="btn sm ghost" disabled={busy(d)} onClick={() => updateDecision(d, { status: "no_appeal" }, "Marked: no appeal needed.")}>No appeal</button>}
            </>
          )}
        </div>
      ),
    },
  ];

  const yourCase = (d: any) => d.sourceCaseId
    ? <Link className="mono link" to={`/dashboard/cases/${d.sourceCaseId}`}>{d.sourceCaseNumber || "—"}</Link>
    : <span className="mono">{d.sourceCaseNumber || "—"}</span>;

  const detectionCols: Column<any>[] = [
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
            <button type="button" className="btn sm primary" disabled={busyId === `det${d.id}`} onClick={() => setDetectionStatus(d.id, "CONFIRMED")}>It's an appeal</button>
          )}
          <button type="button" className="btn sm ghost" disabled={busyId === `det${d.id}`} onClick={() => setDetectionStatus(d.id, "DISMISSED")}>Not related</button>
        </div>
      ),
    },
  ];

  const section = (title: string, sub: string, count: number, body: React.ReactNode) => (
    <section className="panel court-gap-b">
      <div className="panel-head"><h3>{title}</h3><span className="sub">{count}</span></div>
      <div className="panel-body flush">
        <p className="muted small" style={{ padding: "var(--s3) var(--s4) 0" }}>{sub}</p>
        {body}
      </div>
    </section>
  );

  return (
    <div className="court">
      <PageHead title="Appeal Alerts"
        sub="Decided cases and what they mean for an appeal, from the court record. Verify before acting; the limitation date calculation is coming next." />

      {loading ? (
        <div className="panel"><div className="panel-body stack"><Skel h={36} /><Skel h={36} /><Skel h={36} /></div></div>
      ) : (
        <>
          {section("You can appeal", "Decided against your client (or partly). Decide whether to appeal.", canAppeal.length,
            <DataTable rows={canAppeal} columns={canAppealCols} rowKey={(d) => d.id} initialSort={{ key: "decided", dir: "desc" }}
              rowClass={(d) => (d.status === "open" ? "hl" : undefined)}
              empty={{ icon: "ok", title: "Nothing to appeal", text: "Cases decided against your client appear here." }} />)}

          {section("The other side may appeal", "Decided for your client. PactPro checks the higher court every evening and alerts you if an appeal appears.", mayAppeal.length,
            <DataTable rows={mayAppeal} columns={mayAppealCols} rowKey={(d) => d.id} initialSort={{ key: "decided", dir: "desc" }}
              empty={{ icon: "ok", title: "Nothing to watch", text: "Cases decided for your client appear here." }} />)}

          {section("Needs a look", "The court's wording doesn't say who won, or PactPro doesn't know which side your client is on. Your answer is saved on the case.", look.length,
            <DataTable rows={look} columns={lookCols} rowKey={(d) => d.id} initialSort={{ key: "decided", dir: "desc" }}
              rowClass={(d) => (d.status === "open" ? "hl" : undefined)}
              empty={{ icon: "ok", title: "All clear", text: "Every decided case is sorted." }} />)}

          <section className="panel court-gap-b">
            <div className="panel-head"><h3>Appeals found</h3><span className="sub">{openDet.length}</span></div>
            <div className="panel-body flush">
              <p className="muted small" style={{ padding: "var(--s3) var(--s4) 0" }}>
                Cases in a higher court that look like an appeal against your decided cases, matched by party name. Verify before acting.
              </p>
              {nNew === 0 && openDet.length === 0 ? (
                <EmptyState icon="ok" title="No appeals found" text="If the other side appeals a case you won, it appears here." />
              ) : (
                <DataTable rows={openDet} columns={detectionCols} rowKey={(d) => d.id} initialSort={{ key: "matched", dir: "desc" }}
                  rowClass={(d) => (d.status === "NEW" ? "hl" : undefined)}
                  empty={{ icon: "alert", title: "No appeals found", text: "Matches from the evening check appear here." }} />
              )}
            </div>
          </section>

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
                      <button type="button" className="btn sm" disabled={busyId === `det${d.id}`} onClick={() => setDetectionStatus(d.id, "NEW")}>
                        <Icon name="restore" size="sm" />Restore
                      </button>
                    </div>
                  ))}
                </div>
              ) : <p className="muted small">Nothing dismissed. Dismissed matches are kept so the evening check does not report them again.</p>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default AppealAlert;
