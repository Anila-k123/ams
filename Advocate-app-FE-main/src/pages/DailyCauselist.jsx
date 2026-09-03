import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { FiList } from "react-icons/fi";
import { useToast } from "../contexts/ToastContext";
import "../assets/styles/DisplayBoard.css";

function authHeaders() {
  const token = localStorage.getItem("token");
  return { headers: { Authorization: `Bearer ${token}` } };
}

const todayISO = () => new Date().toISOString().slice(0, 10);

// This practice's matters that sit in a court's cause list for a given day —
// the item number each is listed at. A dedicated page (separate from the Court
// Display Board, which is for browsing any court's live board).
export default function DailyCauselist() {
  const { success, error } = useToast();
  const [date, setDate] = useState(todayISO());
  const [listings, setListings] = useState([]);
  const [covered, setCovered] = useState([]);
  const [loading, setLoading] = useState(true);
  const [alertBusy, setAlertBusy] = useState(null);

  // Manually forward one listing to the client — the advocate decides which
  // listings are worth telling the client about. Reuses the case hearing-alert
  // email endpoint (which pulls the client's address from the case).
  const alertClient = useCallback(async (l) => {
    const key = `${l.caseId}-${l.courtNumber}-${l.itemNumber}`;
    setAlertBusy(key);
    try {
      const res = await axios.post(
        `/api/cases/${l.caseId}/hearing-alert`,
        {
          date: l.listDate || date,
          purpose: "Listed in cause list",
          bench: l.courtNumber ? `Court ${l.courtNumber}, item ${l.itemNumber}` : "",
          note: `Listed as: ${l.caseString || l.caseNumber}`,
        },
        authHeaders()
      );
      if (res.data?.success) success(`Alert sent to client (${res.data.recipient}).`);
      else error(res.data?.errorMessage || "Alert could not be sent.");
    } catch (err) {
      error(err.response?.data?.errorMessage || err.response?.data?.error || "Failed to send alert.");
    } finally {
      setAlertBusy(null);
    }
  }, [date, success, error]);

  const fetchListings = useCallback(async (on) => {
    setLoading(true);
    try {
      const res = await axios.get("/api/causelist/my-listings", { ...authHeaders(), params: { date: on } });
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
  const byCourt = listings.reduce((acc, l) => {
    const key = l.courtLabel || l.court;
    (acc[key] = acc[key] || []).push(l);
    return acc;
  }, {});
  const isToday = date === todayISO();

  return (
    <div className="board-container">
      <div className="board-header">
        <div>
          <h2>Daily Causelist</h2>
          <p className="board-sub">Your matters listed in {isToday ? "today's" : "the day's"} cause lists.</p>
        </div>
        <label className="dc-date">
          <span>Date</span>
          <input type="date" value={date} max={todayISO()} onChange={(e) => setDate(e.target.value || todayISO())} />
        </label>
      </div>

      {loading ? (
        <div className="listed-today listed-today-empty"><FiList /> <span>Loading cause list…</span></div>
      ) : !listings.length ? (
        <div className="listed-today listed-today-empty">
          <FiList />
          <span>
            Nothing of yours is listed {isToday ? "today" : "on this date"}
            {covered.length
              ? ` in ${covered.length === 1 ? "the court" : "the courts"} we hold a cause list for.`
              : " — no cause list has been collected for this date yet."}
          </span>
        </div>
      ) : (
        <div className="dc-groups">
          {Object.entries(byCourt).map(([courtLabel, rows]) => (
            <div className="listed-today" key={courtLabel}>
              <h3><FiList /> {courtLabel} ({rows.length})</h3>
              <div className="listed-today-rows">
                {rows.map((l) => {
                  const key = `${l.caseId}-${l.courtNumber}-${l.itemNumber}`;
                  return (
                    <div className="dc-row" key={`${l.caseId}-${l.court}-${l.courtNumber}-${l.itemNumber}`}>
                      <Link
                        className="listed-today-row dc-row-main"
                        to={`/dashboard/cases/${l.caseId}`}
                        title="Open this case"
                      >
                        <span className="lt-court">Court {l.courtNumber || "—"}</span>
                        <span className="lt-room">Item {l.itemNumber}</span>
                        <span className="lt-case" style={{ gridColumn: "3 / -1" }}>{l.caseString || l.caseNumber}</span>
                      </Link>
                      <button
                        type="button"
                        className="dc-alert-btn"
                        disabled={!l.clientId || alertBusy === key}
                        title={l.clientId ? "Email this listing to the client" : "No client linked to this case"}
                        onClick={() => alertClient(l)}
                      >
                        {alertBusy === key ? "Sending…" : "Send Alert to Client"}
                      </button>
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
