// AMS subscription summary (plan, status, features, limits and use) as sent
// by /api/firm/subscription and /api/platform/firms/:id/subscription.
// Display only: the server decides what a firm may do.
import { Chip, StatusChip } from './kit';

export type EntitlementRow = {
  key: string; label: string; kind: 'feature' | 'stock' | 'metered';
  enabled: boolean; limit: number | null; overridden: boolean; used: number | null; remaining: number | null;
};
export type SubscriptionSummary = {
  plan: { code: string; name: string; state?: string; revision?: number }; status: string; readOnly: boolean;
  planUsable?: boolean; testFirm?: boolean;
  trialEndsAt: string | null; window: string; entitlements: EntitlementRow[];
  ai?: { calls: number; estimatedCalls: number; failedCalls: number; inputTokens: number; outputTokens: number; totalTokens: number };
};

export function formatQty(key: string, n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  if (key === 'storage.bytes') {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = n, i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
    return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
  }
  return n.toLocaleString('en-IN');
}

function Meter({ used, limit }: { used: number; limit: number }) {
  const pct = limit <= 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  const tone = pct >= 100 ? 'var(--bad)' : pct >= 80 ? 'var(--warn)' : 'var(--ok)';
  return (
    <div className="sub-meter" role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} title={`${pct}%`}>
      <span style={{ width: `${pct}%`, background: tone }} />
    </div>
  );
}

export default function SubscriptionUsage({ data }: { data: SubscriptionSummary }) {
  const features = data.entitlements.filter((e) => e.kind === 'feature');
  const limits = data.entitlements.filter((e) => e.kind !== 'feature');
  const trialEnd = data.trialEndsAt ? new Date(data.trialEndsAt) : null;
  const noPlan = data.status === 'PENDING' || data.status === 'NONE';
  return (
    <div className="stack">
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <b style={{ fontSize: 18 }}>{data.plan.name}</b>
        <StatusChip status={data.status} />
        {data.plan.state && ['DRAFT', 'APPROVED'].includes(data.plan.state) && (
          <Chip tone="warn" title="Not approved and published for customers">unapproved plan</Chip>
        )}
        {data.testFirm && <Chip tone="info">test firm</Chip>}
        {trialEnd && data.status === 'TRIALING' && (
          <span className="small muted">Trial ends {trialEnd.toLocaleDateString()}</span>
        )}
      </div>
      {data.readOnly && (
        <div className="callout warn" role="status">
          {noPlan ? 'No AMS plan has been assigned yet' : `The subscription is ${data.status.toLowerCase().replace('_', ' ')}`}:
          existing work stays available and downloadable, but nothing new can be added
          until {noPlan ? 'a plan is assigned' : 'the plan is renewed'}.
        </div>
      )}
      {!data.readOnly && data.planUsable === false && (
        <div className="callout warn" role="status">
          This plan has not been approved for use: existing work stays available, but nothing new can be added.
        </div>
      )}
      <div className="table-wrap">
        <table className="t">
          <caption className="sr-only">Limits and use</caption>
          <thead><tr><th scope="col">Limit</th><th scope="col">Used</th><th scope="col">Allowed</th><th scope="col" style={{ width: '30%' }} /></tr></thead>
          <tbody>
            {limits.map((e) => (
              <tr key={e.key}>
                <th scope="row">{e.label}{e.overridden && <> <Chip tone="info" title="Adjusted for this firm">adjusted</Chip></>}</th>
                <td className="num">{formatQty(e.key, e.used)}</td>
                <td className="num">{!e.enabled ? 'Not included' : e.limit === null ? 'Unlimited' : formatQty(e.key, e.limit)}</td>
                <td>{e.enabled && e.limit !== null && e.used !== null && <Meter used={e.used} limit={e.limit} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} aria-label="Features">
        {features.map((f) => (
          <Chip key={f.key} tone={f.enabled ? 'ok' : ''} plain={!f.enabled}>
            {f.enabled ? '✓' : '✕'} {f.label}{f.overridden ? ' (adjusted)' : ''}
          </Chip>
        ))}
      </div>
      {data.ai && (
        <p className="small muted" style={{ margin: 0 }}>
          AI this month: {data.ai.calls.toLocaleString('en-IN')} call{data.ai.calls === 1 ? '' : 's'},{' '}
          {data.ai.totalTokens.toLocaleString('en-IN')} tokens
          {data.ai.estimatedCalls > 0 && ` (${data.ai.estimatedCalls} estimated from text length - the provider reported none)`}
          {data.ai.failedCalls > 0 && `, ${data.ai.failedCalls} failed`}.
        </p>
      )}
    </div>
  );
}
