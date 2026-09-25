import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from 'primereact/button';
import { Badge } from 'primereact/badge';
import { OverlayPanel } from 'primereact/overlaypanel';
import api from '../api/client';
import { useWebSocketContext } from '../contexts/realtime/WebSocketProvider';

export default function NotificationBell({ onOpen }: { onOpen?: (route: string) => void }) {
  const [count, setCount] = useState(0);
  const [alerts, setAlerts] = useState<any[]>([]);
  const panelRef = useRef<OverlayPanel>(null);
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
      /* the dropdown's empty state covers it */
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
  const handleDismiss = useCallback(async (e: any, alert: any) => {
    e.stopPropagation();
    await markRead(alert);
  }, [markRead]);

  const handleNotificationClick = useCallback(async (alert: any) => {
    if (!alert.route) return;
    panelRef.current?.hide();
    await markRead(alert);
    if (onOpen) onOpen(alert.route);
  }, [markRead, onOpen]);

  const formatTime = (ts: any) => {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="live-notif-bell-wrapper p-overlay-badge">
      <Button text rounded className="icon-btn live-notif-bell" icon="pi pi-bell"
        aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'} tooltip="Notifications"
        tooltipOptions={{ position: 'bottom' }} onClick={(e) => panelRef.current?.toggle(e)} />
      {/* Outside the button: a PrimeReact button clips its overflow, which hid the count. */}
      {count > 0 && <Badge className="live-notif-count" value={count > 99 ? '99+' : count} severity="danger" />}
      <OverlayPanel ref={panelRef} className="live-notif-dropdown" style={{ width: 360 }}>
        <div className="live-notif-header flex align-items-center justify-content-between mb-2">
          <h4 className="m-0">Notifications</h4>
          <Button text size="small" label="Close" onClick={() => panelRef.current?.hide()} />
        </div>
        <div className="live-notif-list">
          {alerts.length === 0 ? (
            <p className="no-data">Nothing unread.</p>
          ) : (
            alerts.map((a) => (
              <div
                key={a.id}
                className={`live-notif-item${a.route ? ' clickable' : ''}`}
                role={a.route ? 'button' : undefined}
                tabIndex={a.route ? 0 : undefined}
                title={a.route ? 'Open' : undefined}
                onClick={() => handleNotificationClick(a)}
                onKeyDown={(e) => {
                  if (a.route && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    handleNotificationClick(a);
                  }
                }}
              >
                <Button type="button" icon="pi pi-times" text rounded size="small" className="live-notif-dismiss"
                  aria-label={`Mark as read: ${a.message}`} onClick={(e) => handleDismiss(e, a)} />
                <div className="live-notif-msg">{a.message}</div>
                <div className="live-notif-row flex align-items-center justify-content-between">
                  <span className="live-notif-time">{formatTime(a.timestamp)}</span>
                  <span className="live-notif-actions flex align-items-center gap-2">
                    <Button type="button" text size="small" label="Got it" className="live-notif-gotit" onClick={(e) => handleDismiss(e, a)} />
                    {a.route && <span className="live-notif-go">Open <i className="pi pi-angle-right" /></span>}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </OverlayPanel>
    </div>
  );
}
