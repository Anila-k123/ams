import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import api from '../api/client';
import { useWebSocketContext } from '../contexts/realtime/WebSocketProvider';
import Icon from '../ui/Icon';
import { EmptyState } from '../ui/kit';

export default function NotificationBell({ onOpen, footer }: { onOpen?: (route: string) => void; footer?: { label: string; route: string } }) {
  const [count, setCount] = useState(0);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { subscribe } = useWebSocketContext() as any;
  // Chime when the unread count rises.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const prevCount = useRef<number | null>(null);

  useEffect(() => {
    try {
      audioRef.current = new Audio('/notification.mp3');
    } catch { /* no audio available; the badge still updates */ }
  }, []);

  // Unread notifications over REST; the WS subscription below upgrades to push if a /ws backend lands.
  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/notifications/unread');
      const rows = (Array.isArray(res.data) ? res.data : []).map((n: any) => ({
        id: n.id,
        message: n.message,
        timestamp: n.timestamp || n.createdAt,
        // Server-resolved destination; null for old rows (those stay read-only).
        route: n.route || null,
        entityType: n.entityType || null,
      }));
      setAlerts(rows.slice(0, 50));
      setCount(rows.length);
      // null on the first load: arriving to N unread is not N new arrivals.
      if (prevCount.current !== null && rows.length > prevCount.current) {
        audioRef.current?.play().catch(() => {});
      }
      prevCount.current = rows.length;
    } catch {
      /* the panel's empty state covers it */
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setInterval(load, 60000);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);

  useEffect(() => {
    const unsub = subscribe('notification', (event: any) => {
      setAlerts((prev) => [{ ...event, id: `live-${Date.now()}-${Math.random()}` }, ...prev].slice(0, 50));
      setCount((c) => c + 1);
    });
    return unsub;
  }, [subscribe]);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node) && !btnRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);

  // Marking read and navigating are separate actions.
  const markRead = useCallback(async (alert: any) => {
    if (!alert.id || String(alert.id).startsWith('live-')) {
      setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
      setCount((c) => Math.max(0, c - 1));
      return true;
    }
    try {
      await api.put(`/api/notifications/${alert.id}/read`, {});
      setAlerts((prev) => prev.filter((a) => a.id !== alert.id));
      setCount((c) => Math.max(0, c - 1));
      prevCount.current = Math.max(0, (prevCount.current ?? 1) - 1);
      return true;
    } catch {
      return false; // leave it unread rather than lying about it
    }
  }, []);

  // "Got it": clear it and stay; the panel stays open so a run can be cleared in one pass.
  const handleDismiss = useCallback(async (e: React.MouseEvent, alert: any) => {
    e.stopPropagation();
    await markRead(alert);
  }, [markRead]);

  const handleNotificationClick = useCallback(async (alert: any) => {
    if (!alert.route) return;
    setOpen(false);
    await markRead(alert);
    if (onOpen) onOpen(alert.route);
  }, [markRead, onOpen]);

  const formatTime = (ts: any) => {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay
      ? d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  const r = btnRef.current?.getBoundingClientRect();

  return (
    <>
      <button ref={btnRef} type="button" className="icon-btn" onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={open}
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'} title="Notifications">
        <Icon name="bell" />
        {count > 0 && <span className="dot">{count > 99 ? '99+' : count}</span>}
      </button>
      {open && r && createPortal(
        <div ref={panelRef} className="popover notif-panel" role="dialog" aria-label="Notifications"
          style={{ top: r.bottom + 6, right: Math.max(12, window.innerWidth - r.right) }}>
          <div className="head">
            <h3>Notifications</h3>
            <span className="faint xs">{count ? `${count} unread` : 'All caught up'}</span>
          </div>
          <div style={{ maxHeight: 'min(440px, 60vh)', overflowY: 'auto' }}>
            {alerts.length === 0 ? (
              <EmptyState icon="ok" title="Nothing unread" text="Hearing reminders, task reviews and client replies appear here." />
            ) : alerts.map((a) => (
              <div key={a.id} className={`notif unread`} role={a.route ? 'button' : undefined} tabIndex={a.route ? 0 : undefined}
                style={{ cursor: a.route ? 'pointer' : 'default' }}
                onClick={() => handleNotificationClick(a)}
                onKeyDown={(e) => { if (a.route && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); handleNotificationClick(a); } }}>
                <span className="ic"><Icon name="bell" size="sm" /></span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="small">{a.message}</div>
                  <div className="row xs faint" style={{ marginTop: 4 }}>
                    <span>{formatTime(a.timestamp)}</span>
                    <span className="grow" />
                    <button type="button" className="btn sm ghost" onClick={(e) => handleDismiss(e, a)} aria-label={`Mark as read: ${a.message}`}>Got it</button>
                    {a.route && <span className="row" style={{ gap: 2 }}>Open<Icon name="chevron" size="sm" /></span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {footer && (
            <div style={{ padding: '10px 16px', borderTop: '1px solid var(--line)' }}>
              <button type="button" className="link small" style={{ border: 0, background: 'none', padding: 0 }}
                onClick={() => { setOpen(false); onOpen?.(footer.route); }}>{footer.label}</button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
