import { useRef, useEffect, useState } from 'react';
import { ASSISTANT_NAME } from '../constants/assistant';
import { InputText } from 'primereact/inputtext';
import { Button } from 'primereact/button';
import { useAssistant } from '../contexts/AssistantContext';

// Each button sends an exact command name (assistant/views.py COMMANDS):
// instant and free. "Find Client" needs a name, so it pre-fills the input and
// the typed message goes to the AI like any other.
const QUICK: { label: string; command: string | null }[] = [
  { label: 'Open Cases', command: 'open_cases' },
  { label: 'Open Clients', command: 'open_clients' },
  { label: "Today's Hearings", command: 'todays_hearings' },
  { label: 'Dashboard Summary', command: 'dashboard_summary' },
  { label: 'Find Client', command: null },
];

export default function AssistantInput() {
  const { inputValue, setInputValue, sendQuery, sendCommand, suggestions, isProcessing } = useAssistant() as any;
  const inputRef = useRef<HTMLInputElement>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    setShowSuggestions(inputValue.length >= 1);
  }, [inputValue]);

  const handleSubmit = (e: any) => {
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
    <div className="assistant-input-area">
      {showSuggestions && suggestions.length > 0 && (
        <div className="assistant-suggestions-dropdown">
          {suggestions.map((s: string, i: number) => (
            <button key={i} type="button" className="as-suggestion-item" onClick={() => handleSuggestionClick(s)}>{s}</button>
          ))}
        </div>
      )}

      <div className="assistant-quick-chips flex flex-wrap align-items-center gap-1">
        <span className="chip-label">Quick:</span>
        {QUICK.map((q) => (
          <Button key={q.label} type="button" size="small" rounded outlined className="quick-chip" label={q.label}
            onClick={() => handleQuickAction(q)} disabled={isProcessing} />
        ))}
      </div>

      <form className="assistant-form flex gap-2" onSubmit={handleSubmit}>
        <InputText ref={inputRef} className="assistant-input flex-1" placeholder={`Ask ${ASSISTANT_NAME} anything...`}
          value={inputValue} onChange={(e) => setInputValue(e.target.value)} disabled={isProcessing} />
        <Button type="submit" icon="pi pi-send" className="assistant-send-btn" aria-label="Send" disabled={!inputValue.trim() || isProcessing} />
      </form>
    </div>
  );
}
