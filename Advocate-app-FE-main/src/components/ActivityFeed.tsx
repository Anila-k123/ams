import { useState, useEffect, useRef, useCallback } from 'react';
import { Skeleton } from 'primereact/skeleton';
import api from '../api/client';
import { useWebSocketContext } from '../contexts/realtime/WebSocketProvider';

// Shape returned by /api/activities/my-activities -> the shape this feed renders.
function fromApi(a: any) {
  return { id: a.id, type: a.actionType, message: a.description, timestamp: a.timestamp };
}

const typeIcon = (type?: string) => {
  if (!type) return 'pi-list';
  if (type.startsWith('CLIENT')) return 'pi-user';
  if (type.startsWith('CASE')) return 'pi-folder';
  if (type.startsWith('EXPENSE')) return 'pi-wallet';
  if (type.startsWith('INVOICE')) return 'pi-file';
  if (type.startsWith('PAYMENT')) return 'pi-money-bill';
  if (type.startsWith('HEARING') || type.startsWith('EVENT')) return 'pi-bell';
  if (type.startsWith('DOCUMENT')) return 'pi-file';
  if (type.startsWith('TASK')) return 'pi-check-circle';
  if (type.startsWith('WORKSPACE')) return 'pi-inbox';
  return 'pi-list';
};

const formatTime = (ts: any) => {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: '2-digit', month: 'short' });
};

export default function ActivityFeed({ maxItems = 10 }: { maxItems?: number }) {
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const { subscribe } = useWebSocketContext() as any;

  // Own activity over REST (my-activities needs no permission, unlike /api/activities).
  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/activities/my-activities');
      const rows = Array.isArray(res.data) ? res.data : (res.data?.content || []);
      setActivities(rows.map(fromApi).slice(0, maxItems));
    } catch {
      /* leave the list empty; the empty state covers it */
    } finally {
      setLoading(false);
    }
  }, [maxItems]);

  useEffect(() => { load(); }, [load]);

  // Still honour live events when a WS backend exists.
  useEffect(() => {
    const unsub = subscribe('activity', (event: any) => {
      setActivities((prev) =>
        [{ ...event, id: `live-${Date.now()}-${Math.random()}` }, ...prev].slice(0, maxItems));
    });
    return unsub;
  }, [subscribe, maxItems]);

  // Refresh on tab focus and after the assistant or a page reports a change.
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    window.addEventListener('assistant-refresh-dashboard', onFocus);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('assistant-refresh-dashboard', onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [activities]);

  return (
    <div className="live-activity-feed">
      <div className="card-header-row">
        <h4><i className="pi pi-chart-line mr-2" />Recent Activity</h4>
      </div>
      <div ref={listRef} className="live-activity-list">
        {loading ? (
          <div className="flex flex-column gap-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} height="2.25rem" />)}
          </div>
        ) : activities.length === 0 ? (
          <p className="no-data">No activity yet. Changes you make will appear here.</p>
        ) : (
          activities.map((a) => (
            <div key={a.id} className="live-activity-item slide-in">
              <span className="activity-icon"><i className={`pi ${typeIcon(a.type)}`} /></span>
              <div className="activity-content">
                <span className="activity-message">{a.message}</span>
                <span className="activity-time">{formatTime(a.timestamp)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
