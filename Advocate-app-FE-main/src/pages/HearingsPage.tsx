import { useEffect, useState, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Calendar as BigCalendar, momentLocalizer, Views } from "react-big-calendar";
import moment from "moment";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { Dialog } from "primereact/dialog";
import { SelectButton } from "primereact/selectbutton";
import { useToast } from "../contexts/ToastContext";
import { usePermission } from "../contexts/PermissionContext";
import "../assets/styles/HearingsPage.css";
import { useLoading } from "../contexts/LoadingContext";
import api from "../api/client";
import { usePageModal } from "../utils/pageModal";

const localizer = momentLocalizer(moment);

const PURPOSE_OPTIONS = [
  "Arguments", "Evidence", "Framing of Issues", "For Counter / Reply",
  "For Orders", "Interim Application", "Mention", "Cross-examination", "Other",
];

const EVENT_TYPES = [
  { value: "HEARING", label: "Hearing" },
  { value: "MEETING", label: "Client Meeting" },
  { value: "PAYMENT_DUE", label: "Payment Due" },
  { value: "DOCUMENT", label: "Document Filing" },
];

const VIEW_OPTIONS = [
  { value: Views.DAY, label: "Day" },
  { value: Views.WEEK, label: "Week" },
  { value: Views.MONTH, label: "Month" },
];

const emptyEvent = {
  title: "", eventType: "", description: "", date: "", time: "", caseId: "" as any,
  purpose: "", court: "", benchHall: "", judge: "", nextDate: "", outcome: "",
};

const p2 = (n: number) => String(n).padStart(2, "0");
const toISODate = (d: Date | null | undefined) => (d ? `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` : "");
const toHHMM = (d: Date | null | undefined) => (d ? `${p2(d.getHours())}:${p2(d.getMinutes())}` : "");
const fromISODate = (s: string) => (s ? new Date(`${s}T00:00:00`) : null);
const fromHHMM = (s: string) => {
  if (!s) return null;
  const [h, m] = s.split(":").map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0);
  return d;
};

function HearingsPage() {
  const [events, setEvents] = useState<any[]>([]);
  // Open tasks shown on their deadline date, read from the Tasks page's own
  // list (/api/workspace/tasks/all, already limited to what this user may
  // see). Shown, not copied: a copy as a calendar event would go stale when
  // the task is edited, completed or reassigned, and would raise hearing
  // reminders. Task alerts come from notifications/events.task_deadlines.
  const [tasks, setTasks] = useState<any[]>([]);
  const navigate = useNavigate();
  const [cases, setCases] = useState<any[]>([]);
  const [currentView, setCurrentView] = useState<any>(Views.MONTH);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [highlightedId, setHighlightedId] = useState<any>(null);
  const location = useLocation();
  const [newEvent, setNewEvent] = useState(emptyEvent);

  const { withLoading } = useLoading();
  const { success } = useToast();
  const { hasPermission } = usePermission();

  const fetchCases = async () => {
    try {
      const res = await api.get("/api/cases/my-cases");
      setCases(res.data || []);
    } catch (err) {
      console.error("Error fetching cases:", err);
    }
  };

  const fetchEvents = useCallback(async () => {
    try {
      const res = await api.get("/api/events/my-events");
      const formatted = res.data.map((e: any) => ({
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
    } catch (err) {
      console.error("Error fetching events:", err);
    }
  }, []);

  const canSeeTasks = hasPermission("TASK_VIEW");
  const fetchTasks = useCallback(async () => {
    if (!canSeeTasks) return;
    try {
      const res = await api.get("/api/workspace/tasks/all");
      const today = moment().startOf("day");
      setTasks((res.data || [])
        .filter((t: any) => t.deadline && !t.completed && !t.cancelled)
        .map((t: any) => {
          const due = moment(t.deadline, "YYYY-MM-DD");
          return {
            id: `task-${t.id}`,           // never clashes with an event id
            taskId: t.id,
            kind: "task",
            title: `✓ Task: ${t.title}${t.caseNumber ? ` – ${t.caseNumber}` : ""}`,
            plainTitle: t.title,
            start: due.toDate(),
            end: due.toDate(),
            allDay: true,
            overdue: due.isBefore(today),
          };
        }));
    } catch (err) {
      console.error("Error fetching tasks:", err);
    }
  }, [canSeeTasks]);

  useEffect(() => {
    fetchEvents();
    fetchCases();
    fetchTasks();
  }, [fetchEvents, fetchTasks]);

  // A task on the calendar opens it on the Tasks page (search + highlight).
  const onSelectEvent = (item: any) => {
    if (item.kind === "task") {
      navigate("/dashboard/tasks", { state: { search: item.plainTitle, id: item.taskId } });
    }
  };

  const openModal = () => {
    setFormError("");
    setShowModal(true);
  };

  // Quick Actions / Lisa: open the Add New Event form.
  usePageModal(["create-hearing", "create-event"], () => openModal());

  // Global Search navigation — read incoming state
  useEffect(() => {
    const st = location.state as any;
    if (st?.search && st?.id) {
      setHighlightedId(st.id);
      const match = events.find((e) => e.id === st.id);
      if (match) {
        setCurrentDate(match.start);
        setCurrentView(Views.DAY);
      }
      window.history.replaceState({}, document.title);
    }
  }, [location.state, events]);

  const setField = (name: string, value: any) => {
    setNewEvent((ev) => ({ ...ev, [name]: value }));
    setFormError("");
  };
  const handleChange = (e: any) => setField(e.target.name, e.target.value);

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    // Every event must belong to a case — the backend CaseEvent.case is a required FK.
    if (!newEvent.title.trim()) { setFormError("Title is required."); return; }
    if (!newEvent.eventType) { setFormError("Please choose an event type."); return; }
    if (!newEvent.date) { setFormError("Date is required."); return; }
    if (!newEvent.caseId) { setFormError("Please select the case this event belongs to."); return; }
    setSaving(true);
    try {
      await withLoading(
        api.post("/api/events/create", {
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
        }),
        "Saving Event..."
      );
      setShowModal(false);
      setNewEvent(emptyEvent);
      fetchEvents();
      success("Event created successfully!");
    } catch (err: any) {
      console.error("Error adding event:", err);
      setFormError(err.response?.data?.message || err.message || "Failed to create event. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setFormError("");
    setNewEvent(emptyEvent);
  };

  // Prev / Next move by what the view shows.
  const move = (dir: 1 | -1) => {
    const m = moment(currentDate);
    m.add(dir, currentView === Views.MONTH ? "month" : currentView === Views.DAY ? "day" : "week");
    setCurrentDate(m.toDate());
  };
  const goToNext = () => move(1);
  const goToPrev = () => move(-1);

  // The calendar's own toolbar (with its "October 2026" label) is hidden in
  // HearingsPage.css, so say here what period is on screen.
  const periodLabel = (() => {
    const d = moment(currentDate);
    if (currentView === Views.MONTH) return d.format("MMMM YYYY");
    if (currentView === Views.DAY) return d.format("ddd, D MMM YYYY");
    const start = d.clone().startOf("week");
    const end = d.clone().endOf("week");
    return `${start.format(start.year() === end.year() ? "D MMM" : "D MMM YYYY")} – ${end.format("D MMM YYYY")}`;
  })();

  const eventStyleGetter = (event: any) => {
    if (event.kind === "task") {
      // Tasks look different from hearings and events: outlined, with overdue in red.
      const colour = event.overdue ? "#c62828" : "#7b1fa2";
      return {
        style: {
          backgroundColor: "#fff", color: colour, border: `1.5px solid ${colour}`,
          borderRadius: "8px", padding: "1px 5px", fontWeight: event.overdue ? 600 : 500,
        },
      };
    }
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

  const caseOptions = cases.map((c) => ({
    value: c.id,
    label: `${c.caseNumber || "N/A"} — ${c.clientName || "Unknown"}`,
  }));

  return (
    <div className="calendar-container">
      <div className="flex flex-wrap align-items-center gap-2">
        {hasPermission("EVENT_CREATE") && <Button icon="pi pi-plus" label="Add Event" onClick={openModal} />}
        <Button icon="pi pi-chevron-left" label="Prev" className="p-button-outlined" onClick={goToPrev} />
        <Button icon="pi pi-chevron-right" iconPos="right" label="Next" className="p-button-outlined" onClick={goToNext} />
        <span className="calendar-period">{periodLabel}</span>
        <SelectButton value={currentView} options={VIEW_OPTIONS} onChange={(e) => e.value && setCurrentView(e.value)} />
      </div>

      <BigCalendar
        localizer={localizer}
        events={[...events, ...tasks]}
        onSelectEvent={onSelectEvent}
        tooltipAccessor={(item: any) => item.kind === "task"
          ? `${item.overdue ? "Overdue task" : "Task due"}: ${item.plainTitle} (click to open)` : item.title}
        startAccessor="start"
        endAccessor="end"
        style={{ height: 600 }}
        eventPropGetter={eventStyleGetter}
        date={currentDate}
        view={currentView}
        onNavigate={setCurrentDate}
        onView={setCurrentView}
        views={[Views.DAY, Views.WEEK, Views.MONTH]}
      />

      <Dialog visible={showModal} onHide={closeModal} header="Add New Event" modal style={{ width: "36rem" }} breakpoints={{ "640px": "95vw" }}>
        {formError && <div className="modal-error">{formError}</div>}
        <form onSubmit={handleAddEvent} className="flex flex-column gap-3">
          <InputText name="title" placeholder="Event Title" value={newEvent.title} onChange={handleChange} required />
          <Dropdown value={newEvent.eventType} options={EVENT_TYPES} placeholder="Select Type"
            onChange={(e) => setField("eventType", e.value)} />
          <div className="grid">
            <div className="col-12 md:col-6">
              <Calendar className="w-full" placeholder="Date" value={fromISODate(newEvent.date)} dateFormat="dd/mm/yy" showIcon appendTo={document.body}
                onChange={(e) => setField("date", toISODate(e.value as Date))} />
            </div>
            <div className="col-12 md:col-6">
              <Calendar className="w-full" placeholder="Time" value={fromHHMM(newEvent.time)} timeOnly hourFormat="24" appendTo={document.body}
                onChange={(e) => setField("time", toHHMM(e.value as Date))} />
            </div>
          </div>

          <label className="event-label">Select Case: *</label>
          <Dropdown value={newEvent.caseId || null} options={caseOptions} filter showClear
            placeholder="Search by Case or Client Name..." onChange={(e) => setField("caseId", e.value ?? "")} />

          {newEvent.eventType === "HEARING" && (
            <div className="flex flex-column gap-3">
              <Dropdown value={newEvent.purpose} placeholder="Purpose / stage…" showClear
                options={PURPOSE_OPTIONS.map((p) => ({ value: p, label: p }))} onChange={(e) => setField("purpose", e.value || "")} />
              <InputText name="court" placeholder="Court" value={newEvent.court} onChange={handleChange} />
              <InputText name="benchHall" placeholder="Bench / Hall no." value={newEvent.benchHall} onChange={handleChange} />
              <InputText name="judge" placeholder="Judge / Coram" value={newEvent.judge} onChange={handleChange} />
              <label className="event-label">Next hearing date</label>
              <Calendar value={fromISODate(newEvent.nextDate)} dateFormat="dd/mm/yy" showIcon showButtonBar appendTo={document.body}
                onChange={(e) => setField("nextDate", toISODate(e.value as Date))} />
              <InputTextarea name="outcome" placeholder="Outcome / order (after the hearing)" value={newEvent.outcome} onChange={handleChange} rows={2} />
            </div>
          )}

          <InputTextarea name="description" placeholder="Description" value={newEvent.description} onChange={handleChange} rows={3} />

          <div className="flex justify-content-end gap-2">
            <Button type="button" label="Cancel" className="p-button-text" onClick={closeModal} />
            <Button type="submit" label={saving ? "Saving..." : "Save Event"} disabled={saving} loading={saving} />
          </div>
        </form>
      </Dialog>
    </div>
  );
}

export default HearingsPage;
