import { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from "react";
import { ASSISTANT_NAME } from "../constants/assistant";
import { apiUrl, authHeaders } from "../api/client";
import { useNavigate, useLocation } from "react-router-dom";
import { usePermission } from "./PermissionContext";
import { useAuth } from "../context/AuthContext";
import { requestPageModal } from "../utils/pageModal";

const STORAGE_KEY = "advocate-assistant-history";
// Chats are kept per user: one shared key showed the previous login's chat to
// the next person on the same browser (and would now send it to the model).
const storageKey = (advocateId) => `${STORAGE_KEY}:${advocateId ?? "anon"}`;
const welcome = () => [
  { id: "welcome", sender: "bot", text: `⚖️ Hello! I'm ${ASSISTANT_NAME}, your AI legal assistant. How can I help you manage your practice today?` }
];
function loadMessages(advocateId) {
  try {
    const saved = localStorage.getItem(storageKey(advocateId));
    return saved ? JSON.parse(saved) : welcome();
  } catch {
    return welcome();
  }
}

// How much of the chat goes back to the model with each question. The server
// caps it too; this just keeps the request small.
const HISTORY_PAIRS = 3;
// A short message that points back at the last answer ("its next hearing?",
// "what about him") belongs to the model, not the keyword router, which would
// otherwise read "hearings" as "open the Hearings page".
const FOLLOW_UP = /(it|its|it's|this|that|these|those|he|him|his|she|her|they|them|their|same|also|what about|and the|then)/i;
const isFollowUp = (q) => q.trim().split(/\s+/).length <= 12 && FOLLOW_UP.test(q);

const AssistantContext = createContext(null);

export function AssistantProvider({ children, token }) {
  const navigate = useNavigate();
  const { hasPermission } = usePermission() as any;
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const { advocateId } = useAuth() as any;
  const [messages, setMessages] = useState(() => loadMessages(advocateId));
  // Latest messages for the async send path, which would otherwise see the
  // list as it was when the callback was created.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [inputValue, setInputValue] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const msgIdCounter = useRef(Date.now());

  // A different login on this browser gets its own chat, not the last one's.
  const loadedFor = useRef(advocateId);
  useEffect(() => {
    if (loadedFor.current === advocateId) return;
    loadedFor.current = advocateId;
    setMessages(loadMessages(advocateId));
  }, [advocateId]);

  // Save messages to localStorage
  useEffect(() => {
    if (loadedFor.current !== advocateId) return;  // not yet swapped to this user's chat
    try {
      localStorage.setItem(storageKey(advocateId), JSON.stringify(messages));
      localStorage.removeItem(STORAGE_KEY);  // the old shared key, from before chats were per user
    } catch { /* quota exceeded */ }
  }, [messages, advocateId]);

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

  const setMessageFields = useCallback((id, fields) => {
    setMessages(prev => prev.map(m => (m.id === id ? { ...m, ...fields } : m)));
  }, []);

  const clearHistory = useCallback(() => {
    setMessages(welcome());
    localStorage.removeItem(storageKey(advocateId));
  }, [advocateId]);

  const exportHistory = useCallback(() => {
    const text = messages.map(m =>
      `${m.sender === "user" ? "You" : ASSISTANT_NAME}: ${m.text}`
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
  const streamChat = useCallback(async (query, prior) => {
    // Only exchanges the model took part in: a question plus its model answer.
    // Router replies ("Opening Cases...") aren't conversation.
    const pairs = [];
    for (let i = 1; i < prior.length; i++) {
      const m = prior[i], q = prior[i - 1];
      if (m.sender === "bot" && m.llm && m.text && q.sender === "user") {
        pairs.push({ role: "user", text: q.text }, { role: "assistant", text: m.text });
      }
    }
    const history = pairs.slice(-HISTORY_PAIRS * 2);
    const lastLlm = [...prior].reverse().find(m => m.sender === "bot" && m.llm);
    const focusCaseIds = lastLlm?.caseIds || [];

    const botId = `msg-${++msgIdCounter.current}`;
    addMessage({ id: botId, sender: "bot", text: "", llm: true });
    let acc = "";
    try {
      const res = await fetch(apiUrl(`/api/assistant/chat`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ query, history, focusCaseIds }),
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
          } else if (evt.type === "done" && Array.isArray(evt.caseIds)) {
            // Remembered so the next follow-up can say "it" and mean this case.
            setMessageFields(botId, { caseIds: evt.caseIds });
          }
        }
      }
      if (!acc) setMessageText(botId, "I couldn't find anything for that. Try rephrasing.");
    } catch {
      setMessageText(botId, acc || "Sorry, I couldn't reach the assistant. Please try again.");
    }
  }, [token, addMessage, setMessageText, setMessageFields]);

  const sendQuery = useCallback(async (query) => {
    if (!query.trim() || !token) return;
    if (actionTimerRef.current) {
      clearTimeout(actionTimerRef.current);
      actionTimerRef.current = null;
    }
    setInputValue("");
    const prior = messagesRef.current;
    addMessage({ sender: "user", text: query });
    setIsProcessing(true);

    const lastBot = [...prior].reverse().find(m => m.sender === "bot" && m.id !== "welcome");
    if (lastBot?.llm && isFollowUp(query)) {
      try { await streamChat(query, prior); } finally { setIsProcessing(false); }
      return;
    }

    try {
      const res = await fetch(apiUrl(`/api/assistant/query`), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeaders(),
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
        await streamChat(query, prior);
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
      // Parked until the page mounts (utils/pageModal), not fired on a timer.
      if (modalToOpen) requestPageModal(modalToOpen);
      navigate(route);
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
    // Each suggestion names the permission it needs, so nobody is offered
    // something their role can't open.
    const all: [string, string | null][] = [
      ["Open Dashboard", null], ["Open Cases", "CASE_VIEW"], ["Open Clients", "CLIENT_VIEW"],
      ["Open Expenses", "EXPENSE_VIEW"], ["Open Hearings", "EVENT_VIEW"],
      ["Open Documents", "DOCUMENT_VIEW"], ["Open Invoices", "INVOICE_VIEW"],
      ["Open Settings", null], ["Today's Hearings", "EVENT_VIEW"],
      ["Upcoming Hearings", "EVENT_VIEW"], ["Pending Invoices", "INVOICE_VIEW"],
      ["Monthly Expenses", "EXPENSE_VIEW"], ["Monthly Income", "PAYMENT_VIEW"],
      ["Dashboard Summary", null], ["Create Client", "CLIENT_CREATE"],
      ["Create Case", "CASE_CREATE"], ["Create Expense", "EXPENSE_CREATE"],
      ["Create Hearing", "EVENT_CREATE"], ["Create Invoice", "INVOICE_CREATE"],
      ["Find client", "CLIENT_VIEW"], ["Find case", "CASE_VIEW"],
    ];
    setSuggestions(all
      .filter(([, perm]) => !perm || hasPermission(perm))
      .map(([label]) => label)
      .filter(s => s.toLowerCase().includes(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
