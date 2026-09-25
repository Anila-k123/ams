import { useState, useEffect, useRef, useMemo } from 'react';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { Button } from 'primereact/button';
import { ProgressSpinner } from 'primereact/progressspinner';
import { useSearch } from '../contexts/SearchContext';
import SearchResultCard from './SearchResultCard';
import '../assets/styles/SearchModal.css';

const SECTIONS = ['clients', 'cases', 'hearings', 'invoices', 'expenses', 'documents', 'payments'];

const SECTION_LABELS: Record<string, string> = {
  clients: 'Clients',
  cases: 'Cases',
  hearings: 'Hearings',
  invoices: 'Invoices',
  expenses: 'Expenses',
  documents: 'Documents',
  payments: 'Payments',
};

function buildFlatList(results: any) {
  if (!results) return [];
  const flat: { section: string; originalSection: string; item: any }[] = [];
  for (const section of SECTIONS) {
    const key = section === 'hearings' ? 'events' : section;
    const items = results[key];
    if (items && items.length > 0) for (const item of items) flat.push({ section: key, originalSection: section, item });
  }
  return flat;
}

function getResultTitle(section: string, item: any) {
  switch (section) {
    case 'clients': return item.name || '';
    case 'cases': return item.caseTitle || item.caseNumber || '';
    case 'hearings':
    case 'events': return item.title || '';
    case 'documents': return item.documentName || item.originalName || '';
    case 'invoices': return item.invoiceNumber || '';
    case 'expenses': return item.title || '';
    case 'payments': return `Payment #${item.id || ''}`;
    case 'tasks': return item.title || '';
    default: return '';
  }
}

interface Props { isOpen: boolean; onClose: () => void; onNavigate: (section: string, item: any) => void }

export default function GlobalSearchModal({ isOpen, onClose, onNavigate }: Props) {
  const { query, results, loading, selectedIndex, recentSearches, setQuery, setSelectedIndex, addRecentSearch, clearRecentSearches, resetSearch } = useSearch() as any;
  const [showRecent, setShowRecent] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const flatList = useMemo(() => buildFlatList(results), [results]);
  const totalCount = flatList.length;

  useEffect(() => {
    if (isOpen) {
      resetSearch();
      setShowRecent(true);
      setTimeout(() => { inputRef.current?.focus(); }, 50);
    }
  }, [isOpen, resetSearch]);

  useEffect(() => { setShowRecent(!query.trim()); }, [query]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const maxIndex = totalCount > 0 ? totalCount - 1 : 0;
        setSelectedIndex((prev: number) => Math.min(prev + 1, maxIndex));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev: number) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (totalCount > 0 && flatList[selectedIndex]) {
          const entry = flatList[selectedIndex];
          addRecentSearch(getResultTitle(entry.section, entry.item));
          onNavigate(entry.section, entry.item);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, flatList, selectedIndex, onNavigate, onClose, addRecentSearch, totalCount, setSelectedIndex]);

  useEffect(() => {
    if (results && !loading) setSelectedIndex(0);
  }, [results, loading, setSelectedIndex]);

  const handleResultClick = (section: string, item: any) => {
    addRecentSearch(getResultTitle(section, item));
    onNavigate(section, item);
  };

  return (
    <Dialog visible={isOpen} onHide={onClose} showHeader={false} dismissableMask closeOnEscape={false} position="top"
      className="global-search-modal" style={{ width: '40rem' }} breakpoints={{ '640px': '95vw' }} contentClassName="p-0">
      <div className="global-search-input flex align-items-center gap-2 p-3">
        <i className="pi pi-search global-search-input-icon" />
        <InputText ref={inputRef} className="flex-1" placeholder="Search clients, cases, documents, payments..."
          value={query} onChange={(e) => setQuery(e.target.value)} />
        {query && (
          <Button text rounded icon="pi pi-times" aria-label="Clear" className="global-search-clear"
            onClick={() => { setQuery(''); inputRef.current?.focus(); }} />
        )}
      </div>

      <div className="global-search-body">
        {loading && (
          <div className="global-search-loading flex align-items-center gap-2 p-3">
            <ProgressSpinner style={{ width: 20, height: 20 }} strokeWidth="6" />
            <span>Searching...</span>
          </div>
        )}

        {!loading && showRecent && !query.trim() && (
          <div className="global-search-recent">
            {recentSearches.length > 0 ? (
              <>
                <div className="global-search-section-label flex align-items-center gap-2">
                  <i className="pi pi-history gs-section-icon" />
                  <span className="flex-1">Recent Searches</span>
                  <Button text rounded size="small" icon="pi pi-trash" className="gs-clear-recent" onClick={clearRecentSearches} tooltip="Clear recent searches" />
                </div>
                <div className="gs-recent-list">
                  {recentSearches.map((term: string, idx: number) => (
                    <div key={idx} className="gs-recent-item" onClick={() => setQuery(term)}>
                      <i className="pi pi-history gs-recent-icon" />
                      <span>{term}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="global-search-hint">
                Start typing to search across clients, cases, hearings, documents, invoices, expenses, and payments.
              </div>
            )}
          </div>
        )}

        {!loading && !showRecent && query.trim() && totalCount === 0 && (
          <div className="global-search-empty">
            <div className="gs-empty-icon"><i className="pi pi-search" /></div>
            <div className="gs-empty-title">No results found</div>
            <div className="gs-empty-desc">Try different keywords or check your spelling.</div>
          </div>
        )}

        {!loading && results && totalCount > 0 && (
          <div className="global-search-results">
            {SECTIONS.map((section) => {
              const key = section === 'hearings' ? 'events' : section;
              const items = results[key];
              if (!items || items.length === 0) return null;
              return (
                <div key={section} className="gs-section">
                  <div className="global-search-section-label">{SECTION_LABELS[section]}</div>
                  {items.map((item: any, idx: number) => {
                    const globalIdx = flatList.findIndex((f) => f.section === key && f.item === item);
                    return (
                      <SearchResultCard
                        key={item.id || idx}
                        section={section}
                        item={item}
                        isSelected={globalIdx === selectedIndex}
                        onClick={() => handleResultClick(key, item)}
                        onMouseEnter={() => setSelectedIndex(globalIdx)}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="global-search-footer flex gap-3 p-2">
        <span className="gs-footer-nav"><kbd>&uarr;</kbd><kbd>&darr;</kbd> Navigate</span>
        <span className="gs-footer-nav"><kbd>&#9166;</kbd> Open</span>
        <span className="gs-footer-nav"><kbd>Esc</kbd> Close</span>
      </div>
    </Dialog>
  );
}
