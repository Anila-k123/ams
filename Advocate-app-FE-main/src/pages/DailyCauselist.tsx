import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { Calendar } from "primereact/calendar";
import { Button } from "primereact/button";
import { ProgressSpinner } from "primereact/progressspinner";
import { useToast } from "../contexts/ToastContext";
import api from "../api/client";
import "../assets/styles/DisplayBoard.css";

const p2 = (n: number) => String(n).padStart(2, "0");
const toISO = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
// Kept as the original (UTC-based) "today" so the default date/max are unchanged.
const todayISO = () => new Date().toISOString().slice(0, 10);

// This practice's matters that sit in a court's cause list for a given day —
// the item number each is listed at. A dedicated page (separate from the Court
// Display Board, which is for browsing any court's live board).
export default function DailyCauselist() {
  const { success, error } = useToast();
  const [date, setDate] = useState(todayISO());
  const [listings, setListings] = useState<any[]>([]);
  const [covered, setCovered] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [alertBusy, setAlertBusy] = useState<string | null>(null);

  // Manually forward one listing to the client. Reuses the case hearing-alert
  // email endpoint (which pulls the client's address from the case).
  const alertClient = useCallback(async (l: any) => {
    const key = `${l.caseId}-${l.courtNumber}-${l.itemNumber}`;
    setAlertBusy(key);
    try {
      const res = await api.post(`/api/cases/${l.caseId}/hearing-alert`, {
        date: l.listDate || date,
        purpose: "Listed in cause list",
        bench: l.courtNumber ? `Court ${l.courtNumber}, item ${l.itemNumber}` : "",
        note: `Listed as: ${l.caseString || l.caseNumber}`,
      });
      if (res.data?.success) success(`Alert sent to client (${res.data.recipient}).`);
      else error(res.data?.errorMessage || "Alert could not be sent.");
    } catch (err: any) {
      error(err.response?.data?.errorMessage || err.response?.data?.error || "Failed to send alert.");
    } finally {
      setAlertBusy(null);
    }
  }, [date, success, error]);

  const fetchListings = useCallback(async (on: string) => {
    setLoading(true);
    try {
      const res = await api.get("/api/causelist/my-listings", { params: { date: on } });
      setListings(res.data?.listings || []);
      setCovered(res.data?.coveredCourts || []);
    } catch {
      setListings([]);
      setCovered([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchListings(date); }, [date, fetchListings]);

  // Group by court so a day's listings read as "under this court, these items".
  const byCourt: Record<string, any[]> = listings.reduce((acc: Record<string, any[]>, l) => {
    const key = l.courtLabel || l.court;
    (acc[key] = acc[key] || []).push(l);
    return acc;
  }, {});
  const isToday = date === todayISO();

  return (
    <div className="board-container">
      <div className="flex justify-content-between align-items-center flex-wrap gap-3 mb-3">
        <p className="board-sub">Your matters listed in {isToday ? "today's" : "the day's"} cause lists.</p>
        <label className="dc-date">
          <span>Date</span>
          <Calendar value={new Date(`${date}T00:00:00`)} maxDate={new Date(`${todayISO()}T00:00:00`)} dateFormat="dd/mm/yy" showIcon
            onChange={(e) => setDate(e.value ? toISO(e.value as Date) : todayISO())} />
        </label>
      </div>

      {loading ? (
        <div className="listed-today listed-today-empty">
          <ProgressSpinner style={{ width: 20, height: 20 }} strokeWidth="6" /> <span>Loading cause list…</span>
        </div>
      ) : !listings.length ? (
        <div className="listed-today listed-today-empty">
          <i className="pi pi-list" />
          <span>
            Nothing of yours is listed {isToday ? "today" : "on this date"}
            {covered.length
              ? ` in ${covered.length === 1 ? "the court" : "the courts"} we hold a cause list for.`
              : " — no cause list has been collected for this date yet."}
          </span>
        </div>
      ) : (
        <div className="flex flex-column gap-3">
          {Object.entries(byCourt).map(([courtLabel, rows]) => (
            <div className="listed-today" key={courtLabel}>
              <h3><i className="pi pi-list" /> {courtLabel} ({rows.length})</h3>
              <div className="flex flex-column gap-2">
                {rows.map((l: any) => {
                  const key = `${l.caseId}-${l.courtNumber}-${l.itemNumber}`;
                  return (
                    <div className="flex align-items-center gap-2" key={`${l.caseId}-${l.court}-${l.courtNumber}-${l.itemNumber}`}>
                      <Link className="listed-today-row flex-1" to={`/dashboard/cases/${l.caseId}`} title="Open this case">
                        <span className="lt-court">Court {l.courtNumber || "—"}</span>
                        <span className="lt-room">Item {l.itemNumber}</span>
                        <span className="lt-case" style={{ gridColumn: "3 / -1" }}>{l.caseString || l.caseNumber}</span>
                      </Link>
                      <Button type="button" className="p-button-outlined p-button-sm" icon="pi pi-send"
                        label={alertBusy === key ? "Sending…" : "Send Alert to Client"}
                        disabled={!l.clientId || alertBusy === key}
                        tooltip={l.clientId ? "Email this listing to the client" : "No client linked to this case"}
                        tooltipOptions={{ showOnDisabled: true }}
                        onClick={() => alertClient(l)} />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
