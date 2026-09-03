import React, { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { FiList } from "react-icons/fi";
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
  const [date, setDate] = useState(todayISO());
  const [listings, setListings] = useState([]);
  const [covered, setCovered] = useState([]);
  const [loading, setLoading] = useState(true);

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
                {rows.map((l) => (
                  <Link
                    className="listed-today-row"
                    key={`${l.caseId}-${l.court}-${l.courtNumber}-${l.itemNumber}`}
                    to={`/dashboard/cases/${l.caseId}`}
                    title="Open this case"
                  >
                    <span className="lt-court">Court {l.courtNumber || "—"}</span>
                    <span className="lt-room">Item {l.itemNumber}</span>
                    <span className="lt-case" style={{ gridColumn: "3 / -1" }}>{l.caseString || l.caseNumber}</span>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
