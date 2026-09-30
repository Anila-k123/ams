import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { usePermission } from '../contexts/PermissionContext';
import { DRAFTING } from '../pages/Drafting/routes';

// Each action navigates to its page and opens that page's "add" form directly.
// `modal` matches the detail string the target page listens for on the
// "assistant-open-modal" window event. `perm` hides an action the user could not
// complete anyway (the target page and the API refuse it).
const QUICK_ACTIONS: { icon: string; label: string; route: string; modal?: string; perm: string }[] = [
  { icon: 'pi pi-users', label: 'New Client', route: '/dashboard/clients', modal: 'create-client', perm: 'CLIENT_CREATE' },
  // The full Add Case page, not the Cases pop-up: only the page saves the
  // court record, parties and upcoming hearings with the case.
  { icon: 'pi pi-briefcase', label: 'New Case', route: '/dashboard/cases/new', perm: 'CASE_CREATE' },
  { icon: 'pi pi-calendar', label: 'New Hearing', route: '/dashboard/hearings', modal: 'create-hearing', perm: 'EVENT_CREATE' },
  { icon: 'pi pi-indian-rupee', label: 'Generate Invoice', route: '/dashboard/invoices', modal: 'create-invoice', perm: 'INVOICE_CREATE' },
  { icon: 'pi pi-folder', label: 'Upload Document', route: '/dashboard/documents', modal: 'upload-document', perm: 'DOCUMENT_UPLOAD' },
  { icon: 'pi pi-credit-card', label: 'Add Expense', route: '/dashboard/expenses', modal: 'create-expense', perm: 'EXPENSE_CREATE' },
];

// Drafting gets its own group, matching its own section in the sidebar.
const DRAFT_ACTIONS: { icon: string; label: string; route: string; perm: string }[] = [
  { icon: 'pi pi-pencil', label: 'New Draft', route: DRAFTING.newDraft, perm: 'DRAFT_CREATE' },
  { icon: 'pi pi-file-edit', label: 'Open Drafts', route: DRAFTING.drafts, perm: 'DRAFT_VIEW' },
];

interface Props { isOpen: boolean; onClose: () => void; onAction: (route: string, modal?: string) => void }

export default function QuickActionsModal({ isOpen, onClose, onAction }: Props) {
  const { hasPermission } = usePermission() as any;
  const create = QUICK_ACTIONS.filter((qa) => hasPermission(qa.perm));
  const drafting = DRAFT_ACTIONS.filter((qa) => hasPermission(qa.perm));
  return (
    <Dialog
      visible={isOpen}
      onHide={onClose}
      header={<span><i className="pi pi-bolt mr-2" />Quick Actions</span>}
      style={{ width: '32rem' }}
      breakpoints={{ '640px': '95vw' }}
      dismissableMask
      closeOnEscape
      position="top"
      footer={<span className="text-sm" style={{ color: 'var(--text-muted)' }}><kbd>Esc</kbd> Close</span>}
    >
      {create.length > 0 && (
        <>
          <div className="text-xs font-semibold uppercase mb-2" style={{ color: 'var(--text-muted)' }}>Create</div>
          <div className="grid">
            {create.map((qa) => (
              <div key={qa.label} className="col-6">
                <Button className="w-full justify-content-start" outlined icon={qa.icon} label={qa.label}
                  onClick={() => onAction(qa.route, qa.modal)} />
              </div>
            ))}
          </div>
        </>
      )}
      {drafting.length > 0 && (
        <>
          <div className="text-xs font-semibold uppercase mb-2 mt-3" style={{ color: 'var(--text-muted)' }}>Drafting</div>
          <div className="grid">
            {drafting.map((qa) => (
              <div key={qa.label} className="col-6">
                <Button className="w-full justify-content-start" outlined icon={qa.icon} label={qa.label}
                  onClick={() => onAction(qa.route)} />
              </div>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}
