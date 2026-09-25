import { useRef, useEffect, useState, useCallback } from 'react';
import { Button } from 'primereact/button';
import { useAssistant } from '../contexts/AssistantContext';
import AssistantMessage from './AssistantMessage';
import AssistantInput from './AssistantInput';

// Remembered across reloads so the panel opens at the width you chose.
const WIDTH_KEY = 'advocate-assistant-width';
const MIN_WIDTH = 360;

export default function AssistantPanel() {
  const { isOpen, setIsOpen, messages, isProcessing, clearHistory, exportHistory } = useAssistant() as any;
  const chatEndRef = useRef<HTMLDivElement>(null);
  // Maximize takes half the window.
  const [isMaximized, setIsMaximized] = useState(false);
  // The left edge can be dragged; the width is remembered per browser.
  const [width, setWidth] = useState<number | null>(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved >= MIN_WIDTH ? saved : null;
  });
  const draggingRef = useRef(false);

  const startDrag = useCallback((e: any) => {
    e.preventDefault();
    draggingRef.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return;
      setWidth(Math.min(Math.max(window.innerWidth - ev.clientX, MIN_WIDTH), window.innerWidth));
      setIsMaximized(false);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  useEffect(() => {
    if (width) localStorage.setItem(WIDTH_KEY, String(width));
  }, [width]);

  // Clearing is irreversible and sits next to Close, so ask first.
  const [confirmClear, setConfirmClear] = useState(false);
  const hasHistory = messages.length > 1;

  useEffect(() => {
    if (!isOpen) setConfirmClear(false);
  }, [isOpen]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  // Opened by the "chatbot-toggle-open" window event (sidebar link).
  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener('chatbot-toggle-open', handler);
    return () => window.removeEventListener('chatbot-toggle-open', handler);
  }, [setIsOpen]);

  if (!isOpen) {
    return (
      <Button rounded className="assistant-fab" icon="pi pi-comments" aria-label="AI Advocate Assistant"
        tooltip="AI Advocate Assistant" tooltipOptions={{ position: 'left' }} onClick={() => setIsOpen(true)} />
    );
  }

  return (
    <div className={`assistant-panel ${isMaximized ? 'maximized' : ''}`} style={width ? { width: `${width}px` } : undefined}>
      <div className="assistant-resize-handle" onMouseDown={startDrag} title="Drag to resize" role="separator" aria-orientation="vertical" />
      <div className="assistant-header">
        <div className="assistant-header-left">
          <span className="assistant-header-icon"><i className="pi pi-sparkles" /></span>
          <div>
            <h3>AI Advocate Assistant</h3>
            <span className="assistant-status"><span className="status-dot" /> Online</span>
          </div>
        </div>
        <div className="assistant-header-actions flex gap-1">
          <Button text rounded size="small" className="header-icon-btn"
            icon={isMaximized ? 'pi pi-window-minimize' : 'pi pi-window-maximize'}
            tooltip={isMaximized ? 'Restore size' : 'Maximize to half the window'} tooltipOptions={{ position: 'bottom' }}
            onClick={() => {
              // Drop any dragged width, or the inline style overrides the maximized class.
              setWidth(null);
              localStorage.removeItem(WIDTH_KEY);
              setIsMaximized((v) => !v);
            }} />
          <Button text rounded size="small" className="header-icon-btn" icon="pi pi-download" tooltip="Export History"
            tooltipOptions={{ position: 'bottom' }} onClick={exportHistory} />
          <Button text rounded size="small" className="header-icon-btn" icon="pi pi-trash" disabled={!hasHistory}
            tooltip={hasHistory ? 'Clear History' : 'Nothing to clear'} tooltipOptions={{ position: 'bottom', showOnDisabled: true }}
            onClick={() => setConfirmClear((v) => !v)} />
          <Button text rounded size="small" className="header-icon-btn close-btn" icon="pi pi-times" aria-label="Close"
            onClick={() => setIsOpen(false)} />
        </div>
      </div>

      {confirmClear && (
        <div className="assistant-confirm-clear" role="alertdialog" aria-label="Confirm clear history">
          <span>Clear this conversation? This can’t be undone.</span>
          <div className="assistant-confirm-actions flex gap-2">
            <Button type="button" size="small" text label="Export first" onClick={() => { exportHistory(); setConfirmClear(false); }} />
            <Button type="button" size="small" text label="Cancel" onClick={() => setConfirmClear(false)} />
            <Button type="button" size="small" severity="danger" label="Clear" onClick={() => { clearHistory(); setConfirmClear(false); }} />
          </div>
        </div>
      )}

      <div className="assistant-body">
        {messages.map((msg: any) => <AssistantMessage key={msg.id} message={msg} />)}
        {isProcessing && (
          <div className="assistant-msg bot">
            <div className="assistant-msg-avatar"><i className="pi pi-sparkles" /></div>
            <div className="assistant-msg-content">
              <div className="assistant-thinking">
                <span className="dot-pulse" /><span className="dot-pulse" /><span className="dot-pulse" />
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <AssistantInput />
    </div>
  );
}
