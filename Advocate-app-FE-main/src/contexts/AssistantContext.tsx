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

// How Lisa is reached (docs/AI_ASSISTANT.md):
//  - every TYPED message goes to the AI (/api/assistant/chat), which answers
//    and can open pages and forms itself (`action` events). Nothing is matched
//    by phrase first, so no wording ever needs a rule.
//  - the quick buttons send an exact command name to /api/assistant/query.
//  - only if the AI is unavailable does typed text fall back to the basic
//    phrase matcher (/api/assistant/query with {query}).

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
  // handleAction is defined below; streamChat reaches it through this ref.
  const handleActionRef = useRef<(r: any) => void>(() => {});

  // Stream a conversational answer from the LLM assistant (SSE token deltas).
  // Returns false when the AI is unavailable (not configured / unreachable),
  // so the caller can fall back to basic mode.
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
    let unavailable = false;
    try {
      const res = await fetch(apiUrl(`/api/assistant/chat`), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ query, history, focusCaseIds }),
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const links: { route: string; label: string }[] = [];
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
          } else if (evt.type === "link" && evt.route) {
            // A page the answer points to: a button under the reply, opened
            // when the user clicks it.
            if (!links.some((l) => l.route === evt.route)) {
              links.push({ route: evt.route, label: evt.label || "Open" });
              setMessageFields(botId, { links: [...links] });
            }
          } else if (evt.type === "action") {
            // Lisa opened a page or form: the same handling as a quick command.
            handleActionRef.current(evt);
          } else if (evt.type === "error") {
            if (evt.code === "unavailable" && !acc) unavailable = true;
            setMessageText(botId, acc || evt.message || "Sorry, something went wrong.");
          } else if (evt.type === "done" && Array.isArray(evt.caseIds)) {
            // Remembered so the next follow-up can say "it" and mean this case.
            setMessageFields(botId, { caseIds: evt.caseIds });
          }
        }
      }
      if (unavailable) {
        // Basic mode answers instead; drop the empty AI bubble.
        setMessages(prev => prev.filter(m => m.id !== botId));
        return false;
      }
      if (!acc) setMessageText(botId, "I couldn't find anything for that. Try rephrasing.");
    } catch {
      setMessageText(botId, acc || "Sorry, I couldn't reach the assistant. Please try again.");
    }
    return true;
  }, [token, addMessage, setMessageText, setMessageFields]);

  // Show a /query reply (quick command or basic mode) and act on it.
  const showQueryReply = useCallback((data, note = "") => {
    addMessage({ sender: "bot", text: note + data.message, response: data });
    actionTimerRef.current = setTimeout(() => handleActionRef.current(data), 100);
  }, [addMessage]);

  const postQuery = useCallback(async (body) => {
    const res = await fetch(apiUrl(`/api/assistant/query`), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, []);

  const startTurn = (text) => {
    if (actionTimerRef.current) {
      clearTimeout(actionTimerRef.current);
      actionTimerRef.current = null;
    }
    setInputValue("");
    const prior = messagesRef.current;
    addMessage({ sender: "user", text });
    setIsProcessing(true);
    return prior;
  };

  // A typed message: always the AI.
  const sendQuery = useCallback(async (query) => {
    if (!query.trim() || !token) return;
    const prior = startTurn(query);
    try {
      const answered = await streamChat(query, prior);
      if (!answered) {
        // AI unavailable: the basic phrase matcher, clearly labelled.
        const data = await postQuery({ query, currentRoute: location.pathname });
        if (data.intent === "UNKNOWN") {
          addMessage({ sender: "bot", text: "The AI assistant is unavailable right now, so I can only do basic commands such as \"open cases\" or \"today's hearings\". Please try again shortly." });
        } else {
          showQueryReply(data, "(Basic mode) ");
        }
      }
    } catch {
      addMessage({ sender: "bot", text: "Sorry, I encountered an error processing your request. Please try again." });
    } finally {
      setIsProcessing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, location.pathname, addMessage, streamChat, postQuery, showQueryReply]);

  // A quick button: an exact command name, no AI, no text matching.
  const sendCommand = useCallback(async (command, label) => {
    if (!token) return;
    startTurn(label);
    try {
      showQueryReply(await postQuery({ command }));
    } catch {
      addMessage({ sender: "bot", text: "Sorry, that command didn't work. Please try again." });
    } finally {
      setIsProcessing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, addMessage, postQuery, showQueryReply]);

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
  handleActionRef.current = handleAction;

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
    sendCommand,
    clearHistory,
    exportHistory,
  }), [isOpen, messages, addMessage, inputValue, isProcessing, suggestions, sendQuery, sendCommand, clearHistory, exportHistory]);

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
