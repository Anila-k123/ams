import React, { useEffect, useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { Calendar, momentLocalizer, Views } from "react-big-calendar";
import moment from "moment";
import axios from "axios";
import Select from "react-select";
import "react-big-calendar/lib/css/react-big-calendar.css";
import Modal from "../components/Modal";
import { useToast } from "../contexts/ToastContext.jsx";
import { usePermission } from "../contexts/PermissionContext.jsx";
import "../assets/styles/HearingsPage.css";
import { useLoading } from "../contexts/LoadingContext.jsx";

const localizer = momentLocalizer(moment);

const PURPOSE_OPTIONS = [
  "Arguments", "Evidence", "Framing of Issues", "For Counter / Reply",
  "For Orders", "Interim Application", "Mention", "Cross-examination", "Other",
];

const emptyEvent = {
  title: "", eventType: "", description: "", date: "", time: "", caseId: "",
  purpose: "", court: "", benchHall: "", judge: "", nextDate: "", outcome: "",
};

function HearingsPage() {
  const [events, setEvents] = useState([]);
  const [cases, setCases] = useState([]);
  const [filteredEvents, setFilteredEvents] = useState([]);
  const [currentView, setCurrentView] = useState(Views.MONTH);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [highlightedId, setHighlightedId] = useState(null);
  const location = useLocation();

  const [newEvent, setNewEvent] = useState(emptyEvent);

  const token = localStorage.getItem("token");
  const { withLoading } = useLoading();
  const { success, error, warning, info } = useToast();
  const { hasPermission } = usePermission();

  // ✅ Fetch Cases
  const fetchCases = async () => {
    try {
      const res = await axios.get("/api/cases/my-cases", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setCases(res.data || []);
    } catch (err) {
      console.error("Error fetching cases:", err);
    }
  };

  // ✅ Fetch Events
  const fetchEvents = useCallback(async () => {
    try {
      const res = await axios.get("/api/events/my-events", {
        headers: { Authorization: `Bearer ${token}` },
      });

      const formatted = res.data.map((e) => ({
        id: e.id,
        title: `${e.title} (${e.eventType})`,
        start: new Date(`${e.date}T${e.time || "09:00"}`),
        end: new Date(`${e.date}T${e.time || "10:00"}`),
        allDay: false,
        eventType: e.eventType,
        description: e.description,
        caseId: e.caseEntity?.id,
      }));

      setEvents(formatted);
      setFilteredEvents(formatted);
    } catch (err) {
      console.error("Error fetching events:", err);
    }
  }, [token]);

  useEffect(() => {
    fetchEvents();
    fetchCases();
  }, [fetchEvents]);

  // AI Assistant: open create-hearing modal
  useEffect(() => {
    const handler = (e) => {
      if (e.detail === "create-hearing" || e.detail === "create-event") {
        openModal();
      }
    };
    window.addEventListener("assistant-open-modal", handler);
    return () => window.removeEventListener("assistant-open-modal", handler);
  }, []);

  // Global Search navigation — read incoming state
  useEffect(() => {
    if (location.state?.search && location.state?.id) {
      setHighlightedId(location.state.id);
      const match = events.find(e => e.id === location.state.id);
      if (match) {
        setCurrentDate(match.start);
        setCurrentView(Views.DAY);
      }
      window.history.replaceState({}, document.title);
    }
  }, [location.state, events]);

  const handleChange = (e) => {
    setNewEvent({ ...newEvent, [e.target.name]: e.target.value });
    setFormError("");
  };

  // ✅ Handle case selection
  const handleCaseSelect = (selectedOption) => {
    setNewEvent({ ...newEvent, caseId: selectedOption ? selectedOption.value : "" });
    setFormError("");
  };

  // ✅ Add new event
  const handleAddEvent = async (e) => {
    e.preventDefault();
    setFormError("");
    // Every event (hearing, meeting, payment-due, document) must belong to a
    // case — the backend CaseEvent.case is a required foreign key — so validate
    // the options here rather than sending an event the server will reject.
    if (!newEvent.title.trim()) { setFormError("Title is required."); return; }
    if (!newEvent.eventType) { setFormError("Please choose an event type."); return; }
    if (!newEvent.date) { setFormError("Date is required."); return; }
    if (!newEvent.caseId) { setFormError("Please select the case this event belongs to."); return; }
    setSaving(true);
    try {
      await withLoading(
        axios.post(
          "/api/events/create",
          {
            title: newEvent.title.trim(),
            eventType: newEvent.eventType,
            description: newEvent.description.trim(),
            date: newEvent.date,
            time: newEvent.time || null,
            caseEntity: { id: Number(newEvent.caseId) },
            ...(newEvent.eventType === "HEARING" ? {
              purpose: newEvent.purpose,
              court: newEvent.court,
              benchHall: newEvent.benchHall,
              judge: newEvent.judge,
              nextDate: newEvent.nextDate || null,
              outcome: newEvent.outcome,
            } : {}),
          },
          { headers: { Authorization: `Bearer ${token}` } }
        ),
        "Saving Event..."
      );

      setShowModal(false);
      setNewEvent(emptyEvent);
      fetchEvents();
      success("Event created successfully!");
    } catch (err) {
      console.error("Error adding event:", err);
      const serverMsg =
        err.response?.data?.message || err.message || "Failed to create event. Please try again.";
      setFormError(serverMsg);
    } finally {
      setSaving(false);
    }
  };

  const openModal = () => {
    setFormError("");
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setFormError("");
    setNewEvent(emptyEvent);
  };

  // ✅ Calendar Navigation
  const goToToday = () => setCurrentDate(new Date());
  const goToNext = () => {
    const nextDate =
      currentView === Views.MONTH
        ? moment(currentDate).add(1, "month").toDate()
        : moment(currentDate).add(1, "week").toDate();
    setCurrentDate(nextDate);
  };
  const goToPrev = () => {
    const prevDate =
      currentView === Views.MONTH
        ? moment(currentDate).subtract(1, "month").toDate()
        : moment(currentDate).subtract(1, "week").toDate();
    setCurrentDate(prevDate);
  };
  const changeView = (view) => setCurrentView(view);

  // ✅ Event Color Styling
  const eventStyleGetter = (event) => {
    let backgroundColor = "#1976d2";
    if (event.eventType === "HEARING") backgroundColor = "#e53935";
    else if (event.eventType === "MEETING") backgroundColor = "#43a047";
    else if (event.eventType === "PAYMENT_DUE") backgroundColor = "#ffb300";
    else if (event.eventType === "DOCUMENT") backgroundColor = "#6d4c41";

    const isHighlighted = highlightedId === event.id;
    return {
      style: {
        backgroundColor,
        color: "#fff",
        borderRadius: "8px",
        padding: "2px 5px",
        boxShadow: isHighlighted ? "0 0 0 3px #3b82f6, 0 0 20px rgba(59,130,246,0.4)" : "none",
        transition: "box-shadow 2.8s ease-out",
      },
    };
  };

  // ✅ Prepare case options for react-select
  const caseOptions = cases.map((c) => ({
    value: c.id,
    label: `${c.caseNumber || "N/A"} — ${c.clientName || "Unknown"}`,
  }));

  return (
    <div className="calendar-container">
      <div className="calendar-header">
        <div className="calendar-header-actions">
          {hasPermission("EVENT_CREATE") && (
            <button className="add-event-btn" onClick={openModal}>Add Event</button>
          )}
          <button onClick={goToPrev}>Prev</button>
          <button onClick={goToToday}>Today</button>
          <button onClick={goToNext}>Next</button>
          <button className={currentView === Views.WEEK ? "active-view" : ""} onClick={() => changeView(Views.WEEK)}>Week</button>
          <button className={currentView === Views.MONTH ? "active-view" : ""} onClick={() => changeView(Views.MONTH)}>Month</button>
          <button className={currentView === Views.AGENDA ? "active-view" : ""} onClick={() => changeView(Views.AGENDA)}>Agenda</button>
        </div>
      </div>

      {/* ✅ Calendar */}
      <Calendar
        localizer={localizer}
        events={filteredEvents}
        startAccessor="start"
        endAccessor="end"
        style={{ height: 600 }}
        eventPropGetter={eventStyleGetter}
        date={currentDate}
        view={currentView}
        onNavigate={setCurrentDate}
        onView={setCurrentView}
      />

      {/* ✅ Add Event Modal */}
      <Modal isOpen={showModal} onClose={closeModal} title="Add New Event">
        {formError && <div className="modal-error">{formError}</div>}
        <form onSubmit={handleAddEvent} className="event-form">
          <input
            name="title"
            placeholder="Event Title"
            value={newEvent.title}
            onChange={handleChange}
            required
          />
          <select
            name="eventType"
            value={newEvent.eventType}
            onChange={handleChange}
            required
          >
            <option value="">Select Type</option>
            <option value="HEARING">Hearing</option>
            <option value="MEETING">Client Meeting</option>
            <option value="PAYMENT_DUE">Payment Due</option>
            <option value="DOCUMENT">Document Filing</option>
          </select>

          <input
            type="date"
            name="date"
            value={newEvent.date}
            onChange={handleChange}
            required
          />
          <input
            type="time"
            name="time"
            value={newEvent.time}
            onChange={handleChange}
          />

          <label>Select Case: *</label>
          <Select
            options={caseOptions}
            value={caseOptions.find((opt) => opt.value === newEvent.caseId) || null}
            onChange={handleCaseSelect}
            placeholder="Search by Case or Client Name..."
            isSearchable
            styles={{
              control: (base) => ({
                ...base,
                borderRadius: "8px",
                borderColor: "#ccc",
                boxShadow: "none",
                "&:hover": { borderColor: "#40e0d0" },
              }),
            }}
          />

          {newEvent.eventType === "HEARING" && (
            <div className="hearing-detail-fields">
              <select name="purpose" value={newEvent.purpose} onChange={handleChange}>
                <option value="">Purpose / stage…</option>
                {PURPOSE_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input name="court" placeholder="Court" value={newEvent.court} onChange={handleChange} />
              <input name="benchHall" placeholder="Bench / Hall no." value={newEvent.benchHall} onChange={handleChange} />
              <input name="judge" placeholder="Judge / Coram" value={newEvent.judge} onChange={handleChange} />
              <label>Next hearing date</label>
              <input type="date" name="nextDate" value={newEvent.nextDate} onChange={handleChange} />
              <textarea name="outcome" placeholder="Outcome / order (after the hearing)" value={newEvent.outcome} onChange={handleChange}></textarea>
            </div>
          )}

          <textarea
            name="description"
            placeholder="Description"
            value={newEvent.description}
            onChange={handleChange}
          ></textarea>

          <div className="modal-actions">
            <button type="button" className="btn-cancel" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="btn-save" disabled={saving}>
              {saving ? "Saving..." : "Save Event"}
            </button>
          </div>
        </form>
      </Modal>

    </div>
  );
}

export default HearingsPage;
