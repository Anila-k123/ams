import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';

// Each action navigates to its page and opens that page's "add" form directly.
// `modal` matches the detail string the target page listens for on the
// "assistant-open-modal" window event.
const QUICK_ACTIONS: { icon: string; label: string; route: string; modal?: string }[] = [
  { icon: 'pi pi-users', label: 'New Client', route: '/dashboard/clients', modal: 'create-client' },
  { icon: 'pi pi-briefcase', label: 'New Case', route: '/dashboard/cases', modal: 'create-case' },
  { icon: 'pi pi-calendar', label: 'New Hearing', route: '/dashboard/hearings', modal: 'create-hearing' },
  { icon: 'pi pi-indian-rupee', label: 'Generate Invoice', route: '/dashboard/invoices', modal: 'create-invoice' },
  { icon: 'pi pi-folder', label: 'Upload Document', route: '/dashboard/documents', modal: 'upload-document' },
  { icon: 'pi pi-credit-card', label: 'Add Expense', route: '/dashboard/expenses', modal: 'create-expense' },
  { icon: 'pi pi-pencil', label: 'New Draft', route: '/dashboard/drafting/new' },
];

interface Props { isOpen: boolean; onClose: () => void; onAction: (route: string, modal?: string) => void }

export default function QuickActionsModal({ isOpen, onClose, onAction }: Props) {
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
      <div className="text-xs font-semibold uppercase mb-2" style={{ color: 'var(--text-muted)' }}>Create</div>
      <div className="grid">
        {QUICK_ACTIONS.map((qa) => (
          <div key={qa.label} className="col-6">
            <Button className="w-full justify-content-start" outlined icon={qa.icon} label={qa.label}
              onClick={() => onAction(qa.route, qa.modal)} />
          </div>
        ))}
      </div>
    </Dialog>
  );
}
