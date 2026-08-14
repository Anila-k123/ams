import React, { useState, useEffect, useRef, useMemo } from "react";
import { FiSearch, FiX, FiPlus, FiClock, FiTrash2, FiFileText, FiUsers, FiBriefcase, FiCalendar, FiDollarSign, FiCreditCard, FiFolder } from "react-icons/fi";
import { useSearch } from "../contexts/SearchContext";
import SearchResultCard from "./SearchResultCard";

const SECTIONS = ["clients", "cases", "hearings", "invoices", "expenses", "documents", "payments"];

const SECTION_LABELS = {
  clients: "Clients",
  cases: "Cases",
  hearings: "Hearings",
  invoices: "Invoices",
  expenses: "Expenses",
  documents: "Documents",
  payments: "Payments",
};

const QUICK_ACTIONS = [
  { icon: <FiUsers />, label: "New Client", action: "clients" },
  { icon: <FiBriefcase />, label: "New Case", action: "cases" },
  { icon: <FiCalendar />, label: "New Hearing", action: "hearings" },
  { icon: <FiDollarSign />, label: "Generate Invoice", action: "invoices" },
  { icon: <FiFolder />, label: "Upload Document", action: "documents" },
  { icon: <FiCreditCard />, label: "Add Expense", action: "expenses" },
  { icon: <FiFileText />, label: "Record Payment", action: "payments" },
];

function buildFlatList(results) {
  if (!results) return [];
  const flat = [];
  for (const section of SECTIONS) {
    const key = section === "hearings" ? "events" : section;
    const items = results[key];
    if (items && items.length > 0) {
      for (const item of items) {
        flat.push({ section: key, originalSection: section, item });
      }
    }
  }
  return flat;
}

export default function GlobalSearchModal({ isOpen, onClose, onNavigate, onQuickAction }) {
  const { query, results, loading, selectedIndex, recentSearches, setQuery, setSelectedIndex, addRecentSearch, clearRecentSearches, resetSearch } = useSearch();
  const [showRecent, setShowRecent] = useState(true);
  const inputRef = useRef(null);
  const modalRef = useRef(null);

  const flatList = useMemo(() => buildFlatList(results), [results]);
  const totalCount = flatList.length;

  useEffect(() => {
    if (isOpen) {
      resetSearch();
      setShowRecent(true);
      setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 50);
    }
  }, [isOpen, resetSearch]);

  useEffect(() => {
    setShowRecent(!query.trim());
  }, [query]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return;

      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        const maxIndex = totalCount > 0 ? totalCount - 1 : 0;
        setSelectedIndex((prev) => Math.min(prev + 1, maxIndex));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (totalCount > 0 && flatList[selectedIndex]) {
          const entry = flatList[selectedIndex];
          addRecentSearch(getResultTitle(entry.section, entry.item));
          onNavigate(entry.section, entry.item);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, flatList, selectedIndex, onNavigate, onClose, addRecentSearch, totalCount, setSelectedIndex]);

  useEffect(() => {
    if (results && !loading) setSelectedIndex(0);
  }, [results, loading, setSelectedIndex]);

  const handleResultClick = (section, item) => {
    addRecentSearch(getResultTitle(section, item));
    onNavigate(section, item);
  };

  const handleQuickAction = (action) => {
    onClose();
    if (onQuickAction) onQuickAction(action);
  };

  const handleRecentClick = (term) => {
    setQuery(term);
  };

  if (!isOpen) return null;

  return (
    <div className="search-modal-overlay" onClick={onClose}>
      <div className="global-search-modal" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <div className="global-search-input">
          <FiSearch className="global-search-input-icon" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search clients, cases, documents, payments..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="global-search-clear" onClick={() => { setQuery(""); inputRef.current?.focus(); }}>
              <FiX />
            </button>
          )}
        </div>

        <div className="global-search-body">
          {loading && (
            <div className="global-search-loading">
              <div className="global-search-spinner" />
              <span>Searching...</span>
            </div>
          )}

          {!loading && showRecent && !query.trim() && (
            <div className="global-search-recent">
              {recentSearches.length > 0 && (
                <>
                  <div className="global-search-section-label">
                    <FiClock className="gs-section-icon" />
                    Recent Searches
                    <button className="gs-clear-recent" onClick={clearRecentSearches} title="Clear recent searches">
                      <FiTrash2 />
                    </button>
                  </div>
                  <div className="gs-recent-list">
                    {recentSearches.map((term, idx) => (
                      <div
                        key={idx}
                        className="gs-recent-item"
                        onClick={() => handleRecentClick(term)}
                      >
                        <FiClock className="gs-recent-icon" />
                        <span>{term}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <div className="global-search-section-label">
                <FiPlus className="gs-section-icon" />
                Quick Actions
              </div>
              <div className="gs-quick-actions">
                {QUICK_ACTIONS.map((qa, idx) => (
                  <button
                    key={idx}
                    className="gs-quick-action-btn"
                    onClick={() => handleQuickAction(qa.action)}
                  >
                    <span className="gs-qa-icon">{qa.icon}</span>
                    <span className="gs-qa-label">{qa.label}</span>
                  </button>
                ))}
              </div>

              {recentSearches.length === 0 && (
                <div className="global-search-hint">
                  Start typing to search across clients, cases, hearings, documents, invoices, expenses, and payments.
                </div>
              )}
            </div>
          )}

          {!loading && !showRecent && query.trim() && totalCount === 0 && (
            <div className="global-search-empty">
              <div className="gs-empty-icon">\uD83D\uDD0D</div>
              <div className="gs-empty-title">No results found</div>
              <div className="gs-empty-desc">Try different keywords or check your spelling.</div>
            </div>
          )}

          {!loading && results && totalCount > 0 && (
            <div className="global-search-results">
              {SECTIONS.map((section) => {
                const key = section === "hearings" ? "events" : section;
                const items = results[key];
                if (!items || items.length === 0) return null;
                return (
                  <div key={section} className="gs-section">
                    <div className="global-search-section-label">{SECTION_LABELS[section]}</div>
                    {items.map((item, idx) => {
                      const globalIdx = flatList.findIndex(
                        (f) => f.section === key && f.item === item
                      );
                      const isSelected = globalIdx === selectedIndex;
                      return (
                        <SearchResultCard
                          key={item.id || idx}
                          section={section}
                          item={item}
                          isSelected={isSelected}
                          onClick={() => handleResultClick(key, item)}
                          onMouseEnter={() => setSelectedIndex(globalIdx)}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="global-search-footer">
          <span className="gs-footer-nav">
            <kbd>&uarr;</kbd><kbd>&darr;</kbd> Navigate
          </span>
          <span className="gs-footer-nav">
            <kbd>&#9166;</kbd> Open
          </span>
          <span className="gs-footer-nav">
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}

function getResultTitle(section, item) {
  switch (section) {
    case "clients": return item.name || "";
    case "cases": return item.caseTitle || item.caseNumber || "";
    case "hearings":
    case "events": return item.title || "";
    case "documents": return item.documentName || item.originalName || "";
    case "invoices": return item.invoiceNumber || "";
    case "expenses": return item.title || "";
    case "payments": return `Payment #${item.id || ""}`;
    case "tasks": return item.title || "";
    default: return "";
  }
}
