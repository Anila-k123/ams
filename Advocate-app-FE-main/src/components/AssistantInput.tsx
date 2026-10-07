import { useRef, useEffect, useState } from 'react';
import { ASSISTANT_NAME } from '../constants/assistant';
import { useAssistant } from '../contexts/AssistantContext';
import Icon from '../ui/Icon';

// Each button sends an exact command name (assistant/views.py COMMANDS):
// instant and free. "Find Client" needs a name, so it pre-fills the input and
// the typed message goes to the AI like any other.
const QUICK: { label: string; command: string | null }[] = [
  { label: "Today's hearings", command: 'todays_hearings' },
  { label: 'Open cases', command: 'open_cases' },
  { label: 'Open clients', command: 'open_clients' },
  { label: 'Practice summary', command: 'dashboard_summary' },
  { label: 'Find a client', command: null },
];

export default function AssistantInput() {
  const { inputValue, setInputValue, sendQuery, sendCommand, suggestions, isProcessing } = useAssistant() as any;
  const inputRef = useRef<HTMLInputElement>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    setShowSuggestions(inputValue.length >= 1);
  }, [inputValue]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isProcessing) return;
    sendQuery(inputValue.trim());
    setShowSuggestions(false);
  };

  const handleSuggestionClick = (s: string) => {
    setInputValue(s);
    setShowSuggestions(false);
    inputRef.current?.focus();
  };

  const handleQuickAction = (q: { label: string; command: string | null }) => {
    if (!q.command) {
      handleSuggestionClick('Find client ');
      return;
    }
    sendCommand(q.command, q.label);
  };

  return (
    <div className="lisa-foot">
      {showSuggestions && suggestions.length > 0 && (
        <div className="popover lisa-suggest" role="listbox" aria-label="Suggestions" style={{ position: 'absolute' }}>
          {suggestions.map((s: string, i: number) => (
            <button key={i} type="button" role="option" aria-selected="false" onClick={() => handleSuggestionClick(s)}>{s}</button>
          ))}
        </div>
      )}

      <div className="lisa-quick" role="group" aria-label="Quick questions">
        <span className="lbl">Try</span>
        {QUICK.map((q) => (
          <button key={q.label} type="button" className="pp-pill" onClick={() => handleQuickAction(q)} disabled={isProcessing}>{q.label}</button>
        ))}
      </div>

      <form className="lisa-form" onSubmit={handleSubmit}>
        <input ref={inputRef} className="input grow" placeholder={`Ask ${ASSISTANT_NAME} about a case, client or hearing…`}
          aria-label={`Message ${ASSISTANT_NAME}`} value={inputValue} onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape' && showSuggestions) { e.stopPropagation(); setShowSuggestions(false); } }}
          disabled={isProcessing} autoComplete="off" />
        <button type="submit" className="btn primary" aria-label="Send" title="Send" disabled={!inputValue.trim() || isProcessing}>
          <Icon name="send" size="sm" />
        </button>
      </form>
      <p className="lisa-note">{ASSISTANT_NAME} can make mistakes. Check citations and dates before you rely on them.</p>
    </div>
  );
}
