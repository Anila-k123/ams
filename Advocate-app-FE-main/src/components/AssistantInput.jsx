import React, { useRef, useEffect } from "react";
import { FiSend } from "react-icons/fi";
import { useAssistant } from "../contexts/AssistantContext";

const SUGGESTIONS_LIST = [
  "Open Dashboard", "Open Cases", "Open Clients", "Open Expenses",
  "Open Hearings", "Open Invoices",
  "Today's Hearings", "Upcoming Hearings", "Pending Invoices",
  "Dashboard Summary", "Monthly Expenses", "Monthly Income",
  "Create Client", "Create Case", "Create Hearing",
  "Find client Rahul", "Find case CASE-2026",
];

export default function AssistantInput() {
  const { inputValue, setInputValue, sendQuery, suggestions, isProcessing } = useAssistant();
  const inputRef = useRef(null);
  const [showSuggestions, setShowSuggestions] = React.useState(false);

  useEffect(() => {
    if (inputValue.length >= 1) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
    }
  }, [inputValue]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!inputValue.trim() || isProcessing) return;
    sendQuery(inputValue.trim());
    setShowSuggestions(false);
  };

  const handleSuggestionClick = (s) => {
    setInputValue(s);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleQuickAction = (cmd) => {
    sendQuery(cmd);
  };

  return (
    <div className="assistant-input-area">
      {/* Inline suggestions dropdown */}
      {showSuggestions && suggestions.length > 0 && (
        <div className="assistant-suggestions-dropdown">
          {suggestions.map((s, i) => (
            <button key={i} className="as-suggestion-item" onClick={() => handleSuggestionClick(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Quick action chips */}
      <div className="assistant-quick-chips">
        <span className="chip-label">Quick:</span>
        {["Open Cases", "Open Clients", "Today's Hearings", "Summary", "Find Client"].map((cmd) => (
          <button
            key={cmd}
            className="quick-chip"
            onClick={() => handleQuickAction(cmd)}
            disabled={isProcessing}
          >
            {cmd}
          </button>
        ))}
      </div>

      {/* Input form */}
      <form className="assistant-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className="assistant-input"
          placeholder="Ask me anything..."
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={isProcessing}
        />
        <button
          type="submit"
          className="assistant-send-btn"
          disabled={!inputValue.trim() || isProcessing}
        >
          <FiSend />
        </button>
      </form>
    </div>
  );
}
