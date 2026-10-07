// Sidebar model (approved Red Tape prototype, "Version 2").
//   pinned: the daily workspace, always visible.
//   groups: collapsible, one open at a time; the group holding the current page
//           opens itself, and the open group is remembered.
//   bottom: pinned under the groups, next to the profile.
// `perm` is one permission or a list (any one of them is enough), and matches
// the route guards in pages/Dashboard.tsx.
import type { IconName } from '../ui/Icon';
import { DRAFTING } from '../pages/Drafting/routes';

export type Perm = string | string[];
export type NavItem = { path: string; label: string; icon: IconName; perm?: Perm; end?: boolean; countKey?: CountKey };
export type NavGroup = { id: string; label: string; icon: IconName; items: NavItem[] };
export type CountKey = 'activeCases' | 'pendingInvoices' | 'tasksToReview';

// Appeal alerts and the legal reference are tools for legal work: shown to
// those who edit cases or draft, not accounts.
export const LEGAL_WORK_PERMS = ['CASE_EDIT', 'DRAFT_VIEW'];
// The practice-wide delivery log and client communication: for the admin,
// seniors and the accountant. Everyone keeps their own alerts in the bell.
export const COMMS_PERMS = ['SETTINGS_EDIT', 'TASK_ASSIGN', 'INVOICE_CREATE'];

const D = '/dashboard';

export const NAV: { pinned: NavItem[]; groups: NavGroup[]; bottom: NavItem[] } = {
  pinned: [
    { path: D, label: 'Today', icon: 'home', end: true },
    { path: `${D}/cases`, label: 'Cases', icon: 'case', perm: 'CASE_VIEW', countKey: 'activeCases' },
    // Calendar stays pinned because it is used beyond court hearings.
    { path: `${D}/hearings`, label: 'Calendar', icon: 'calendar', perm: 'EVENT_VIEW' },
    { path: `${D}/tasks`, label: 'Tasks', icon: 'tasks', perm: 'TASK_VIEW', countKey: 'tasksToReview' },
  ],
  groups: [
    { id: 'court', label: 'Court Work', icon: 'gavel', items: [
      { path: `${D}/daily-causelist`, label: 'Daily Cause List', icon: 'list', perm: 'CASE_VIEW' },
      { path: `${D}/display-board`, label: 'Court Display Board', icon: 'board', perm: 'CASE_VIEW' },
      { path: `${D}/appeal-alert`, label: 'Appeal Alerts', icon: 'alert', perm: LEGAL_WORK_PERMS },
    ] },
    { id: 'clients', label: 'Clients & Files', icon: 'users', items: [
      { path: `${D}/clients`, label: 'Clients', icon: 'users', perm: 'CLIENT_VIEW' },
      { path: `${D}/documents`, label: 'Documents', icon: 'folder', perm: 'DOCUMENT_VIEW' },
    ] },
    { id: 'drafting', label: 'Drafting', icon: 'pen', items: [
      { path: DRAFTING.drafts, label: 'Drafts', icon: 'pen', perm: 'DRAFT_VIEW' },
      { path: DRAFTING.templates, label: 'Firm Templates', icon: 'template', perm: 'DRAFT_VIEW' },
      { path: DRAFTING.samples, label: 'Draft Documents', icon: 'file', perm: 'DRAFT_VIEW' },
      { path: DRAFTING.playbooks, label: 'Clause Playbooks', icon: 'shield', perm: 'DRAFT_VIEW' },
    ] },
    { id: 'library', label: 'Legal Research', icon: 'book', items: [
      { path: `${D}/acts`, label: 'Bare Acts', icon: 'book', perm: LEGAL_WORK_PERMS },
      { path: `${D}/law-codes`, label: 'Section Cross-Reference', icon: 'swap', perm: LEGAL_WORK_PERMS },
      { path: `${D}/legal-dictionary`, label: 'Legal Dictionary', icon: 'dict', perm: LEGAL_WORK_PERMS },
    ] },
    { id: 'billing', label: 'Finance & Reports', icon: 'rupee', items: [
      { path: `${D}/invoices`, label: 'Invoices', icon: 'receipt', perm: 'INVOICE_VIEW', countKey: 'pendingInvoices' },
      { path: `${D}/expenses`, label: 'Expenses', icon: 'wallet', perm: 'EXPENSE_VIEW' },
      { path: `${D}/reports`, label: 'Practice Reports', icon: 'chart', perm: 'REPORT_VIEW' },
    ] },
    { id: 'communications', label: 'Communications', icon: 'send', items: [
      { path: `${D}/communication`, label: 'Client Messages', icon: 'chat', perm: COMMS_PERMS, end: true },
      { path: `${D}/communication/history`, label: 'Message History', icon: 'history', perm: COMMS_PERMS },
      { path: `${D}/notifications`, label: 'Delivery Log', icon: 'bell', perm: COMMS_PERMS },
      { path: `${D}/communication/settings`, label: 'Communication Channels', icon: 'cog', perm: 'SETTINGS_EDIT' },
    ] },
    { id: 'firm', label: 'Firm Administration', icon: 'key', items: [
      { path: `${D}/users`, label: 'Team Members', icon: 'user', perm: 'USER_MANAGE' },
      { path: `${D}/roles`, label: 'Roles & Permissions', icon: 'key', perm: 'ROLE_MANAGE' },
      { path: `${D}/activity`, label: 'Audit Log', icon: 'history', perm: 'AUDIT_VIEW' },
      { path: `${D}/backup`, label: 'Backup & Restore', icon: 'database', perm: 'BACKUP_MANAGE' },
    ] },
  ],
  bottom: [
    { path: `${D}/settings`, label: 'Settings', icon: 'cog' },
  ],
};

export const NAV_ALL = (): NavItem[] => [...NAV.pinned, ...NAV.groups.flatMap((g) => g.items), ...NAV.bottom];

// The nav item for a path: the longest matching prefix wins, so /cases/12 is Cases.
export function activeItem(path: string): NavItem | undefined {
  const p = path.replace(/\/$/, '') || D;
  let best: NavItem | undefined;
  for (const it of NAV_ALL()) {
    const hit = it.path === D ? p === D : (p === it.path || p.startsWith(it.path + '/'));
    if (hit && (!best || it.path.length > best.path.length)) best = it;
  }
  // Drafting screens without their own entry (new draft, a draft's pages) belong under Drafts.
  if (!best && p.startsWith(`${D}/drafting`)) best = NAV.groups.find((g) => g.id === 'drafting')?.items[0];
  return best;
}

export const groupOf = (item?: NavItem) => item && NAV.groups.find((g) => g.items.includes(item));

/* "New" menu and search commands. Permission-aware, so the UI never offers an
   action the current role cannot actually perform. `modal` is the add form the
   target page opens on arrival (utils/pageModal). */
export type QuickCreate = { label: string; command: string; icon: IconName; perm: string; route: string; modal?: string; group: 'matter' | 'finance' | 'work'; key?: string };
export const QUICK_CREATE: QuickCreate[] = [
  // The full Add Case page, not the Cases pop-up: only the page saves the
  // court record, parties and upcoming hearings with the case.
  { label: 'Case', command: 'New case', icon: 'case', perm: 'CASE_CREATE', route: `${D}/cases/new`, group: 'matter', key: 'C' },
  { label: 'Hearing or event', command: 'New hearing or event', icon: 'calendar', perm: 'EVENT_CREATE', route: `${D}/hearings`, modal: 'create-hearing', group: 'matter', key: 'H' },
  { label: 'Client', command: 'New client', icon: 'users', perm: 'CLIENT_CREATE', route: `${D}/clients`, modal: 'create-client', group: 'matter' },
  { label: 'Invoice', command: 'Generate invoice', icon: 'receipt', perm: 'INVOICE_CREATE', route: `${D}/invoices`, modal: 'create-invoice', group: 'finance' },
  { label: 'Expense', command: 'Add expense', icon: 'wallet', perm: 'EXPENSE_CREATE', route: `${D}/expenses`, modal: 'create-expense', group: 'finance' },
  { label: 'Upload documents', command: 'Upload documents', icon: 'upload', perm: 'DOCUMENT_UPLOAD', route: `${D}/documents`, modal: 'upload-document', group: 'work' },
  { label: 'Draft', command: 'New draft', icon: 'pen', perm: 'DRAFT_CREATE', route: DRAFTING.newDraft, group: 'work' },
];
