// Today: the advocate's home. What is listed in court today, what is coming this
// week, what needs a decision, and a compact practice summary on the right rail.
// Data comes from /api/dashboard (DashboardFilterContext), which is role-aware:
// finance figures are only present for people allowed to see them.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useLoading } from '../contexts/LoadingContext';
import { usePermission } from '../contexts/PermissionContext';
import { useDashboardFilter } from '../contexts/DashboardFilterContext';
import { useWebSocketContext } from '../contexts/realtime/WebSocketProvider';
import ReportService from '../services/ReportService';
import { formatCurrency } from '../utils/formatCurrency';
import { requestPageModal } from '../utils/pageModal';
import { QUICK_CREATE } from '../layout/nav';
import { Icon, Chip, StatusChip, EmptyState, Skel, titleCase, Avatar } from '../ui/kit';

const DAY = 86400000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
// Calendar days from today: 0 today, 1 tomorrow, -1 yesterday. Dates from the API are
// plain ISO dates, read as local dates so IST never shifts them by a day.
function daysFrom(iso?: string | null) {
  if (!iso) return NaN;
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - startOfDay(new Date()).getTime()) / DAY);
}
const longDate = (d: Date) => d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function Stamp({ iso }: { iso: string }) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return (
    <div className={`stamp${daysFrom(iso) === 0 ? ' today' : ''}`} aria-label={date.toDateString()}>
      <span>{date.toLocaleDateString('en-IN', { weekday: 'short' })}</span><b>{d}</b>
    </div>
  );
}

// Ring chart for case status; the hole carries the total.
function Donut({ parts, size = 120, label, sub }: { parts: { label: string; value: number; color: string }[]; size?: number; label: string; sub: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  const r = size / 2 - 10, c = 2 * Math.PI * r;
  let off = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${label} ${sub}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth="14" />
      {parts.map((p) => {
        const len = (p.value / total) * c;
        const el = <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth="14"
          strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} transform={`rotate(-90 ${size / 2} ${size / 2})`} />;
        off += len;
        return el;
      })}
      <text x="50%" y="48%" textAnchor="middle" style={{ font: '500 26px var(--f-display)', fill: 'var(--ink)' }}>{label}</text>
      <text x="50%" y="64%" textAnchor="middle" style={{ font: '11px var(--f-body)', fill: 'var(--ink-3)' }}>{sub}</text>
    </svg>
  );
}

// Grouped bars (income vs expense by month). Plain SVG keeps it in the Red Tape palette.
function Bars({ labels, series, height = 180 }: { labels: string[]; series: { name: string; data: number[]; color: string }[]; height?: number }) {
  const max = Math.max(1, ...series.flatMap((s) => s.data));
  const w = 320, padL = 4, padB = 18, inner = height - padB - 6;
  const slot = (w - padL) / Math.max(labels.length, 1);
  const bw = Math.min(14, (slot - 8) / series.length);
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${height}`} width="100%" height={height} role="img" aria-label="Income and expense by month">
      {[0.25, 0.5, 0.75, 1].map((f) => <line key={f} className="grid-l" x1={padL} x2={w} y1={6 + inner * (1 - f)} y2={6 + inner * (1 - f)} />)}
      {labels.map((lb, i) => (
        <g key={lb + i}>
          {series.map((s, j) => {
            const h = (s.data[i] / max) * inner;
            return <rect key={s.name} x={padL + i * slot + (slot - bw * series.length) / 2 + j * bw} y={6 + inner - h} width={bw - 2} height={h} rx="2" fill={s.color}>
              <title>{`${s.name}, ${lb}: ${formatCurrency(s.data[i])}`}</title></rect>;
          })}
          <text x={padL + i * slot + slot / 2} y={height - 4} textAnchor="middle">{lb}</text>
        </g>
      ))}
    </svg>
  );
}

export default function Today() {
  const navigate = useNavigate();
  const auth = useAuth() as any;
  const { withLoading } = useLoading() as any;
  const { hasPermission } = usePermission() as any;
  const filter = useDashboardFilter() as any;
  const { data, loading } = filter;
  const [tasks, setTasks] = useState<any[] | null>(null);

  // Poll (30s + refresh-on-focus) only while Today is on screen.
  useEffect(() => {
    filter.setPollingEnabled(true);
    return () => filter.setPollingEnabled(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live updates pushed by the server refresh the figures.
  const { subscribe: wsSubscribe } = useWebSocketContext() as any;
  useEffect(() => {
    if (!wsSubscribe) return;
    return wsSubscribe('dashboard', () => { filter.invalidateCache(); filter.forceRefreshDashboard(); });
  }, [wsSubscribe, filter]);

  useEffect(() => { if (data) setTasks(data.tasks ?? []); }, [data]);

  const hr = new Date().getHours();
  const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const first = String(auth.fullName || '').trim().split(/\s+/)[0] || 'there';

  const hearings: any[] = useMemo(() => data?.hearings ?? [], [data]);
  const todays = hearings.filter((h) => daysFrom(h.date) === 0);
  const week = useMemo(() => {
    const byDay = new Map<string, any[]>();
    hearings.filter((h) => { const d = daysFrom(h.date); return d >= 1 && d <= 6; })
      .forEach((h) => byDay.set(h.date.slice(0, 10), [...(byDay.get(h.date.slice(0, 10)) || []), h]));
    return [...byDay.entries()];
  }, [hearings]);

  const s = data?.summary ?? {};
  const canFinance = data?.canViewFinance && hasPermission('INVOICE_VIEW');
  const overdue: any[] = canFinance ? (data?.invoices ?? []).filter((i: any) => i.status === 'OVERDUE') : [];
  const dueTasks = (tasks ?? []).filter((t) => !t.completed && t.deadline && daysFrom(t.deadline) <= 2);
  const attentionCount = overdue.length + dueTasks.length;

  const summary = loading && !data ? '' : [
    todays.length ? `${todays.length} matter${todays.length > 1 ? 's' : ''} listed today.` : 'Nothing of yours is listed today.',
    s.upcomingHearings ? `${s.upcomingHearings} upcoming hearing${s.upcomingHearings > 1 ? 's' : ''} in your diary.` : '',
    attentionCount ? `${attentionCount} item${attentionCount > 1 ? 's' : ''} need${attentionCount > 1 ? '' : 's'} your attention.` : '',
  ].filter(Boolean).join(' ');

  const statusColors = ['var(--ink)', 'var(--warn)', 'var(--mute)', 'var(--info)', 'var(--ok)', 'var(--tape)'];
  const statusParts = (data?.caseStatus?.items ?? []).map((i: any, n: number) => ({ label: titleCase(i.status), value: i.count, color: statusColors[n % statusColors.length] }));
  const courts: any[] = (data?.courtStats?.items ?? []).map((c: any) => ({ name: c.court, open: (c.active || 0) + (c.pending || 0) }))
    .filter((c: any) => c.open > 0).sort((a: any, b: any) => b.open - a.open).slice(0, 6);
  const maxLoad = Math.max(1, ...courts.map((c) => c.open));
  const ie: any[] = (data?.incomeExpense?.items ?? []).slice(-6);
  const quick = QUICK_CREATE.filter((a) => hasPermission(a.perm));

  const toggleTask = async (id: number) => {
    try {
      await withLoading(api.put(`/api/workspace/tasks/${id}/toggle`, {}), 'Updating task...');
      setTasks((prev) => (prev ?? []).map((t) => (t.id === id ? { ...t, completed: !t.completed } : t)));
      filter.invalidateCache();
    } catch (err) {
      console.error('Error toggling task:', err);
    }
  };

  const runQuick = (a: typeof QUICK_CREATE[number]) => { if (a.modal) requestPageModal(a.modal); navigate(a.route); };

  return (
    <div id="pg-today">
      <header className="pp-hero row between wrap" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="date">{longDate(new Date())}</div>
          <h1>{greet}, {first}</h1>
          <p className="sum">{summary || <span className="skel" style={{ display: 'inline-block', width: 320, maxWidth: '100%', height: 14 }} />}</p>
        </div>
        <div className="row">
          <span className="pp-live" title="Refreshes every 30 seconds">
            <i aria-hidden="true" />Live{filter.lastUpdated ? ` · ${filter.lastUpdated.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : ''}
          </span>
          <button type="button" className="btn sm" onClick={() => ReportService.downloadDashboard()}><Icon name="download" size="sm" />Export PDF</button>
        </div>
      </header>

      <div className="split">
        <div>
          {hasPermission('EVENT_VIEW') && (
            <>
              <div className="pp-sec"><h2>In court today</h2><Link className="link small" to="/dashboard/daily-causelist">Daily cause list</Link></div>
              <div className="panel">
                {loading && !data ? <div className="panel-body stack"><Skel h={48} /><Skel h={48} /></div>
                  : todays.length ? (
                    <div className="slips">
                      {todays.map((h, i) => (
                        <article key={h.id} className={`slip${i === 0 ? ' now' : ''}`}>
                          <div className="item"><b>{i + 1}</b><span>Today</span></div>
                          <div className="what">
                            {h.caseNumber && <span className="no">{h.caseNumber}</span>}
                            <div className="ttl">{h.title}</div>
                            <div className="where">{titleCase(h.eventType || 'Hearing')}</div>
                          </div>
                          <div className="when">{i === 0 ? <Chip tone="tape">Up next</Chip> : <Chip tone="info">Listed</Chip>}</div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <EmptyState icon="gavel" title="No hearings today" text="Use the time for drafting. Your next listing is on the calendar."
                      action={<Link className="btn sm" to="/dashboard/hearings">Open calendar</Link>} />
                  )}
              </div>

              <div className="pp-sec"><h2>This week</h2><Link className="link small" to="/dashboard/hearings">Calendar</Link></div>
              <div className="panel">
                {loading && !data ? <div className="panel-body"><Skel h={40} /></div>
                  : week.length ? week.map(([day, evs]) => (
                    <div key={day} className="pp-agenda-day">
                      <Stamp iso={day} />
                      <ul>
                        {evs.map((e) => (
                          <li key={e.id}>
                            <span className="t">{titleCase(e.eventType || 'Event')}</span>
                            <span className="ellipsis">{e.title}{e.caseNumber && <span className="faint mono"> {e.caseNumber}</span>}</span>
                            <span />
                          </li>
                        ))}
                      </ul>
                    </div>
                  )) : <div className="panel-body muted small">Nothing else is scheduled this week.</div>}
              </div>
            </>
          )}

          <div className="pp-sec"><h2>Needs your attention</h2><span className="sub">{attentionCount} item{attentionCount === 1 ? '' : 's'}</span></div>
          <div className="panel">
            {loading && !data ? <div className="panel-body"><Skel h={40} /></div> : attentionCount ? (
              <>
                {dueTasks.map((t) => {
                  const d = daysFrom(t.deadline);
                  return (
                    <div key={`t${t.id}`} className="pp-att">
                      <span className="ic hot"><Icon name="tasks" size="sm" /></span>
                      <div className="grow">
                        <div className="small"><b>{t.title}</b></div>
                        <div className="meta-line" style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-3)', marginTop: 2 }}>
                          <span style={{ color: d < 0 ? 'var(--bad)' : undefined }}>{d < 0 ? `${-d} day${d === -1 ? '' : 's'} overdue` : d === 0 ? 'Due today' : d === 1 ? 'Due tomorrow' : 'Due in 2 days'}</span>
                          {t.priority && <StatusChip status={t.priority} />}
                        </div>
                      </div>
                      <div className="acts">
                        {hasPermission('TASK_EDIT') && <button type="button" className="btn sm" onClick={() => toggleTask(t.id)}><Icon name="check" size="sm" />Mark done</button>}
                        {t.caseId && <Link className="btn sm ghost" to={`/dashboard/cases/${t.caseId}`}>Open case</Link>}
                      </div>
                    </div>
                  );
                })}
                {overdue.map((i) => (
                  <div key={`i${i.id}`} className="pp-att">
                    <span className="ic"><Icon name="receipt" size="sm" /></span>
                    <div className="grow">
                      <div className="small"><span className="mono">{i.invoiceNumber}</span> is overdue: <b className="num">{formatCurrency(i.amount)}</b></div>
                      {i.dueDate && <div className="xs" style={{ color: 'var(--bad)', marginTop: 2 }}>Due {new Date(i.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>}
                    </div>
                    <div className="acts"><Link className="btn sm" to="/dashboard/invoices" state={{ search: i.invoiceNumber, id: i.id }}>Open invoice</Link></div>
                  </div>
                ))}
              </>
            ) : <div className="panel-body"><EmptyState icon="ok" title="Nothing needs you right now" text="Tasks due soon and overdue invoices available to your role show up here." /></div>}
          </div>

          {hasPermission('TASK_VIEW') && (tasks ?? []).some((t) => !t.completed && !dueTasks.includes(t)) && (
            <>
              <div className="pp-sec"><h2>Open tasks</h2><Link className="link small" to="/dashboard/tasks">All tasks</Link></div>
              <div className="panel">
                {(tasks ?? []).filter((t) => !dueTasks.includes(t)).map((t) => (
                  <div key={t.id} className={`cs-task${t.completed ? ' done' : ''}`}>
                    <label className="check grow">
                      <input type="checkbox" checked={!!t.completed} disabled={!hasPermission('TASK_EDIT')} onChange={() => toggleTask(t.id)} />
                      <span className="ttl small">{t.title}</span>
                    </label>
                    {t.deadline && <span className="faint xs nowrap">{new Date(t.deadline).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>}
                    {t.priority && <StatusChip status={t.priority} />}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <aside className="stack rail" style={{ gap: 'var(--s4)' }} aria-label="Practice summary">
          <div className="figures pp-figs">
            <Link className="figure" to="/dashboard/cases"><div className="lbl">Active matters</div><div className="val">{loading && !data ? '–' : s.activeCases ?? 0}</div></Link>
            <Link className="figure" to="/dashboard/hearings"><div className="lbl">Upcoming hearings</div><div className="val">{loading && !data ? '–' : s.upcomingHearings ?? 0}</div></Link>
            <Link className="figure" to="/dashboard/clients"><div className="lbl">Clients</div><div className="val">{loading && !data ? '–' : s.clients ?? 0}</div></Link>
            {canFinance
              ? <Link className="figure" to="/dashboard/invoices"><div className="lbl">Invoices unpaid</div><div className="val">{s.pendingInvoices ?? 0}</div></Link>
              : <Link className="figure" to="/dashboard/cases"><div className="lbl">All matters</div><div className="val">{loading && !data ? '–' : s.totalCases ?? 0}</div></Link>}
          </div>

          {statusParts.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h3>Cases by status</h3></div>
              <div className="panel-body row" style={{ gap: 'var(--s4)', alignItems: 'center' }}>
                <Donut parts={statusParts} label={String(s.totalCases ?? statusParts.reduce((n: number, p: any) => n + p.value, 0))} sub="cases" />
                <div className="stack" style={{ gap: 6 }}>
                  {statusParts.map((p: any) => (
                    <div key={p.label} className="legend"><span><i style={{ background: p.color }} />{p.label} <b className="num" style={{ color: 'var(--ink)' }}>{p.value}</b></span></div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {courts.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h3>Court load</h3><span className="sub">Open matters</span></div>
              <div className="panel-body">
                {courts.map((c) => (
                  <div key={c.name} className="bar-row" style={{ gridTemplateColumns: 'minmax(0,1.3fr) 1fr 24px' }}>
                    <span className="ellipsis" title={c.name}>{c.name}</span>
                    <div className="bar-track"><i style={{ width: `${(c.open / maxLoad) * 100}%`, background: 'var(--ink)' }} /></div>
                    <span className="num right">{c.open}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {canFinance && hasPermission('PAYMENT_VIEW') && ie.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h3>Income and expenses</h3><span className="sub">By month</span></div>
              <div className="panel-body">
                <Bars labels={ie.map((m) => m.month)} series={[
                  { name: 'Income', data: ie.map((m) => m.income || 0), color: 'var(--ink)' },
                  { name: 'Expenses', data: ie.map((m) => m.expense || 0), color: 'var(--line-strong)' },
                ]} />
                <div className="legend"><span><i style={{ background: 'var(--ink)' }} />Income</span><span><i style={{ background: 'var(--line-strong)' }} />Expenses</span></div>
              </div>
            </section>
          )}

          {(data?.activities ?? []).length > 0 && (
            <section className="panel">
              <div className="panel-head"><h3>Recent activity</h3>{hasPermission('AUDIT_VIEW') && <Link className="link xs" to="/dashboard/activity">All</Link>}</div>
              <div className="panel-body">
                {data.activities.slice(0, 6).map((a: any) => (
                  <div key={a.id} className="pp-act">
                    <span className="ic" style={{ color: 'var(--ink-3)' }}><Icon name="history" size="sm" /></span>
                    <div className="grow">
                      <div>{a.description}</div>
                      <div className="faint xs">{a.actionType ? <span style={{ marginRight: 6 }}>{titleCase(a.actionType)}</span> : null}{a.timestamp ? new Date(a.timestamp).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(data?.recentClients ?? []).length > 0 && hasPermission('CLIENT_VIEW') && (
            <section className="panel">
              <div className="panel-head"><h3>Recent clients</h3><Link className="link xs" to="/dashboard/clients">All</Link></div>
              <div className="panel-body flush"><div className="list">
                {data.recentClients.map((c: any) => (
                  <Link key={c.id} className="list-item" to="/dashboard/clients" state={{ search: c.name, id: c.id }}>
                    <Avatar name={c.name} size="sm" /><span className="small ellipsis">{c.name}</span>
                  </Link>
                ))}
              </div></div>
            </section>
          )}

          {quick.length > 0 && (
            <section className="panel">
              <div className="panel-head"><h3>Quick actions</h3></div>
              <div className="panel-body flush"><div className="list">
                {quick.slice(0, 6).map((a) => (
                  <button key={a.command} type="button" className="list-item" onClick={() => runQuick(a)}>
                    <Icon name={a.icon} size="sm" /><span className="small">{a.command}</span>
                  </button>
                ))}
              </div></div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
