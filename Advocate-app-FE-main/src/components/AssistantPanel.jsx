import React, { useRef, useEffect } from "react";
import { FiMessageSquare, FiX, FiMinimize2, FiMaximize2, FiTrash2, FiDownload } from "react-icons/fi";
import { useAssistant } from "../contexts/AssistantContext";
import AssistantMessage from "./AssistantMessage";
import AssistantInput from "./AssistantInput";

export default function AssistantPanel() {
  const { isOpen, setIsOpen, messages, isProcessing, clearHistory, exportHistory } = useAssistant();
  const chatEndRef = useRef(null);
  const [isMaximized, setIsMaximized] = React.useState(false);
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
    <div className={`assistant-panel ${isMaximized ? "maximized" : ""}`}>
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
          <button className="header-icon-btn" onClick={() => setIsMaximized(!isMaximized)} title={isMaximized ? "Minimize" : "Maximize"}>
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
