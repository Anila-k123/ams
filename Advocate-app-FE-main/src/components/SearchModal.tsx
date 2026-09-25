import { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { Button } from 'primereact/button';
import { useLoading } from '../contexts/LoadingContext';
import { formatCurrency } from '../utils/formatCurrency';
import { apiUrl, authHeaders } from '../api/client';
import '../assets/styles/SearchModal.css';

const SECTIONS = ['clients', 'cases', 'documents', 'invoices', 'expenses', 'tasks', 'events'];

const SECTION_ICONS: Record<string, string> = {
  clients: 'pi-user',
  cases: 'pi-briefcase',
  documents: 'pi-file',
  invoices: 'pi-indian-rupee',
  expenses: 'pi-wallet',
  tasks: 'pi-check-square',
  events: 'pi-calendar',
};

function buildFlatList(results: any) {
  if (!results) return [];
  const flat: { section: string; item: any }[] = [];
  for (const section of SECTIONS) {
    const items = results[section];
    if (items && items.length > 0) for (const item of items) flat.push({ section, item });
  }
  return flat;
}

function getDisplayTitle(section: string, item: any) {
  switch (section) {
    case 'clients': return item.name;
    case 'cases': return item.caseTitle || item.caseNumber;
    case 'documents': return item.documentName || item.originalName;
    case 'invoices': return item.invoiceNumber;
    case 'expenses':
    case 'tasks':
    case 'events': return item.title;
    default: return '';
  }
}

function getDisplaySubtitle(section: string, item: any) {
  switch (section) {
    case 'clients': return item.email || item.phone;
    case 'cases': return `${item.caseNumber} - ${item.status || ''}`;
    case 'documents': return item.category || item.fileType || item.originalName;
    case 'invoices': return `${item.status} - ${formatCurrency(item.amount)}`;
    case 'expenses': return item.category ? `${item.category} - ${formatCurrency(item.amount)}` : formatCurrency(item.amount);
    case 'tasks': return item.completed ? 'Completed' : item.priority || '';
    case 'events': return item.eventType || '';
    default: return '';
  }
}

interface Props { isOpen: boolean; onClose: () => void; onNavigate: (section: string, item: any) => void }

export default function SearchModal({ isOpen, onClose, onNavigate }: Props) {
  const { withLoading } = useLoading() as any;
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<any>(null);
  const abortRef = useRef<AbortController | null>(null);

  const flatList = buildFlatList(results);
  const totalCount = flatList.length;

  const performSearch = useCallback(async (q: string) => {
    if (abortRef.current) abortRef.current.abort();
    if (!q.trim()) { setResults(null); setLoading(false); return; }
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    try {
      const res: Response = await withLoading(
        fetch(apiUrl(`/api/search?q=${encodeURIComponent(q.trim())}`), { headers: authHeaders(), signal: controller.signal }),
        'Searching...',
      );
      if (!res.ok) throw new Error('Search failed');
      setResults(await res.json());
      setSelectedIndex(0);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('[GlobalSearch] Error:', err);
        setResults(null);
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults(null); setLoading(false); return; }
    debounceRef.current = setTimeout(() => performSearch(query), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, performSearch]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults(null);
      setLoading(false);
      setSelectedIndex(0);
      setTimeout(() => { inputRef.current?.focus(); }, 50);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (!flatList.length) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, flatList.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const entry = flatList[selectedIndex];
        if (entry) onNavigate(entry.section, entry.item);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, flatList, selectedIndex, onNavigate, onClose]);

  useEffect(() => { if (isOpen) setSelectedIndex(0); }, [results, isOpen]);

  return (
    <Dialog visible={isOpen} onHide={onClose} showHeader={false} dismissableMask closeOnEscape={false} position="top"
      className="search-modal" style={{ width: '40rem' }} breakpoints={{ '640px': '95vw' }} contentClassName="p-0">
      <div className="search-modal-input flex align-items-center gap-2 p-3">
        <i className="pi pi-search search-modal-input-icon" />
        <InputText ref={inputRef} className="flex-1" placeholder="Search everything..." value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && <Button text rounded icon="pi pi-times" aria-label="Clear" className="search-modal-clear" onClick={() => setQuery('')} />}
      </div>

      <div className="search-modal-body">
        {loading && <div className="search-modal-status">Searching...</div>}
        {!loading && query.trim() && totalCount === 0 && <div className="search-modal-status">No matching records found.</div>}

        {!loading && results && (
          <div className="search-modal-results">
            {SECTIONS.map((section) => {
              const items = results[section];
              if (!items || items.length === 0) return null;
              return (
                <div key={section} className="search-section">
                  <div className="search-section-header"><i className={`pi ${SECTION_ICONS[section]}`} /> {section.toUpperCase()}</div>
                  {items.map((item: any, idx: number) => {
                    const globalIdx = flatList.findIndex((f) => f.section === section && f.item === item);
                    return (
                      <div key={item.id || idx}
                        className={`search-result-item ${globalIdx === selectedIndex ? 'selected' : ''}`}
                        onClick={() => onNavigate(section, item)}
                        onMouseEnter={() => setSelectedIndex(globalIdx)}>
                        <div className="search-result-icon"><i className={`pi ${SECTION_ICONS[section]}`} /></div>
                        <div className="search-result-text">
                          <div className="search-result-title">{getDisplayTitle(section, item)}</div>
                          <div className="search-result-subtitle">{getDisplaySubtitle(section, item)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {!query.trim() && !loading && (
          <div className="search-modal-hint">Start typing to search across clients, cases, documents, and more.</div>
        )}
      </div>

      <div className="search-modal-footer flex gap-3 p-2">
        <span>Navigate with <kbd>↑</kbd><kbd>↓</kbd></span>
        <span><kbd>Enter</kbd> to open</span>
        <span><kbd>Esc</kbd> to close</span>
      </div>
    </Dialog>
  );
}
