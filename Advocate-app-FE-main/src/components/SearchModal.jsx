import React, { useState, useEffect, useRef, useCallback } from "react";
import { FiSearch, FiX } from "react-icons/fi";
import { useLoading } from "../contexts/LoadingContext";
import { formatCurrency } from "../utils/formatCurrency";
import "../assets/styles/SearchModal.css";

const API_BASE = `${import.meta.env.VITE_API_BASE || "http://localhost:8080"}/api/search`;

const SECTION_ICONS = {
  clients: "\uD83D\uDC64",
  cases: "\u2696\uFE0F",
  documents: "\uD83D\uDCC4",
  invoices: "\uD83D\uDCB0",
  expenses: "\uD83D\uDCB8",
  tasks: "\u2714\uFE0F",
  events: "\uD83D\uDCC5"
};

function buildFlatList(results) {
  if (!results) return [];
  const flat = [];
  for (const section of ["clients", "cases", "documents", "invoices", "expenses", "tasks", "events"]) {
    const items = results[section];
    if (items && items.length > 0) {
      for (const item of items) {
        flat.push({ section, item });
      }
    }
  }
  return flat;
}

function getDisplayTitle(section, item) {
  switch (section) {
    case "clients": return item.name;
    case "cases": return item.caseTitle || item.caseNumber;
    case "documents": return item.documentName || item.originalName;
    case "invoices": return item.invoiceNumber;
    case "expenses": return item.title;
    case "tasks": return item.title;
    case "events": return item.title;
    default: return "";
  }
}

function getDisplaySubtitle(section, item) {
  switch (section) {
    case "clients": return item.email || item.phone;
    case "cases": return `${item.caseNumber} - ${item.status || ""}`;
    case "documents": return item.category || item.fileType || item.originalName;
    case "invoices": return `${item.status} - ${formatCurrency(item.amount)}`;
    case "expenses": return item.category ? `${item.category} - ${formatCurrency(item.amount)}` : formatCurrency(item.amount);
    case "tasks": return item.completed ? "Completed" : item.priority || "";
    case "events": return item.eventType || "";
    default: return "";
  }
}

function getSectionLabel(section) {
  return section.toUpperCase();
}

export default function SearchModal({ isOpen, onClose, onNavigate }) {
  const { withLoading } = useLoading();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const modalRef = useRef(null);

  const flatList = buildFlatList(results);
  const totalCount = flatList.length;

  const performSearch = useCallback(async (q) => {
    if (abortRef.current) abortRef.current.abort();
    if (!q.trim()) { setResults(null); setLoading(false); return; }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);

    try {
      const token = localStorage.getItem("token");
      const res = await withLoading(
        fetch(`${API_BASE}?q=${encodeURIComponent(q.trim())}`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal
        }),
        "Searching..."
      );
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      console.log("[GlobalSearch] Received JSON:", data);
      setResults(data);
      setSelectedIndex(0);
    } catch (err) {
      if (err.name !== "AbortError") {
        console.error("[GlobalSearch] Error:", err);
        setResults(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults(null); setLoading(false); return; }
    debounceRef.current = setTimeout(() => performSearch(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, performSearch]);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setResults(null);
      setLoading(false);
      setSelectedIndex(0);
      setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 50);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") { onClose(); return; }
      if (!flatList.length) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, flatList.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const entry = flatList[selectedIndex];
        if (entry) onNavigate(entry.section, entry.item);
      }
    };

    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, flatList, selectedIndex, onNavigate, onClose]);

  useEffect(() => {
    if (isOpen) setSelectedIndex(0);
  }, [results, isOpen]);

  if (!isOpen) return null;

  return (
    <div className="search-modal-overlay" onClick={onClose}>
      <div className="search-modal" ref={modalRef} onClick={(e) => e.stopPropagation()}>
        <div className="search-modal-input">
          <FiSearch className="search-modal-input-icon" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search everything..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button className="search-modal-clear" onClick={() => setQuery("")}>
              <FiX />
            </button>
          )}
        </div>

        <div className="search-modal-body">
          {loading && (
            <div className="search-modal-status">Searching...</div>
          )}

          {!loading && query.trim() && totalCount === 0 && (
            <div className="search-modal-status">No matching records found.</div>
          )}

          {!loading && results && (
            <div className="search-modal-results">
              {["clients", "cases", "documents", "invoices", "expenses", "tasks", "events"].map((section) => {
                const items = results[section];
                if (!items || items.length === 0) return null;
                return (
                  <div key={section} className="search-section">
                    <div className="search-section-header">
                      {SECTION_ICONS[section]} {getSectionLabel(section)}
                    </div>
                    {items.map((item, idx) => {
                      const globalIdx = flatList.indexOf(
                        flatList.find((f) => f.section === section && f.item === item)
                      );
                      const isSelected = globalIdx === selectedIndex;
                      return (
                        <div
                          key={item.id || idx}
                          className={`search-result-item ${isSelected ? "selected" : ""}`}
                          onClick={() => onNavigate(section, item)}
                          onMouseEnter={() => setSelectedIndex(globalIdx)}
                        >
                          <div className="search-result-icon">{SECTION_ICONS[section]}</div>
                          <div className="search-result-text">
                            <div className="search-result-title">{getDisplayTitle(section, item)}</div>
                            <div className="search-result-subtitle">{getDisplaySubtitle(section, item)}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}

          {!query.trim() && !loading && (
            <div className="search-modal-hint">
              Start typing to search across clients, cases, documents, and more.
            </div>
          )}
        </div>

        <div className="search-modal-footer">
          <span>Navigate with <kbd>↑</kbd><kbd>↓</kbd></span>
          <span><kbd>Enter</kbd> to open</span>
          <span><kbd>Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
