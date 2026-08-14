import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { useLoading } from "../contexts/LoadingContext";

const SearchContext = createContext(null);

const API_BASE = `${import.meta.env.VITE_API_BASE || "http://localhost:8080"}/api/search/global`;
const STORAGE_KEY = "globalRecentSearches";
const MAX_RECENT = 10;

function loadRecentSearches() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRecentSearches(searches) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
  } catch {}
}

export function SearchProvider({ children }) {
  const { withLoading } = useLoading();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentSearches, setRecentSearches] = useState(loadRecentSearches);
  const abortRef = useRef(null);
  const debounceRef = useRef(null);

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
          signal: controller.signal,
        }),
        "Searching..."
      );
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
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
  }, [withLoading]);

  const debouncedSearch = useCallback((value) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) { setResults(null); setLoading(false); return; }
    debounceRef.current = setTimeout(() => performSearch(value), 300);
  }, [performSearch]);

  const handleQueryChange = useCallback((value) => {
    setQuery(value);
    debouncedSearch(value);
  }, [debouncedSearch]);

  const addRecentSearch = useCallback((term) => {
    setRecentSearches((prev) => {
      const filtered = prev.filter((s) => s.toLowerCase() !== term.toLowerCase());
      const updated = [term, ...filtered].slice(0, MAX_RECENT);
      saveRecentSearches(updated);
      return updated;
    });
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    saveRecentSearches([]);
  }, []);

  const resetSearch = useCallback(() => {
    setQuery("");
    setResults(null);
    setLoading(false);
    setSelectedIndex(0);
  }, []);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <SearchContext.Provider
      value={{
        query,
        results,
        loading,
        selectedIndex,
        recentSearches,
        setQuery: handleQueryChange,
        setSelectedIndex,
        performSearch,
        addRecentSearch,
        clearRecentSearches,
        resetSearch,
      }}
    >
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch() {
  const ctx = useContext(SearchContext);
  if (!ctx) throw new Error("useSearch must be used within SearchProvider");
  return ctx;
}
