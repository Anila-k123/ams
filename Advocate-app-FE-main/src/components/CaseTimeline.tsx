import { useState, useEffect, useCallback } from "react";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { MultiSelect } from "primereact/multiselect";
import { Button } from "primereact/button";
import { ProgressSpinner } from "primereact/progressspinner";
import api from "../api/client";
import "../assets/styles/CaseTimeline.css";

const FILTER_GROUPS = [
  { label: "Payments", types: ["PAYMENT_RECEIVED", "PAYMENT_UPDATED", "PAYMENT_DELETED"] },
  { label: "Expenses", types: ["EXPENSE_ADDED", "EXPENSE_UPDATED", "EXPENSE_DELETED"] },
  { label: "Documents", types: ["DOCUMENT_UPLOADED", "DOCUMENT_DELETED"] },
  { label: "Hearings", types: ["HEARING_CREATED", "HEARING_UPDATED", "HEARING_RESCHEDULED", "HEARING_COMPLETED"] },
  { label: "Invoices", types: ["INVOICE_GENERATED", "INVOICE_PAID"] },
  { label: "Status Changes", types: ["CASE_CREATED", "CASE_UPDATED", "CASE_STATUS_CHANGED", "CASE_CLOSED", "CASE_REOPENED"] },
  { label: "Communication", types: ["EMAIL_SENT", "WHATSAPP_SENT"] },
];

export default function CaseTimeline({ caseId, caseNumber, onClose }: { caseId: any; caseNumber?: any; onClose: () => void }) {
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

  // A filter group is selected when all of its event types are active.
  const selectedGroups = FILTER_GROUPS.filter((g) => g.types.every((t) => activeFilters.includes(t))).map((g) => g.label);
  const setGroups = (labels: string[]) => {
    const types: string[] = [];
    FILTER_GROUPS.filter((g) => labels.includes(g.label)).forEach((g) => types.push(...g.types));
    setActiveFilters(types);
  };

  const loadMore = () => fetchTimeline(page + 1, true);

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const diffMs = Date.now() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;

    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <Dialog
      visible
      onHide={onClose}
      modal
      style={{ width: "720px" }}
      breakpoints={{ "768px": "100vw" }}
      header={
        <div>
          <div>Case Timeline</div>
          <div className="text-sm font-normal" style={{ color: "var(--text-muted)" }}>{caseNumber}</div>
        </div>
      }
      footer={hasMore && events.length > 0 ? (
        <div className="timeline-load-more">
          <Button size="small" outlined label={loading ? "Loading..." : "Load More"} onClick={loadMore} disabled={loading} />
        </div>
      ) : null}
    >
      <div className="flex flex-column md:flex-row gap-2 mb-3">
        <span className="p-input-icon-left flex-1">
          <i className="pi pi-search" />
          <InputText className="w-full" placeholder="Search timeline..." value={search}
            onChange={(e) => setSearch(e.target.value)} />
        </span>
        <MultiSelect value={selectedGroups} options={FILTER_GROUPS.map((g) => g.label)}
          onChange={(e) => setGroups(e.value || [])} placeholder="Filters" showClear
          maxSelectedLabels={1} selectedItemsLabel={`${selectedGroups.length} filters`}
          className="md:w-14rem" />
      </div>

      <div className="timeline-body">
        {loading && events.length === 0 ? (
          <div className="timeline-loading"><ProgressSpinner style={{ width: 32, height: 32 }} strokeWidth="4" /></div>
        ) : events.length === 0 ? (
          <div className="timeline-empty">No timeline events found for this case.</div>
        ) : (
          <div className="timeline-list">
            {events.map((event, idx) => (
              <div
                key={event.id}
                className={`timeline-item ${idx === 0 ? "latest" : ""}`}
                style={{ "--event-color": event.color || "#94A3B8" } as any}
              >
                <div className="timeline-connector">
                  <div className="timeline-dot" style={{ background: event.color || "#94A3B8" }}>
                    <span className="timeline-dot-icon">{event.icon || "📌"}</span>
                  </div>
                  {idx < events.length - 1 && <div className="timeline-line" />}
                </div>
                <div className="timeline-card">
                  <div className="timeline-card-header">
                    <span className="timeline-event-title">{event.title}</span>
                    <div className="timeline-date-badge">
                      <i className="pi pi-calendar" style={{ fontSize: 11 }} />
                      <span>{formatDate(event.createdAt)}</span>
                      <i className="pi pi-clock" style={{ fontSize: 11 }} />
                      <span>{formatTime(event.createdAt)}</span>
                    </div>
                  </div>
                  {event.description && <p className="timeline-event-desc">{event.description}</p>}
                  <div className="timeline-card-footer">
                    {event.referenceType && (
                      <span className="timeline-ref-badge" style={{ borderColor: event.color || "#94A3B8", color: event.color || "#94A3B8" }}>
                        {event.referenceType}
                        {event.referenceId ? ` #${event.referenceId}` : ""}
                      </span>
                    )}
                    {event.performedBy && <span className="timeline-performed-by">{event.performedBy}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
