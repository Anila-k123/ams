import React from "react";

function UpcomingPanel({ events }) {
  return (
    <div className="panel">
      <h3 className="panel-title">Upcoming</h3>
      <ul className="panel-list">
        {events.map((ev, index) => (
          <li key={index} className="panel-item">
            <strong>{ev.title}</strong> <br />
            <span className="subtle">📅 {ev.date} ({ev.caseTitle})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default UpcomingPanel;
