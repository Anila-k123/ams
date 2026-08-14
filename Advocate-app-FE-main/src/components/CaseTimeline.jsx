import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { FiX, FiFilter, FiSearch, FiClock, FiCalendar, FiChevronDown } from "react-icons/fi";
import "../assets/styles/CaseTimeline.css";

const API_BASE = `${import.meta.env.VITE_API_BASE || "http://localhost:8080"}/api`;

const FILTER_GROUPS = [
  { label: "Payments", types: ["PAYMENT_RECEIVED", "PAYMENT_UPDATED", "PAYMENT_DELETED"] },
  { label: "Expenses", types: ["EXPENSE_ADDED", "EXPENSE_UPDATED", "EXPENSE_DELETED"] },
  { label: "Documents", types: ["DOCUMENT_UPLOADED", "DOCUMENT_DELETED"] },
  { label: "Hearings", types: ["HEARING_CREATED", "HEARING_UPDATED", "HEARING_RESCHEDULED", "HEARING_COMPLETED"] },
  { label: "Invoices", types: ["INVOICE_GENERATED", "INVOICE_PAID"] },
  { label: "Status Changes", types: ["CASE_CREATED", "CASE_UPDATED", "CASE_STATUS_CHANGED", "CASE_CLOSED", "CASE_REOPENED"] },
  { label: "Communication", types: ["EMAIL_SENT", "WHATSAPP_SENT"] },
];

export default function CaseTimeline({ caseId, caseNumber, onClose }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeFilters, setActiveFilters] = useState([]);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);

  const token = localStorage.getItem("token");
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

  const fetchTimeline = useCallback(async (pageNum = 0, append = false) => {
    setLoading(true);
    try {
      const params = { page: pageNum, size: 20 };
      if (search.trim()) params.search = search.trim();
      if (activeFilters.length > 0) params.eventType = activeFilters.join(",");

      const res = await axios.get(`${API_BASE}/cases/${caseId}/timeline`, { ...authHeaders, params });
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
  }, [caseId, search, activeFilters, token]);

  useEffect(() => {
    fetchTimeline(0, false);
  }, [fetchTimeline]);

  useEffect(() => {
    setPage(0);
    fetchTimeline(0, false);
  }, [search, activeFilters]);

  const toggleFilter = (types) => {
    setActiveFilters((prev) => {
      const allActive = types.every((t) => prev.includes(t));
      if (allActive) {
        return prev.filter((t) => !types.includes(t));
      }
      const newFilters = [...prev];
      types.forEach((t) => {
        if (!newFilters.includes(t)) newFilters.push(t);
      });
      return newFilters;
    });
  };

  const isFilterActive = (types) => types.every((t) => activeFilters.includes(t));

  const loadMore = () => fetchTimeline(page + 1, true);

  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;

    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  };

  const formatTime = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="timeline-modal-overlay" onClick={onClose}>
      <div className="timeline-modal" onClick={(e) => e.stopPropagation()}>
        <div className="timeline-header">
          <div>
            <h3>Case Timeline</h3>
            <span className="timeline-case-ref">{caseNumber}</span>
          </div>
          <button className="timeline-close-btn" onClick={onClose}>
            <FiX size={18} />
          </button>
        </div>

        <div className="timeline-toolbar">
          <div className="timeline-search">
            <FiSearch size={14} />
            <input
              type="text"
              placeholder="Search timeline..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="timeline-filter-wrapper">
            <button
              className={`timeline-filter-toggle ${showFilters || activeFilters.length > 0 ? "active" : ""}`}
              onClick={() => setShowFilters(!showFilters)}
            >
              <FiFilter size={14} />
              Filters
              {activeFilters.length > 0 && <span className="filter-count">{activeFilters.length}</span>}
              <FiChevronDown size={12} />
            </button>
            {showFilters && (
              <div className="timeline-filter-dropdown">
                {FILTER_GROUPS.map((group) => (
                  <label key={group.label} className="timeline-filter-option">
                    <input
                      type="checkbox"
                      checked={isFilterActive(group.types)}
                      onChange={() => toggleFilter(group.types)}
                    />
                    <span>{group.label}</span>
                  </label>
                ))}
                {activeFilters.length > 0 && (
                  <button className="timeline-clear-filters" onClick={() => setActiveFilters([])}>
                    Clear all filters
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="timeline-body">
          {loading && events.length === 0 ? (
            <div className="timeline-loading">Loading timeline...</div>
          ) : events.length === 0 ? (
            <div className="timeline-empty">No timeline events found for this case.</div>
          ) : (
            <div className="timeline-list">
              {events.map((event, idx) => (
                <div
                  key={event.id}
                  className={`timeline-item ${idx === 0 ? "latest" : ""}`}
                  style={{ "--event-color": event.color || "#94A3B8" }}
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
                        <FiCalendar size={11} />
                        <span>{formatDate(event.createdAt)}</span>
                        <FiClock size={11} />
                        <span>{formatTime(event.createdAt)}</span>
                      </div>
                    </div>
                    {event.description && (
                      <p className="timeline-event-desc">{event.description}</p>
                    )}
                    <div className="timeline-card-footer">
                      {event.referenceType && (
                        <span className="timeline-ref-badge" style={{ borderColor: event.color || "#94A3B8", color: event.color || "#94A3B8" }}>
                          {event.referenceType}
                          {event.referenceId ? ` #${event.referenceId}` : ""}
                        </span>
                      )}
                      {event.performedBy && (
                        <span className="timeline-performed-by">{event.performedBy}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {hasMore && events.length > 0 && (
          <div className="timeline-load-more">
            <button onClick={loadMore} disabled={loading}>
              {loading ? "Loading..." : "Load More"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
