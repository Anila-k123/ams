import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";

const STORAGE_KEY = "advocate-assistant-history";

const AssistantContext = createContext(null);

export function AssistantProvider({ children, token }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [
        { id: "welcome", sender: "bot", text: "⚖️ Hello! I'm your AI Advocate Assistant. How can I help you manage your practice today?" }
      ];
    } catch {
      return [{ id: "welcome", sender: "bot", text: "⚖️ Hello! I'm your AI Advocate Assistant. How can I help you manage your practice today?" }];
    }
  });
  const [inputValue, setInputValue] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const msgIdCounter = useRef(Date.now());

  // Save messages to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch { /* quota exceeded */ }
  }, [messages]);

  // Listen for toggle-open event (from sidebar)
  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener("assistant-toggle-open", handler);
    return () => window.removeEventListener("assistant-toggle-open", handler);
  }, []);

  const addMessage = useCallback((msg) => {
    setMessages(prev => [...prev, { ...msg, id: msg.id || `msg-${++msgIdCounter.current}` }]);
  }, []);

  // Replace the text of an existing message by id (used while streaming tokens in).
  const setMessageText = useCallback((id, text) => {
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, text } : m)));
  }, []);

  const clearHistory = useCallback(() => {
    setMessages([{ id: "welcome", sender: "bot", text: "⚖️ Hello! I'm your AI Advocate Assistant. How can I help you manage your practice today?" }]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const exportHistory = useCallback(() => {
    const text = messages.map(m =>
      `${m.sender === "user" ? "You" : "Assistant"}: ${m.text}`
    ).join("\n\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `assistant-history-${new Date().toISOString().split("T")[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [messages]);

  const actionTimerRef = useRef(null);

  // Stream a conversational answer from the LLM assistant (SSE token deltas).
  const streamChat = useCallback(async (query) => {
    const botId = `msg-${++msgIdCounter.current}`;
    addMessage({ id: botId, sender: "bot", text: "" });
    let acc = "";
    try {
      const res = await fetch(`${window.API_BASE}/api/assistant/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ query }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() || "";
        for (const frame of frames) {
          const line = frame.split("\n").find(l => l.startsWith("data:"));
          if (!line) continue;
          let evt;
          try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
          if (evt.type === "text") {
            acc += evt.text;
            setMessageText(botId, acc);
          } else if (evt.type === "error") {
            setMessageText(botId, acc || evt.message || "Sorry, something went wrong.");
          }
          // "done" needs no action — the accumulated text is already shown.
        }
      }
      if (!acc) setMessageText(botId, "I couldn't find anything for that. Try rephrasing.");
    } catch {
      setMessageText(botId, acc || "Sorry, I couldn't reach the assistant. Please try again.");
    }
  }, [token, addMessage, setMessageText]);

  const sendQuery = useCallback(async (query) => {
    if (!query.trim() || !token) return;
    if (actionTimerRef.current) {
      clearTimeout(actionTimerRef.current);
      actionTimerRef.current = null;
    }
    setInputValue("");
    addMessage({ sender: "user", text: query });
    setIsProcessing(true);

    try {
      const res = await fetch(`${window.API_BASE}/api/assistant/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query,
          currentRoute: location.pathname,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();

      // Deterministic nav/data/search command → act instantly (free, no LLM).
      // Anything the rule router doesn't recognise → hand to the LLM assistant.
      if (data.intent === "UNKNOWN") {
        await streamChat(query);
      } else {
        addMessage({ sender: "bot", text: data.message, response: data });
        actionTimerRef.current = setTimeout(() => {
          handleAction(data);
        }, 100);
      }

    } catch (err) {
      addMessage({
        sender: "bot",
        text: "Sorry, I encountered an error processing your request. Please try again.",
      });
    } finally {
      setIsProcessing(false);
    }
  }, [token, location.pathname, addMessage, streamChat]);

  // Cleanup action timer on unmount
  useEffect(() => {
    return () => {
      if (actionTimerRef.current) {
        clearTimeout(actionTimerRef.current);
      }
    };
  }, []);

  const handleAction = useCallback((response) => {
    const { action, route, searchQuery, modalToOpen, highlightId } = response;

    if (action === "OPEN_PAGE" && route) {
      navigate(route);
    }

    if (action === "OPEN_MODAL" && route) {
      navigate(route);
      setTimeout(() => {
        if (modalToOpen) {
          window.dispatchEvent(new CustomEvent("assistant-open-modal", { detail: modalToOpen }));
        }
      }, 400);
    }

    if (action === "SEARCH" && route && searchQuery) {
      navigate(route);
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("assistant-search", {
          detail: { query: searchQuery, highlightId }
        }));
      }, 400);
    }

    if (action === "SHOW_DATA" && route) {
      // Just navigate; data is already displayed in the message
      if (route !== location.pathname) {
        navigate(route);
      }
    }

    if (response.intent === "REFRESH_DASHBOARD") {
      navigate("/dashboard");
      window.dispatchEvent(new CustomEvent("assistant-refresh-dashboard"));
    }
  }, [navigate, location.pathname]);

  // Update suggestions based on input
  useEffect(() => {
    const q = inputValue.toLowerCase().trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }
    const all = [
      "Open Dashboard", "Open Cases", "Open Clients", "Open Expenses",
      "Open Hearings", "Open Documents", "Open Invoices", "Open Settings",
      "Today's Hearings", "Upcoming Hearings", "Pending Invoices",
      "Monthly Expenses", "Monthly Income", "Dashboard Summary",
      "Create Client", "Create Case", "Create Expense", "Create Hearing",
      "Create Invoice", "Find client", "Find case",
    ];
    setSuggestions(all.filter(s => s.toLowerCase().includes(q)));
  }, [inputValue]);

  const value = useMemo(() => ({
    isOpen,
    setIsOpen,
    messages,
    addMessage,
    inputValue,
    setInputValue,
    isProcessing,
    suggestions,
    sendQuery,
    clearHistory,
    exportHistory,
  }), [isOpen, messages, addMessage, inputValue, isProcessing, suggestions, sendQuery, clearHistory, exportHistory]);

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistant() {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error("useAssistant must be used within AssistantProvider");
  return ctx;
}

export default AssistantContext;
