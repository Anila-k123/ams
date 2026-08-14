import React from "react";
import { useDashboardFilter } from "../contexts/DashboardFilterContext";

const VIEWS = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "year", label: "Year" },
];

export default function TimeSwitcher() {
  const { view, setView } = useDashboardFilter();

  return (
    <div className="time-switcher">
      {VIEWS.map((v) => (
        <button
          key={v.key}
          className={`switch-btn ${view === v.key ? "active" : ""}`}
          onClick={() => setView(v.key)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
