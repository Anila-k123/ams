import { useRef, useEffect, useState, useCallback } from 'react';
import { ASSISTANT_NAME } from '../constants/assistant';
import { useAssistant } from '../contexts/AssistantContext';
import Icon from '../ui/Icon';
import AssistantMessage from './AssistantMessage';
import AssistantInput from './AssistantInput';
import '../ui/lisa.css';

// Remembered across reloads so the panel opens at the width you chose.
const WIDTH_KEY = 'advocate-assistant-width';
const MIN_WIDTH = 380;

export default function AssistantPanel() {
  const { isOpen, setIsOpen, messages, isProcessing, clearHistory, exportHistory } = useAssistant() as any;
  const chatEndRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  // Maximize takes half the window.
  const [isMaximized, setIsMaximized] = useState(false);
  // The left edge can be dragged; the width is remembered per browser.
  const [width, setWidth] = useState<number | null>(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY));
    return saved >= MIN_WIDTH ? saved : null;
  });
  const draggingRef = useRef(false);

  const startDrag = useCallback((e: React.MouseEvent) => {
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

  // Ctrl+J opens and closes Lisa from anywhere; Escape closes the open panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setIsOpen((v: boolean) => !v); }
      if (e.key === 'Escape' && isOpen && panelRef.current?.contains(document.activeElement)) { setIsOpen(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, setIsOpen]);

  // Focus moves into the panel on open and back to the launcher on close.
  const wasOpen = useRef(isOpen);
  useEffect(() => {
    if (isOpen && !wasOpen.current) panelRef.current?.querySelector<HTMLInputElement>('.lisa-form input')?.focus();
    if (!isOpen && wasOpen.current) fabRef.current?.focus();
    wasOpen.current = isOpen;
  }, [isOpen]);

  if (!isOpen) {
    return (
      <button ref={fabRef} type="button" className="lisa-fab" onClick={() => setIsOpen(true)}
        aria-label={`Ask ${ASSISTANT_NAME}, the AI assistant`} title={`Ask ${ASSISTANT_NAME}`}>
        <span className="lisa-seal" aria-hidden="true">{ASSISTANT_NAME.charAt(0)}</span>
        <span className="lbl">Ask {ASSISTANT_NAME}</span>
      </button>
    );
  }

  const toggleMax = () => {
    // Drop any dragged width, or the inline style overrides the maximized size.
    setWidth(null);
    localStorage.removeItem(WIDTH_KEY);
    setIsMaximized((v) => !v);
  };

  return (
    <aside ref={panelRef} className={`lisa ${isMaximized ? 'max' : ''}`} style={width ? { width: `${width}px` } : undefined}
      role="complementary" aria-label={`${ASSISTANT_NAME}, AI assistant`}>
      <div className="lisa-resize" onMouseDown={startDrag} title="Drag to resize" role="separator" aria-orientation="vertical" />
      <div className="lisa-head">
        <span className="lisa-seal lg" aria-hidden="true">{ASSISTANT_NAME.charAt(0)}</span>
        <div>
          <h2>{ASSISTANT_NAME}</h2>
          <div className="sub"><i aria-hidden="true" />AI legal assistant · Online</div>
        </div>
        <div className="acts">
          <button type="button" className="icon-btn hide-sm" onClick={toggleMax}
            aria-label={isMaximized ? 'Restore size' : 'Expand to half the window'} title={isMaximized ? 'Restore size' : 'Expand to half the window'}>
            <Icon name={isMaximized ? 'minus' : 'sidebar'} />
          </button>
          <button type="button" className="icon-btn" onClick={exportHistory} aria-label="Export conversation" title="Export conversation">
            <Icon name="download" />
          </button>
          <button type="button" className="icon-btn" onClick={() => setConfirmClear((v) => !v)} disabled={!hasHistory}
            aria-label="Clear conversation" title={hasHistory ? 'Clear conversation' : 'Nothing to clear'}>
            <Icon name="trash" />
          </button>
          <button type="button" className="icon-btn" onClick={() => setIsOpen(false)} aria-label="Close" title="Close">
            <Icon name="x" />
          </button>
        </div>
      </div>

      {confirmClear && (
        <div className="callout warn lisa-confirm" role="alertdialog" aria-label="Confirm clear conversation">
          <Icon name="warn" size="sm" />
          <div className="grow">
            Clear this conversation? This can’t be undone.
            <div className="row">
              <button type="button" className="btn sm ghost" onClick={() => { exportHistory(); setConfirmClear(false); }}>Export first</button>
              <button type="button" className="btn sm" onClick={() => setConfirmClear(false)}>Cancel</button>
              <button type="button" className="btn sm danger solid" onClick={() => { clearHistory(); setConfirmClear(false); }}>Clear</button>
            </div>
          </div>
        </div>
      )}

      <div className="lisa-body" aria-live="polite">
        {messages.map((msg: any) => <AssistantMessage key={msg.id} message={msg} />)}
        {isProcessing && (
          <div className="lisa-msg ai">
            <span className="lisa-seal sm" aria-hidden="true">{ASSISTANT_NAME.charAt(0)}</span>
            <div className="lisa-bubble"><span className="lisa-thinking" aria-label={`${ASSISTANT_NAME} is thinking`}><i /><i /><i /></span></div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <AssistantInput />
    </aside>
  );
}
