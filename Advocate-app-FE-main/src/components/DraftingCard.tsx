import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from 'primereact/button';
import { Skeleton } from 'primereact/skeleton';
import { Tag } from 'primereact/tag';
import { draftingApi, type DraftSession } from '../pages/Drafting/api/drafting';
import { DRAFTING } from '../pages/Drafting/routes';
import { usePermission } from '../contexts/PermissionContext';

const STATUS_SEVERITY: Record<string, 'success' | 'info' | 'warning' | 'danger'> = {
  ready: 'success', generating: 'info', pending: 'warning', failed: 'danger',
};

// A way into Drafting from the dashboard: start a draft, or reopen a recent one.
// The dashboard only renders this for DRAFT_VIEW holders.
export default function DraftingCard() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission() as any;
  const [drafts, setDrafts] = useState<DraftSession[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    draftingApi.getSessions()
      .then((rows) => setDrafts([...rows]
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, 3)))
      .catch(() => { setDrafts([]); setFailed(true); });
  }, []);

  const title = (d: DraftSession) =>
    d.template_name || d.document_type || d.sample_names?.[0] || `Draft #${d.id}`;

  return (
    <div className="row-four-card drafting-card">
      <div className="card-header-row">
        <h4>Drafting</h4>
        <Link to={DRAFTING.drafts} className="view-all-link">View All</Link>
      </div>
      {hasPermission('DRAFT_CREATE') && (
        <Button size="small" icon="pi pi-pencil" label="New draft" className="mb-3 align-self-start"
          onClick={() => navigate(DRAFTING.newDraft)} />
      )}
      {drafts === null ? (
        <div className="flex flex-column gap-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} height="1.75rem" />)}
        </div>
      ) : drafts.length === 0 ? (
        <p className="no-data">{failed ? 'Could not load your drafts.' : 'No drafts yet.'}</p>
      ) : (
        <div className="flex flex-column gap-2">
          {drafts.map((d) => (
            <div key={d.id} className="flex align-items-center gap-2">
              {d.status === 'ready'
                ? <Link to={DRAFTING.draft(d.id)} className="flex-1 white-space-nowrap overflow-hidden text-overflow-ellipsis">{title(d)}</Link>
                : <span className="flex-1 white-space-nowrap overflow-hidden text-overflow-ellipsis">{title(d)}</span>}
              <Tag value={d.status} severity={STATUS_SEVERITY[d.status]} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
