import React, { useRef } from "react";
import { useDashboardFilter } from "../contexts/DashboardFilterContext";

export default function DashboardTimeNavigator() {
  const { periodLabel, navigatePrev, navigateNext, isNextDisabled, view, currentDate, setCurrentDate } =
    useDashboardFilter();
  const pickerRef = useRef(null);

  const handlePickerChange = (e) => {
    const val = e.target.value;
    if (!val) return;
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
      setCurrentDate(d);
    }
  };

  const handlePrev = () => {
    pickerRef.current?.blur();
    navigatePrev();
  };

  const handleNext = () => {
    pickerRef.current?.blur();
    navigateNext();
  };

  const getPickerType = () => {
    switch (view) {
      case "day": return "date";
      case "week": return "date";
      case "month": return "month";
      case "year": return "number";
      default: return "date";
    }
  };

  const getPickerValue = () => {
    const d = currentDate;
    switch (view) {
      case "day":
      case "week":
        return d.toISOString().split("T")[0];
      case "month":
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      case "year":
        return d.getFullYear().toString();
      default:
        return d.toISOString().split("T")[0];
    }
  };

  const getPickerMin = () => {
    // Minimum: 5 years ago
    const d = new Date(currentDate);
    d.setFullYear(d.getFullYear() - 5);
    return view === "year" ? d.getFullYear().toString() : d.toISOString().split("T")[0];
  };

  const getPickerMax = () => {
    const now = new Date();
    if (view === "year") return now.getFullYear().toString();
    return now.toISOString().split("T")[0];
  };

  return (
    <div className="time-navigator">
      <button className="nav-arrow-btn" onClick={handlePrev} title="Previous">
        ◀
      </button>

      <div className="period-label-wrapper">
        <span className="period-label">{periodLabel()}</span>
        <input
          ref={pickerRef}
          type={getPickerType()}
          className="period-picker"
          value={getPickerValue()}
          onChange={handlePickerChange}
          min={getPickerMin()}
          max={getPickerMax()}
        />
      </div>

      <button
        className={`nav-arrow-btn ${isNextDisabled ? "disabled" : ""}`}
        onClick={handleNext}
        disabled={isNextDisabled}
        title="Next"
      >
        ▶
      </button>
    </div>
  );
}
