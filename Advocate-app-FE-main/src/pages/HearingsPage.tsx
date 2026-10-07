// Calendar: hearings, client meetings, payment dues and filings, plus open task
// deadlines (read-only, from the Tasks list). Day / Week / Month views on the
// prototype's own grid; clicking an empty part of a day adds an event on it.
// No "Today" button and no Agenda view: the firm decided against both (Prev /
// Next and the period heading are enough, and Day covers what Agenda showed).
import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useToast } from "../contexts/ToastContext";
import { usePermission } from "../contexts/PermissionContext";
import { useLoading } from "../contexts/LoadingContext";
import api from "../api/client";
import { usePageModal } from "../utils/pageModal";
import { Icon, Chip, PageHead, EmptyState } from "../ui/kit";
import { TextField, TextArea, SelectField, Segmented, FilterChip } from "../ui/forms";
import { Modal, Drawer, confirm } from "../ui/overlays";
import "../ui/pages/court.css";

const PURPOSE_OPTIONS = [
  "Arguments", "Evidence", "Framing of Issues", "For Counter / Reply",
  "For Orders", "Interim Application", "Mention", "Cross-examination", "Other",
];

const EVENT_TYPES = [
  { value: "HEARING", label: "Hearing", cls: "hearing", tone: "" as const },
  { value: "MEETING", label: "Client Meeting", cls: "meeting", tone: "info" as const },
  { value: "PAYMENT_DUE", label: "Payment Due", cls: "payment", tone: "warn" as const },
  { value: "DOCUMENT", label: "Document Filing", cls: "filing", tone: "ok" as const },
];
const typeOf = (t?: string) => EVENT_TYPES.find((x) => x.value === t);
const FILTER_KEYS = [...EVENT_TYPES.map((t) => t.value), "TASK"];
const FILTER_LABEL: Record<string, string> = { ...Object.fromEntries(EVENT_TYPES.map((t) => [t.value, t.label])), TASK: "Task deadlines" };

const emptyEvent = {
  title: "", eventType: "", description: "", date: "", time: "", caseId: "" as any,
  purpose: "", court: "", benchHall: "", judge: "", nextDate: "", outcome: "",
};

type View = "day" | "week" | "month";
type Item = {
  id: any; kind: "event" | "task"; title: string; at: Date; hasTime: boolean;
  eventType?: string; raw?: any; taskId?: any; caseNumber?: string; overdue?: boolean;
};

const p2 = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const parseYmd = (s: string) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const monday = (d: Date) => { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const fdate = (d: Date, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) => d.toLocaleDateString("en-IN", o);
const ftime = (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const longDate = (d: Date) => fdate(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const itemCls = (it: Item) => it.kind === "task" ? `task${it.overdue ? " overdue" : ""}` : (typeOf(it.eventType)?.cls || "");

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
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [weekStart, setWeekStart] = useState(() => monday(new Date()));
  const [day, setDay] = useState(() => startOfDay(new Date()));   // the Day view's date
  const [types, setTypes] = useState<Set<string>>(() => new Set(FILTER_KEYS));
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [highlightedId, setHighlightedId] = useState<any>(null);
  const [open, setOpen] = useState<Item | null>(null);
  const [moreDay, setMoreDay] = useState<Date | null>(null);
  const [resched, setResched] = useState<{ date: string; time: string } | null>(null);
  const location = useLocation();
  const [newEvent, setNewEvent] = useState(emptyEvent);

  const { withLoading } = useLoading();
  const { success, error } = useToast();
  const { hasPermission } = usePermission();
  const canCreate = hasPermission("EVENT_CREATE");

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
      setEvents(res.data || []);
    } catch (err) {
      console.error("Error fetching events:", err);
    }
  }, []);

  const canSeeTasks = hasPermission("TASK_VIEW");
  const fetchTasks = useCallback(async () => {
    if (!canSeeTasks) return;
    try {
      const res = await api.get("/api/workspace/tasks/all");
      setTasks((res.data || []).filter((t: any) => t.deadline && !t.completed && !t.cancelled));
    } catch (err) {
      console.error("Error fetching tasks:", err);
    }
  }, [canSeeTasks]);

  useEffect(() => {
    fetchEvents();
    fetchCases();
    fetchTasks();
  }, [fetchEvents, fetchTasks]);

  const items: Item[] = useMemo(() => {
    const today = startOfDay(new Date());
    const evs: Item[] = events.map((e) => {
      const at = parseYmd(e.date);
      const t = e.time ? String(e.time).slice(0, 5) : "";
      if (t) { const [h, m] = t.split(":").map(Number); at.setHours(h, m); } else at.setHours(9, 0);
      return { id: e.id, kind: "event", title: e.title, at, hasTime: !!t, eventType: e.eventType, raw: e, caseNumber: e.caseEntity?.caseNumber };
    });
    const tks: Item[] = tasks.map((t) => {
      const at = parseYmd(t.deadline);
      return { id: `task-${t.id}`, kind: "task", taskId: t.id, title: t.title, at, hasTime: false, caseNumber: t.caseNumber, overdue: at < today, raw: t };
    });
    return [...evs, ...tks]
      .filter((it) => types.has(it.kind === "task" ? "TASK" : it.eventType || ""))
      .sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [events, tasks, types]);

  // A task on the calendar opens it on the Tasks page (search + highlight).
  const openItem = (it: Item) => {
    if (it.kind === "task") navigate("/dashboard/tasks", { state: { search: it.title, id: it.taskId } });
    else setOpen(it);
  };

  const openModal = (date?: Date) => {
    setFormError("");
    if (date) setNewEvent((ev) => ({ ...ev, date: ymd(date) }));
    setShowModal(true);
  };

  // Quick Actions / Lisa: open the Add New Event form.
  usePageModal(["create-hearing", "create-event"], () => openModal());

  // Global Search navigation: jump to the event's month and open it.
  useEffect(() => {
    const st = location.state as any;
    if (st?.search && st?.id) {
      setHighlightedId(st.id);
      const match = events.find((e) => e.id === st.id);
      if (match) {
        const at = parseYmd(match.date);
        setCursor(new Date(at.getFullYear(), at.getMonth(), 1));
        setWeekStart(monday(at));
        setDay(startOfDay(at));
        window.history.replaceState({}, document.title);
      }
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
      setFormError(err.response?.data?.message || err.response?.data?.error || err.message || "Failed to create event. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setFormError("");
    setNewEvent(emptyEvent);
  };

  const deleteEvent = (it: Item) => confirm({
    title: "Delete this event?",
    message: `${it.title} on ${fdate(it.at)} will be removed from the calendar. The case record is not changed.`,
    confirmLabel: "Delete event", danger: true,
    accept: async () => {
      try {
        await api.delete(`/api/events/delete/${it.id}`);
        setOpen(null);
        fetchEvents();
        success("Event deleted.");
      } catch (err: any) {
        error(err.response?.data?.error || "Could not delete the event.");
      }
    },
  });

  const saveResched = async () => {
    if (!open || !resched?.date) return;
    const e = open.raw;
    try {
      await api.put(`/api/events/update/${e.id}`, { title: e.title, eventType: e.eventType, date: resched.date, time: resched.time || null });
      setResched(null);
      setOpen(null);
      fetchEvents();
      success(`Moved to ${fdate(parseYmd(resched.date))}${resched.time ? `, ${resched.time}` : ""}.`);
    } catch (err: any) {
      error(err.response?.data?.error || "Could not reschedule the event.");
    }
  };

  // Prev / Next move by what the view shows.
  const step = (n: number) => {
    if (view === "day") setDay((d) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; });
    else if (view === "week") setWeekStart((w) => { const d = new Date(w); d.setDate(d.getDate() + 7 * n); return d; });
    else setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));
  };
  // The date the current view is "on": switching views lands there, not back
  // on today. Within the current month / week that means today itself.
  const focusDate = () => {
    const t = startOfDay(new Date());
    if (view === "day") return day;
    if (view === "week") return t >= weekStart && t < new Date(weekStart.getTime() + 7 * 86400000) ? t : weekStart;
    return cursor.getMonth() === t.getMonth() && cursor.getFullYear() === t.getFullYear() ? t : cursor;
  };
  const changeView = (v: View) => {
    const f = focusDate();
    setDay(startOfDay(f));
    setWeekStart(monday(f));
    setCursor(new Date(f.getFullYear(), f.getMonth(), 1));
    setView(v);
  };
  const toggleType = (k: string) => setTypes((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const today = new Date();
  const evButton = (it: Item, label?: React.ReactNode) => (
    <button key={it.id} type="button" className={`ev ${itemCls(it)}${highlightedId === it.id ? " hl" : ""}`}
      title={it.kind === "task" ? `${it.overdue ? "Overdue task" : "Task due"}: ${it.title} (opens on the Tasks page)` : `${typeOf(it.eventType)?.label || "Event"}: ${it.title}`}
      aria-label={`${it.kind === "task" ? "Task" : typeOf(it.eventType)?.label || "Event"}: ${it.title}${it.hasTime ? `, ${ftime(it.at)}` : ""}`}
      onClick={(e) => { e.stopPropagation(); setMoreDay(null); openItem(it); }}>
      {label ?? it.title}
    </button>
  );

  let title = "";
  let body: React.ReactNode;
  if (view === "week") {
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; });
    title = `${fdate(days[0], { day: "numeric", month: "short" })} to ${fdate(days[6])}`;
    const hours = Array.from({ length: 10 }, (_, i) => 9 + i);
    body = (
      <div className="pp-week-wrap">
        <div className="week" role="grid" aria-label="Week view">
          <div className="whd" />
          {days.map((d) => <div key={d.toISOString()} className={`whd${sameDay(d, today) ? " today" : ""}`}>{fdate(d, { weekday: "short" })}<b>{d.getDate()}</b></div>)}
          {hours.map((h) => [
            <div key={`t${h}`} className="tcell">{h}:00</div>,
            ...days.map((d) => {
              // Untimed items and those outside 9–18 sit in the nearest row.
              const here = items.filter((it) => sameDay(it.at, d) && Math.min(Math.max(it.hasTime ? it.at.getHours() : 9, 9), 18) === h);
              return (
                <div key={`${h}-${d.getDate()}`} className={`hcell${canCreate ? " addable" : ""}`}
                  onClick={(e) => { if (canCreate && e.target === e.currentTarget) { const x = new Date(d); openModal(x); setField("time", `${p2(h)}:00`); } }}>
                  {here.map((it, k) => (
                    <button key={it.id} type="button" className={`wev ${itemCls(it)}`}
                      style={{ top: 3 + (it.hasTime && it.at.getHours() >= 9 && it.at.getHours() < 19 ? (it.at.getMinutes() / 60) * 48 : 0), ...(here.length > 1 ? { left: `${3 + (k * 96) / here.length}%`, right: "auto", width: `${96 / here.length}%` } : {}) }}
                      onClick={() => openItem(it)} aria-label={`${it.title}${it.hasTime ? `, ${ftime(it.at)}` : ""}`}>
                      {it.hasTime && <><b className="mono">{ftime(it.at)}</b><br /></>}{it.title}
                    </button>
                  ))}
                </div>
              );
            }),
          ])}
        </div>
      </div>
    );
  } else if (view === "day") {
    title = longDate(day);
    const list = items.filter((it) => sameDay(it.at, day));
    body = (
      <div className="panel">
        <div className="pp-agenda-day">
          <div className={`stamp${sameDay(day, today) ? " today" : ""}`} aria-label={longDate(day)}><span>{fdate(day, { weekday: "short" })}</span><b>{day.getDate()}</b></div>
          {list.length ? (
            <ul>
              {list.map((it) => (
                <li key={it.id}>
                  <span className="t">{it.hasTime ? ftime(it.at) : "All day"}</span>
                  <span className="ellipsis">
                    <button type="button" className="link court-linkbtn" onClick={() => openItem(it)}>{it.title}</button>
                    {it.caseNumber && <span className="faint small mono"> {it.caseNumber}</span>}
                  </span>
                  {it.kind === "task"
                    ? <Chip tone={it.overdue ? "bad" : "tape"}>{it.overdue ? "Overdue task" : "Task"}</Chip>
                    : <Chip tone={typeOf(it.eventType)?.tone || ""}>{typeOf(it.eventType)?.label || it.eventType}</Chip>}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon="calendar" title="Nothing scheduled this day" text="Use Prev / Next, change the filters, or add an event." />
          )}
        </div>
        {canCreate && (
          <div className="row court-gap-b">
            <button type="button" className="btn" onClick={() => openModal(day)}><Icon name="plus" size="sm" />Add event on {fdate(day, { day: "numeric", month: "short" })}</button>
          </div>
        )}
      </div>
    );
  } else {
    title = fdate(cursor, { month: "long", year: "numeric" });
    const start = new Date(cursor); start.setDate(1 - ((cursor.getDay() + 6) % 7));
    const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
    body = (
      <div className="cal">
        <div className="cal-head">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d}>{d}</div>)}</div>
        <div className="cal-grid">
          {cells.map((d) => {
            const list = items.filter((it) => sameDay(it.at, d));
            const wk = d.getDay() === 0 || d.getDay() === 6;
            const isToday = sameDay(d, today);
            return (
              <div key={d.toISOString()} className={`cal-day${canCreate ? " pp-cal-day" : ""}${d.getMonth() !== cursor.getMonth() ? " out" : ""}${isToday ? " today" : ""}${wk ? " weekend" : ""}`}
                title={canCreate ? `Add an event on ${fdate(d)}` : undefined}
                onClick={(e) => { const t = e.target as HTMLElement; if (canCreate && (t === e.currentTarget || t.classList.contains("d"))) openModal(d); }}>
                <span className="d" aria-current={isToday ? "date" : undefined}>{d.getDate()}</span>
                {list.slice(0, 3).map((it) => evButton(it))}
                {list.length > 3 && <button type="button" className="pp-more" onClick={(e) => { e.stopPropagation(); setMoreDay(d); }}>+{list.length - 3} more</button>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const caseOptions = cases.map((c) => ({ value: c.id, label: `${c.caseNumber || "N/A"} — ${c.clientName || "Unknown"}` }));
  const ev = open?.raw;
  const hd = ev?.hearingDetail || {};
  const openType = typeOf(open?.eventType);

  return (
    <div className="court">
      <PageHead title="Calendar" sub="Hearings, client meetings, payment dues and filings. Click an empty part of a day to add an event."
        actions={canCreate && <button type="button" className="btn primary" onClick={() => openModal()}><Icon name="plus" size="sm" />Add event</button>} />

      <div className="pp-cal-tool">
        <button type="button" className="btn icon" onClick={() => step(-1)} aria-label="Previous"><Icon name="chevronLeft" size="sm" /></button>
        <button type="button" className="btn icon" onClick={() => step(1)} aria-label="Next"><Icon name="chevron" size="sm" /></button>
        <h2 aria-live="polite">{title}</h2>
        <Segmented<View> label="View" value={view} onChange={changeView}
          options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
        <span className="grow" />
        <div className="row wrap" role="group" aria-label="Event types">
          {FILTER_KEYS.filter((k) => k !== "TASK" || canSeeTasks).map((k) => (
            <FilterChip key={k} on={types.has(k)} onClick={() => toggleType(k)}>{FILTER_LABEL[k]}</FilterChip>
          ))}
        </div>
      </div>

      {body}

      <div className="legend court-legend">
        <span><i style={{ background: "var(--ink)" }} />Hearing</span>
        <span><i style={{ background: "var(--info)" }} />Client meeting</span>
        <span><i style={{ background: "var(--warn)" }} />Payment due</span>
        <span><i style={{ background: "var(--ok)" }} />Document filing</span>
        {canSeeTasks && <span><i className="court-legend-task" />Task deadline</span>}
        <span><i style={{ background: "var(--tape)" }} />Today</span>
      </div>

      {/* "+n more" in a month cell */}
      <Modal open={!!moreDay} onClose={() => setMoreDay(null)} size="narrow" title={moreDay ? longDate(moreDay) : ""}>
        <div className="stack court-more">
          {moreDay && items.filter((it) => sameDay(it.at, moreDay)).map((it) =>
            evButton(it, <>{it.hasTime && <span className="mono">{ftime(it.at)}</span>} {it.title}</>))}
        </div>
      </Modal>

      {/* Event details */}
      <Drawer open={!!open} onClose={() => { setOpen(null); setResched(null); }} title={open?.title || ""}
        sub={open && <span className="small muted">{openType?.label || open.eventType}, {longDate(open.at)}{open.hasTime ? `, ${ftime(open.at)}` : ""}</span>}
        footer={open && <>
          {hasPermission("EVENT_DELETE") && <button type="button" className="btn danger" onClick={() => deleteEvent(open)}><Icon name="trash" size="sm" />Delete</button>}
          <span className="grow" />
          {canCreate && <button type="button" className="btn primary"
            onClick={() => setResched({ date: ymd(open.at), time: open.hasTime ? ftime(open.at) : "" })}><Icon name="calendar" size="sm" />Reschedule</button>}
        </>}>
        {open && (
          <>
            <div className="row wrap court-gap-b">
              <Chip tone={openType?.tone || ""}>{openType?.label || open.eventType}</Chip>
              {startOfDay(open.at) < startOfDay(today) ? <Chip>Past</Chip> : sameDay(open.at, today) ? <Chip tone="tape">Today</Chip> : null}
            </div>
            <dl className="kv">
              <dt>Case</dt>
              <dd>{ev?.caseEntity ? <><Link className="link mono" to={`/dashboard/cases/${ev.caseEntity.id}`}>{ev.caseEntity.caseNumber || `Case ${ev.caseEntity.id}`}</Link>{ev.caseEntity.caseTitle && <div className="faint xs">{ev.caseEntity.caseTitle}</div>}</> : "—"}</dd>
              <dt>Time</dt><dd>{open.hasTime ? ftime(open.at) : "Not set"}</dd>
              {open.eventType === "HEARING" && <>
                <dt>Court</dt><dd>{hd.court || "—"}</dd>
                <dt>Hall</dt><dd>{hd.benchHall || "—"}</dd>
                <dt>Judge</dt><dd>{hd.judge || "—"}</dd>
                <dt>Purpose</dt><dd>{hd.purpose || "—"}</dd>
                {hd.nextDate && <><dt>Next date</dt><dd>{fdate(parseYmd(hd.nextDate))}</dd></>}
                {hd.outcome && <><dt>Outcome</dt><dd>{hd.outcome}</dd></>}
              </>}
              <dt>Notes</dt><dd>{ev?.description || "—"}</dd>
            </dl>
          </>
        )}
      </Drawer>

      <Modal open={!!resched} onClose={() => setResched(null)} size="narrow" title="Reschedule" sub={open?.title}
        footer={<>
          <button type="button" className="btn ghost" onClick={() => setResched(null)}>Cancel</button>
          <button type="button" className="btn primary" onClick={saveResched} disabled={!resched?.date}>Move event</button>
        </>}>
        {resched && (
          <div className="form-grid">
            <TextField label="New date" type="date" required value={resched.date} onChange={(e) => setResched({ ...resched, date: e.target.value })} />
            <TextField label="Time" type="time" value={resched.time} onChange={(e) => setResched({ ...resched, time: e.target.value })} />
          </div>
        )}
      </Modal>

      <Modal open={showModal} onClose={closeModal} title="Add event" sub="Every event belongs to a case."
        footer={<>
          <button type="button" className="btn ghost" onClick={closeModal}>Cancel</button>
          <button type="submit" form="event-form" className={`btn primary${saving ? " loading" : ""}`} disabled={saving}>{saving ? "Saving…" : "Save event"}</button>
        </>}>
        {formError && <div className="callout bad court-gap-b" role="alert"><Icon name="warn" size="sm" /><div>{formError}</div></div>}
        <form id="event-form" onSubmit={handleAddEvent} className="form-grid" noValidate>
          <TextField full label="Title" name="title" required placeholder="e.g. Final arguments" value={newEvent.title} onChange={handleChange} />
          <SelectField label="Type" required value={newEvent.eventType} placeholder="Select type"
            options={EVENT_TYPES.map((t) => ({ value: t.value, label: t.label }))} onChange={(e) => setField("eventType", e.target.value)} />
          <SelectField label="Case" required value={newEvent.caseId} placeholder="Select the case"
            options={caseOptions} onChange={(e) => setField("caseId", e.target.value)} />
          <TextField label="Date" type="date" required value={newEvent.date} onChange={(e) => setField("date", e.target.value)} />
          <TextField label="Time" type="time" value={newEvent.time} onChange={(e) => setField("time", e.target.value)} />

          {newEvent.eventType === "HEARING" && <>
            <SelectField label="Purpose / stage" value={newEvent.purpose} placeholder="Not set"
              options={PURPOSE_OPTIONS} onChange={(e) => setField("purpose", e.target.value)} />
            <TextField label="Court" name="court" value={newEvent.court} onChange={handleChange} />
            <TextField label="Bench / hall no." name="benchHall" value={newEvent.benchHall} onChange={handleChange} />
            <TextField label="Judge / coram" name="judge" value={newEvent.judge} onChange={handleChange} />
            <TextField label="Next hearing date" type="date" value={newEvent.nextDate} onChange={(e) => setField("nextDate", e.target.value)} />
            <TextArea full label="Outcome / order" hint="After the hearing" name="outcome" rows={2} value={newEvent.outcome} onChange={handleChange} />
          </>}

          <TextArea full label="Description" name="description" rows={3} value={newEvent.description} onChange={handleChange} />
        </form>
      </Modal>
    </div>
  );
}

export default HearingsPage;
