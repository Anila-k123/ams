import { useRef, useEffect, useState } from 'react';
import { InputText } from 'primereact/inputtext';
import { Button } from 'primereact/button';
import { useAssistant } from '../contexts/AssistantContext';

const QUICK = ['Open Cases', 'Open Clients', "Today's Hearings", 'Dashboard Summary', 'Find Client'];

export default function AssistantInput() {
  const { inputValue, setInputValue, sendQuery, suggestions, isProcessing } = useAssistant() as any;
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

  const handleQuickAction = (cmd: string) => {
    // "Find Client" needs a name, so pre-fill instead of sending.
    if (cmd === 'Find Client') {
      handleSuggestionClick('Find client ');
      return;
    }
    sendQuery(cmd);
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
        {QUICK.map((cmd) => (
          <Button key={cmd} type="button" size="small" rounded outlined className="quick-chip" label={cmd}
            onClick={() => handleQuickAction(cmd)} disabled={isProcessing} />
        ))}
      </div>

      <form className="assistant-form flex gap-2" onSubmit={handleSubmit}>
        <InputText ref={inputRef} className="assistant-input flex-1" placeholder="Ask me anything..."
          value={inputValue} onChange={(e) => setInputValue(e.target.value)} disabled={isProcessing} />
        <Button type="submit" icon="pi pi-send" className="assistant-send-btn" aria-label="Send" disabled={!inputValue.trim() || isProcessing} />
      </form>
    </div>
  );
}
