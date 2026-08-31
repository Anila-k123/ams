import React, { useRef, useEffect } from "react";
import { FiMessageSquare, FiX, FiMinimize2, FiMaximize2, FiTrash2, FiDownload } from "react-icons/fi";
import { useAssistant } from "../contexts/AssistantContext";
import AssistantMessage from "./AssistantMessage";
import AssistantInput from "./AssistantInput";

// Remembered across reloads so the panel opens at the width you chose.
const WIDTH_KEY = "advocate-assistant-width";
// Below this the message bubbles and quick-action chips start wrapping badly.
const MIN_WIDTH = 360;

export default function AssistantPanel() {
  const { isOpen, setIsOpen, messages, isProcessing, clearHistory, exportHistory } = useAssistant();
  const chatEndRef = useRef(null);
  // Maximize used to go 440px -> 480px, a 40px change that left the content as
  // cramped as before. It now takes half the window, which is the width at
  // which a case list or a table of figures actually reads.
  const [isMaximized, setIsMaximized] = React.useState(false);
  // ...and the edge can be dragged, so the width is ultimately the user's
  // choice rather than one of two presets. Remembered per browser.
  const [width, setWidth] = React.useState(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved >= MIN_WIDTH ? saved : null;
  });
  const draggingRef = useRef(false);

  const startDrag = React.useCallback((e) => {
    e.preventDefault();
    draggingRef.current = true;
    // The panel is anchored right, so width is the distance from the pointer
    // to the right edge of the window.
    const onMove = (ev) => {
      if (!draggingRef.current) return;
      const next = Math.min(
        Math.max(window.innerWidth - ev.clientX, MIN_WIDTH),
        window.innerWidth);
      setWidth(next);
      // Dragging is an explicit width, so it takes over from Maximize.
      setIsMaximized(false);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    };
    // Stop the drag selecting the chat text it passes over.
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  useEffect(() => {
    if (width) localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);
  // Clearing wipes the conversation (and its localStorage copy) irreversibly,
  // and the button sits right next to Close — so ask first.
  const [confirmClear, setConfirmClear] = React.useState(false);
  // Only the welcome message = nothing worth clearing.
  const hasHistory = messages.length > 1;

  // Never leave the confirm bar hanging open across a close/reopen.
  useEffect(() => {
    if (!isOpen) setConfirmClear(false);
  }, [isOpen]);

  // Auto-scroll on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessing]);

  // Toggle when "chatbot-toggle-open" is dispatched (for sidebar link)
  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener("chatbot-toggle-open", handler);
    return () => window.removeEventListener("chatbot-toggle-open", handler);
  }, [setIsOpen]);

  if (!isOpen) {
    return (
      <button
        className="assistant-fab"
        onClick={() => setIsOpen(true)}
        title="AI Advocate Assistant"
      >
        <FiMessageSquare className="fab-icon" />
        <span className="fab-pulse" />
      </button>
    );
  }

  return (
    <div
      className={`assistant-panel ${isMaximized ? "maximized" : ""}`}
      style={width ? { width: `${width}px` } : undefined}
    >
      {/* Drag the left edge to any width. */}
      <div
        className="assistant-resize-handle"
        onMouseDown={startDrag}
        title="Drag to resize"
        role="separator"
        aria-orientation="vertical"
      />
      {/* Header */}
      <div className="assistant-header">
        <div className="assistant-header-left">
          <span className="assistant-header-icon">⚖️</span>
          <div>
            <h3>AI Advocate Assistant</h3>
            <span className="assistant-status">
              <span className="status-dot" /> Online
            </span>
          </div>
        </div>
        <div className="assistant-header-actions">
          <button
            className="header-icon-btn"
            onClick={() => {
              // Drop any dragged width: an inline style would otherwise
              // override the maximized class and the button would do nothing.
              setWidth(null);
              localStorage.removeItem(WIDTH_KEY);
              setIsMaximized((v) => !v);
            }}
            title={isMaximized ? "Restore size" : "Maximize to half the window"}
          >
            {isMaximized ? <FiMinimize2 /> : <FiMaximize2 />}
          </button>
          <button className="header-icon-btn" onClick={exportHistory} title="Export History">
            <FiDownload />
          </button>
          <button
            className="header-icon-btn"
            onClick={() => setConfirmClear((v) => !v)}
            disabled={!hasHistory}
            title={hasHistory ? "Clear History" : "Nothing to clear"}
          >
            <FiTrash2 />
          </button>
          <button className="header-icon-btn close-btn" onClick={() => setIsOpen(false)} title="Close">
            <FiX />
          </button>
        </div>
      </div>

      {confirmClear && (
        <div className="assistant-confirm-clear" role="alertdialog" aria-label="Confirm clear history">
          <span>Clear this conversation? This can’t be undone.</span>
          <div className="assistant-confirm-actions">
            <button
              type="button"
              className="confirm-btn-ghost"
              onClick={() => { exportHistory(); setConfirmClear(false); }}
            >
              Export first
            </button>
            <button type="button" className="confirm-btn-ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="confirm-btn-danger"
              onClick={() => { clearHistory(); setConfirmClear(false); }}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="assistant-body">
        {messages.map((msg) => (
          <AssistantMessage key={msg.id} message={msg} />
        ))}

        {/* Thinking indicator */}
        {isProcessing && (
          <div className="assistant-msg bot">
            <div className="assistant-msg-avatar">⚖️</div>
            <div className="assistant-msg-content">
              <div className="assistant-thinking">
                <span className="dot-pulse" />
                <span className="dot-pulse" />
                <span className="dot-pulse" />
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <AssistantInput />
    </div>
  );
}
