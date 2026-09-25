import { useEffect, useState, useCallback } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Tag } from "primereact/tag";
import { ProgressSpinner } from "primereact/progressspinner";
import api from "../api/client";
import { useToast } from "../contexts/ToastContext";
import "../assets/styles/AppealAlert.css";

// Appeal Alert is entirely automatic: the nightly scan_appeals sweep reads each
// decided case, works out which higher court would hear an appeal, and searches
// it by party name. Nothing here computes a limitation period - a confidently
// wrong date would be worse than none.
const STATUS_SEVERITY: Record<string, any> = { CONFIRMED: "success", DISMISSED: "secondary", NEW: "warning" };

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
      success(status === "CONFIRMED" ? "Marked as a real appeal." : "Dismissed as unrelated.");
      fetchDetections();
    } catch {
      error("Couldn't update that detection.");
    } finally {
      setBusyId(null);
    }
  };

  const open = detections.filter((d) => d.status !== "DISMISSED");
  const dismissed = detections.filter((d) => d.status === "DISMISSED");

  const table = (rows: any[]) => (
    <DataTable value={rows} dataKey="id" size="small" stripedRows
      rowClassName={(d: any) => (d.status === "DISMISSED" ? "appeal-row-dismissed" : "")}>
      <Column header="Your Case" body={(d) => d.sourceCaseNumber || "-"} />
      <Column header="Appeal Found" body={(d) => d.appealCaseNumber || "(number not listed)"} />
      <Column header="Forum" body={(d) => d.forum || d.forumCourtId} />
      <Column header="Parties" body={(d) => d.appealParties || "-"} className="appeal-parties-cell" />
      <Column header="Filed" body={(d) => d.appealFiledOn || "-"} />
      <Column header="Matched On" body={(d) => (
        <>
          <span>{d.matchedOn || "-"}</span>
          {typeof d.matchScore === "number" && (
            <span className="appeal-score"> ({Math.round(d.matchScore * 100)}%)</span>
          )}
        </>
      )} />
      <Column header="Status" body={(d) => <Tag value={d.status} severity={STATUS_SEVERITY[d.status] || "info"} />} />
      <Column body={(d) => (
        <div className="flex gap-2 flex-wrap">
          {d.status !== "CONFIRMED" && (
            <Button size="small" severity="success" label="It is an appeal" disabled={busyId === d.id}
              onClick={() => setDetectionStatus(d.id, "CONFIRMED")} />
          )}
          {d.status !== "DISMISSED" && (
            <Button size="small" severity="danger" outlined label="Not related" disabled={busyId === d.id}
              onClick={() => setDetectionStatus(d.id, "DISMISSED")} />
          )}
        </div>
      )} />
    </DataTable>
  );

  return (
    <div className="appeal-alert-page">
      <div className="appeal-list-section">
        <h3>Detected Appeals</h3>
        {loading ? (
          <div className="appeal-empty"><ProgressSpinner style={{ width: 32, height: 32 }} strokeWidth="5" /></div>
        ) : open.length === 0 ? (
          <div className="appeal-empty">No appeals detected against your decided cases.</div>
        ) : (
          <>
            {/* A caveat about the rows beneath: they are party-name matches, i.e. candidates. */}
            <p className="appeal-detect-note">
              Candidates matched from the court record — verify before acting.
              No filing or limitation deadline is calculated.
            </p>
            {table(open)}
          </>
        )}
      </div>

      {dismissed.length > 0 && (
        <div className="appeal-list-section">
          <h3>Dismissed as unrelated</h3>
          <p className="appeal-detect-note">Kept so the nightly check does not report them again.</p>
          {table(dismissed)}
        </div>
      )}
    </div>
  );
}

export default AppealAlert;
