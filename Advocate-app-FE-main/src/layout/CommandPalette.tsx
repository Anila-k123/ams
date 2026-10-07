// Search and commands (Ctrl+K). One list, grouped: records from /api/search/global,
// then pages and create actions this role may use. Arrow keys move, Enter opens.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearch } from '../contexts/SearchContext';
import Icon, { type IconName } from '../ui/Icon';
import { EmptyState, titleCase } from '../ui/kit';
import { formatCurrency } from '../utils/formatCurrency';
import { NAV_ALL, QUICK_CREATE, type Perm } from './nav';

// Record groups, in display order. `key` is the field in the search response.
const SECTIONS: { key: string; label: string; icon: IconName; perm: string }[] = [
  { key: 'cases', label: 'Cases', icon: 'case', perm: 'CASE_VIEW' },
  { key: 'clients', label: 'Clients', icon: 'users', perm: 'CLIENT_VIEW' },
  { key: 'events', label: 'Hearings and events', icon: 'calendar', perm: 'EVENT_VIEW' },
  { key: 'invoices', label: 'Invoices', icon: 'receipt', perm: 'INVOICE_VIEW' },
  { key: 'documents', label: 'Documents', icon: 'file', perm: 'DOCUMENT_VIEW' },
  { key: 'expenses', label: 'Expenses', icon: 'wallet', perm: 'EXPENSE_VIEW' },
  { key: 'payments', label: 'Payments', icon: 'rupee', perm: 'PAYMENT_VIEW' },
];

function title(section: string, it: any) {
  switch (section) {
    case 'clients': return it.name || '';
    case 'cases': return it.caseTitle || it.caseNumber || '';
    case 'documents': return it.documentName || it.originalName || '';
    case 'invoices': return it.invoiceNumber || '';
    case 'payments': return `Payment #${it.id || ''}`;
    default: return it.title || '';
  }
}
function meta(section: string, it: any) {
  const amt = it.amount != null ? formatCurrency(it.amount) : '';
  switch (section) {
    case 'clients': return it.phone || it.email || '';
    case 'cases': return [it.caseNumber, it.status && titleCase(it.status)].filter(Boolean).join(' · ');
    case 'events': return [it.eventType && titleCase(it.eventType), it.date].filter(Boolean).join(' · ');
    case 'documents': return it.category || it.fileType || '';
    case 'invoices': return [it.status && titleCase(it.status), amt].filter(Boolean).join(' · ');
    case 'expenses': return [it.category, amt].filter(Boolean).join(' · ');
    case 'payments': return [it.paymentMode, amt, it.clientName].filter(Boolean).join(' · ');
    default: return '';
  }
}

type Row = { group: string; icon: IconName; label: string; meta?: string; mono?: boolean; run: () => void; recent?: string };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  can: (perm?: Perm) => boolean;
  onOpenRecord: (section: string, item: any) => void;
  onGo: (path: string) => void;
  onCreate: (a: typeof QUICK_CREATE[number]) => void;
};

export default function CommandPalette({ isOpen, onClose, can, onOpenRecord, onGo, onCreate }: Props) {
  const { query, results, loading, recentSearches, setQuery, addRecentSearch, clearRecentSearches, resetSearch } = useSearch() as any;
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    restoreRef.current = document.activeElement as HTMLElement;
    resetSearch();
    setSel(0);
    setTimeout(() => inputRef.current?.focus(), 30);
    return () => { restoreRef.current?.focus?.(); };
  }, [isOpen, resetSearch]);

  const q = query.trim().toLowerCase();
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (results && q) {
      for (const s of SECTIONS) {
        if (!can(s.perm)) continue;
        for (const it of results[s.key] || []) {
          const label = title(s.key, it);
          out.push({ group: s.label, icon: s.icon, label, meta: meta(s.key, it), mono: s.key === 'invoices', recent: label,
            run: () => onOpenRecord(s.key, it) });
        }
      }
    }
    const pages = NAV_ALL().filter((it) => can(it.perm) && (!q || it.label.toLowerCase().includes(q)));
    out.push(...pages.slice(0, q ? 6 : 5).map((it) => ({ group: 'Pages', icon: it.icon, label: it.label, run: () => onGo(it.path) })));
    const acts = QUICK_CREATE.filter((a) => can(a.perm) && (!q || a.command.toLowerCase().includes(q)));
    out.push(...acts.map((a) => ({ group: 'Actions', icon: a.icon, label: a.command, run: () => onCreate(a) })));
    return out;
  }, [results, q, can, onOpenRecord, onGo, onCreate]);

  useEffect(() => { setSel(0); }, [rows.length, q]);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  if (!isOpen) return null;

  const pick = (r?: Row) => {
    if (!r) return;
    if (r.recent && query.trim()) addRecentSearch(query.trim());
    onClose();
    r.run();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(i + 1, rows.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(rows[sel]); }
  };

  const searchable = SECTIONS.filter((s) => can(s.perm)).map((s) => s.label.toLowerCase());
  let lastGroup = '';

  return createPortal(
    <div className="overlay at-top" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Search and commands" onKeyDown={onKey}>
        <div className="palette-input">
          <Icon name="search" />
          <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" spellCheck={false}
            placeholder={`Search ${searchable.slice(0, 3).join(', ')}, or type a command`}
            role="combobox" aria-expanded="true" aria-controls="pal-list" aria-activedescendant={rows[sel] ? `pal-${sel}` : undefined} />
          {loading && <span className="pp-spin" aria-label="Searching" />}
        </div>
        <div className="palette-list" id="pal-list" role="listbox" ref={listRef}>
          {!q && recentSearches.length > 0 && (
            <>
              <div className="palette-group row between">
                <span>Recent searches</span>
                <button type="button" className="link xs" style={{ border: 0, background: 'none', padding: 0 }} onClick={clearRecentSearches}>Clear</button>
              </div>
              {recentSearches.slice(0, 5).map((t: string) => (
                <div key={t} className="palette-item" role="option" aria-selected="false" onMouseDown={(e) => { e.preventDefault(); setQuery(t); }}>
                  <Icon name="history" size="sm" /><span className="grow ellipsis">{t}</span>
                </div>
              ))}
            </>
          )}
          {q && !loading && results && rows.every((r) => r.group === 'Pages' || r.group === 'Actions') && (
            <EmptyState icon="search" title={`No records match “${query.trim()}”`} text="Search by case number, party or client name, invoice number or document name." />
          )}
          {rows.map((r, i) => {
            const head = r.group !== lastGroup ? <div className="palette-group">{r.group}</div> : null;
            lastGroup = r.group;
            return (
              <div key={`${r.group}-${i}`}>
                {head}
                <div id={`pal-${i}`} className="palette-item" role="option" aria-selected={i === sel}
                  onMouseEnter={() => setSel(i)} onMouseDown={(e) => { e.preventDefault(); pick(r); }}>
                  <Icon name={r.icon} size="sm" />
                  <span className={`grow ellipsis${r.mono ? ' mono' : ''}`}>{r.label}</span>
                  {r.meta && <span className="meta ellipsis" style={{ maxWidth: '45%' }}>{r.meta}</span>}
                  {!r.meta && <span className="meta" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
