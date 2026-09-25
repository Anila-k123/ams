import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from 'primereact/button';
import api from '../api/client';

const SNOOZE_MINUTES = 5;
const SOUND_ENABLED_KEY = 'advocate-hearing-sound';
// Hearings dismissed today, so a reload does not bring the same popup straight back.
const DISMISSED_KEY = 'advocate-hearing-dismissed';
const IMMINENT_HOURS = 4;
const POLL_MS = 5 * 60 * 1000;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadDismissed(): any[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DISMISSED_KEY) || '{}');
    return raw.day === todayKey() && Array.isArray(raw.ids) ? raw.ids : [];
  } catch {
    return [];
  }
}

function saveDismissed(ids: any[]) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify({ day: todayKey(), ids }));
  } catch { /* private mode */ }
}

function hearingMoment(dateStr: string, timeStr: string) {
  if (!dateStr || !timeStr) return null;
  const d = new Date(`${dateStr}T${String(timeStr).slice(0, 8)}`);
  return isNaN(d.getTime()) ? null : d;
}

export default function HearingAlertPopup({ onView }: { onView?: (alert: any) => void }) {
  const [alerts, setAlerts] = useState<any[]>([]);
  const [dismissedIds, setDismissedIds] = useState<any[]>(loadDismissed);
  const snoozedUntilRef = useRef<Record<string, number>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const announcedRef = useRef(new Set<any>());
  const [soundEnabled, setSoundEnabled] = useState(() => localStorage.getItem(SOUND_ENABLED_KEY) !== 'false');

  useEffect(() => {
    try {
      audioRef.current = new Audio('/notification.mp3');
    } catch { /* no sound available */ }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/events/today');
      const now = new Date();
      const cutoff = new Date(now.getTime() + IMMINENT_HOURS * 3600 * 1000);

      const due = (Array.isArray(res.data) ? res.data : []).filter((e: any) => {
        if ((e.eventType || '').toUpperCase() !== 'HEARING') return false;
        const snoozedUntil = snoozedUntilRef.current[e.id];
        if (snoozedUntil && snoozedUntil > now.getTime()) return false;
        if (dismissedIds.includes(e.id)) return false;
        const at = hearingMoment(e.date, e.time);
        if (!at) return true; // no time listed: still worth flagging once
        return at >= now && at <= cutoff;
      });

      setAlerts(due.map((e: any) => ({
        id: e.id,
        caseNumber: e.caseEntity?.caseNumber || e.caseEntity?.case_number || null,
        time: e.time ? String(e.time).slice(0, 5) : null,
        message: e.title || 'Hearing listed today',
      })));

      const fresh = due.filter((e: any) => !announcedRef.current.has(e.id));
      if (fresh.length && soundEnabled && audioRef.current) audioRef.current.play().catch(() => {});
      fresh.forEach((e: any) => announcedRef.current.add(e.id));
    } catch {
      /* a failed poll should not clear alerts */
    }
  }, [dismissedIds, soundEnabled]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(t); window.removeEventListener('focus', onFocus); };
  }, [load]);

  const dismiss = useCallback((id: any) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    setDismissedIds((prev) => {
      const next = prev.includes(id) ? prev : [...prev, id];
      saveDismissed(next);
      return next;
    });
  }, []);

  const snooze = useCallback((id: any) => {
    snoozedUntilRef.current[id] = Date.now() + SNOOZE_MINUTES * 60 * 1000;
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const toggleSound = useCallback(() => {
    setSoundEnabled((v) => {
      const next = !v;
      localStorage.setItem(SOUND_ENABLED_KEY, String(next));
      return next;
    });
  }, []);

  if (alerts.length === 0) return null;

  return (
    <div className="hearing-alerts-container">
      <div className="hearing-alerts-toolbar">
        <Button text rounded size="small" className="hearing-sound-toggle" onClick={toggleSound}
          icon={soundEnabled ? 'pi pi-volume-up' : 'pi pi-volume-off'} tooltip={soundEnabled ? 'Mute alerts' : 'Enable sound'} />
      </div>
      {alerts.map((alert) => (
        <div key={alert.id} className="hearing-alert-popup slide-in-down">
          <div className="hearing-alert-header flex align-items-center gap-2">
            <i className="pi pi-clock hearing-alert-icon" />
            <span className="hearing-alert-title flex-1">Hearing today</span>
            <Button text rounded size="small" icon="pi pi-times" className="hearing-alert-close" aria-label="Dismiss" onClick={() => dismiss(alert.id)} />
          </div>
          <div className="hearing-alert-body">
            <p className="hearing-alert-message">{alert.message}</p>
            <p className="hearing-alert-case">
              {alert.caseNumber && <><strong>Case:</strong> {alert.caseNumber} | </>}
              <strong>Time:</strong> {alert.time || 'not listed'}
            </p>
          </div>
          <div className="hearing-alert-actions flex gap-2">
            <Button size="small" icon="pi pi-eye" label="View" onClick={() => { dismiss(alert.id); if (onView) onView(alert); }} />
            <Button size="small" outlined label={`Snooze ${SNOOZE_MINUTES}m`} onClick={() => snooze(alert.id)} />
            <Button size="small" text label="Dismiss" onClick={() => dismiss(alert.id)} />
          </div>
        </div>
      ))}
    </div>
  );
}
