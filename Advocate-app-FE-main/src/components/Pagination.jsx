import { useMemo } from "react";
import { FiChevronLeft, FiChevronRight, FiChevronsLeft, FiChevronsRight } from "react-icons/fi";

const PAGE_RANGE = 2;

export default function Pagination({ page, totalPages, totalElements, size, onPageChange, onSizeChange }) {
  const pages = useMemo(() => {
    if (totalPages <= 1) return [];
    const range = [];
    const start = Math.max(0, page - PAGE_RANGE);
    const end = Math.min(totalPages - 1, page + PAGE_RANGE);
    if (start > 0) range.push(0);
    if (start > 1) range.push("ellipsis");
    for (let i = start; i <= end; i++) range.push(i);
    if (end < totalPages - 2) range.push("ellipsis");
    if (end < totalPages - 1) range.push(totalPages - 1);
    return range;
  }, [page, totalPages]);

  if (totalPages <= 1) return null;

  const from = page * size + 1;
  const to = Math.min((page + 1) * size, totalElements);

  const btnBase = {
    background: "var(--card-bg)",
    border: "1px solid var(--border-color)",
    color: "var(--text-muted)",
    borderRadius: 8,
    padding: "6px 12px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    transition: "all 0.15s",
  };
  const btnDisabled = { ...btnBase, opacity: 0.4, cursor: "default" };
  const btnActive = {
    ...btnBase,
    background: "var(--accent-blue, #6366f1)",
    borderColor: "var(--accent-blue, #6366f1)",
    color: "#fff",
  };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      flexWrap: "wrap",
      gap: 16,
      padding: "16px 0",
    }}>
      <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
        Showing {from}–{to} of {totalElements}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          onClick={() => onPageChange(0)}
          disabled={page === 0}
          style={page === 0 ? btnDisabled : btnBase}
          title="First page"
        >
          <FiChevronsLeft size={14} />
        </button>
        <button
          onClick={() => onPageChange(p => p - 1)}
          disabled={page === 0}
          style={page === 0 ? btnDisabled : btnBase}
          title="Previous page"
        >
          <FiChevronLeft size={14} />
        </button>

        {pages.map((p, i) =>
          p === "ellipsis" ? (
            <span key={`e${i}`} style={{ color: "var(--text-muted)", fontSize: 13, padding: "0 4px" }}>…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              style={p === page ? btnActive : btnBase}
            >
              {p + 1}
            </button>
          )
        )}

        <button
          onClick={() => onPageChange(p => p + 1)}
          disabled={page >= totalPages - 1}
          style={page >= totalPages - 1 ? btnDisabled : btnBase}
          title="Next page"
        >
          <FiChevronRight size={14} />
        </button>
        <button
          onClick={() => onPageChange(totalPages - 1)}
          disabled={page >= totalPages - 1}
          style={page >= totalPages - 1 ? btnDisabled : btnBase}
          title="Last page"
        >
          <FiChevronsRight size={14} />
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ color: "var(--text-muted)", fontSize: 13, whiteSpace: "nowrap" }}>Rows per page:</label>
        <select
          value={size}
          onChange={(e) => {
            onSizeChange(Number(e.target.value));
            onPageChange(0);
          }}
          style={{
            background: "var(--card-bg)",
            border: "1px solid var(--border-color)",
            color: "var(--text-primary)",
            borderRadius: 8,
            padding: "6px 10px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          {[10, 20, 50, 100].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
