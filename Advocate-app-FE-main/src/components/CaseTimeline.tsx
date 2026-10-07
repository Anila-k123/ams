import { useState, useEffect, useCallback } from "react";
import api from "../api/client";
import { usePermission } from "../contexts/PermissionContext";
import { Button, EmptyState, Skel } from "../ui/kit";
import { SearchInput, FilterChip } from "../ui/forms";
import "../ui/pages/casedetail.css";

// The case's activity timeline (payments, expenses, documents, hearings, status
// changes …), rendered inline in the case page's Timeline tab.

// `perm`: the filter only shows to someone who can see those entries (the
// server leaves them out of the timeline for everyone else).
const ALL_FILTER_GROUPS: { label: string; perm?: string; types: string[] }[] = [
  { label: "Payments", perm: "PAYMENT_VIEW", types: ["PAYMENT_RECEIVED", "PAYMENT_UPDATED", "PAYMENT_DELETED"] },
  { label: "Expenses", perm: "EXPENSE_VIEW", types: ["EXPENSE_ADDED", "EXPENSE_UPDATED", "EXPENSE_DELETED"] },
  { label: "Documents", perm: "DOCUMENT_VIEW", types: ["DOCUMENT_UPLOADED", "DOCUMENT_DELETED"] },
  { label: "Hearings", perm: "EVENT_VIEW", types: ["HEARING_CREATED", "HEARING_UPDATED", "HEARING_RESCHEDULED", "HEARING_COMPLETED"] },
  { label: "Invoices", perm: "INVOICE_VIEW", types: ["INVOICE_GENERATED", "INVOICE_PAID"] },
  { label: "Status Changes", types: ["CASE_CREATED", "CASE_UPDATED", "CASE_STATUS_CHANGED", "CASE_CLOSED", "CASE_REOPENED"] },
  { label: "Tasks", types: ["TASK_ASSIGNED", "TASK_SUBMITTED", "TASK_APPROVED", "TASK_CHANGES_REQUESTED"] },
  { label: "Notes", types: ["NOTE_ADDED"] },
  { label: "Communication", types: ["EMAIL_SENT", "WHATSAPP_SENT"] },
];

const KEY_TYPES = new Set(["CASE_CREATED", "CASE_STATUS_CHANGED", "CASE_CLOSED", "CASE_REOPENED", "HEARING_COMPLETED", "INVOICE_PAID", "PAYMENT_RECEIVED"]);

export default function CaseTimeline({ caseId }: { caseId: any; caseNumber?: any; onClose?: () => void }) {
  const { hasPermission } = usePermission() as any;
  const FILTER_GROUPS = ALL_FILTER_GROUPS.filter((g) => !g.perm || hasPermission(g.perm));
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const fetchTimeline = useCallback(async (pageNum = 0, append = false) => {
    setLoading(true);
    try {
      const params: any = { page: pageNum, size: 20 };
      if (search.trim()) params.search = search.trim();
      if (activeFilters.length > 0) params.eventType = activeFilters.join(",");

      const res = await api.get(`/api/cases/${caseId}/timeline`, { params });
      const data = res.data;

      if (append) {
        setEvents((prev) => [...prev, ...data.content]);
      } else {
        setEvents(data.content || []);
      }
      setHasMore(!data.last);
      setPage(pageNum);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [caseId, search, activeFilters]);

  // Refetch page 0 whenever the case, search or filters change.
  useEffect(() => {
    fetchTimeline(0, false);
  }, [fetchTimeline]);

  // A filter group is on when all of its event types are active.
  const isOn = (g: { types: string[] }) => g.types.every((t) => activeFilters.includes(t));
  const toggleGroup = (g: { types: string[] }) =>
    setActiveFilters((prev) => (g.types.every((t) => prev.includes(t))
      ? prev.filter((t) => !g.types.includes(t))
      : [...prev, ...g.types.filter((t) => !prev.includes(t))]));

  const loadMore = () => fetchTimeline(page + 1, true);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const diffDays = Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  };
  const formatTime = (dateStr: string) =>
    dateStr ? new Date(dateStr).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";

  return (
    <div className="stack" style={{ gap: "var(--s4)" }}>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search the timeline" />
      </div>
      <div className="cs-tl-filters" role="group" aria-label="Filter the timeline">
        {FILTER_GROUPS.map((g) => (
          <FilterChip key={g.label} on={isOn(g)} onClick={() => toggleGroup(g)}>{g.label}</FilterChip>
        ))}
        {activeFilters.length > 0 && <Button variant="ghost" size="sm" onClick={() => setActiveFilters([])}>Clear</Button>}
      </div>

      {loading && events.length === 0 ? (
        <div className="stack" style={{ gap: 10 }}><Skel h={16} w="60%" /><Skel h={12} w="40%" /><Skel h={16} w="70%" /><Skel h={12} w="30%" /></div>
      ) : events.length === 0 ? (
        <EmptyState icon="history" title="Nothing on the timeline" text="No timeline events match for this case." />
      ) : (
        <div className="timeline">
          {events.map((event, idx) => (
            <div key={event.id} className={`tl-item${idx === 0 || KEY_TYPES.has(event.eventType) ? " key" : ""}`}>
              <div className="small"><b>{event.title}</b></div>
              {event.description && <div className="small muted" style={{ whiteSpace: "pre-wrap" }}>{event.description}</div>}
              <div className="when">
                {formatDate(event.createdAt)}, {formatTime(event.createdAt)}
                {event.performedBy ? ` · ${event.performedBy}` : ""}
                {event.referenceType ? ` · ${event.referenceType}${event.referenceId ? ` #${event.referenceId}` : ""}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasMore && events.length > 0 && (
        <div><Button size="sm" loading={loading} disabled={loading} onClick={loadMore}>{loading ? "Loading…" : "Load more"}</Button></div>
      )}
    </div>
  );
}
