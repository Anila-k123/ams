// Red Tape data table: sortable columns, client-side paging, row click, empty and
// loading states. For server-paged lists pass `page`/`total`/`onPage` instead.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { EmptyState, Skel } from './kit';
import type { IconName } from './Icon';

export type Column<T> = {
  key: string;
  label: ReactNode;
  render?: (row: T) => ReactNode;
  // true sorts by row[key]; a function returns the sort value
  sort?: boolean | ((row: T) => string | number | null | undefined);
  align?: 'right';
  hideSm?: boolean;
  width?: string | number;
  className?: string;
};

type Props<T> = {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  onRow?: (row: T) => void;
  rowClass?: (row: T) => string | undefined;
  pageSize?: number;                 // client paging; 0 shows all
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  empty?: { icon?: IconName; title: string; text?: ReactNode; action?: ReactNode };
  // server paging (0-based page)
  page?: number; total?: number; onPage?: (p: number) => void;
  caption?: string;
  flush?: boolean;                   // inside a .panel: no outer border
};

export function DataTable<T>({ rows, columns, rowKey, loading, onRow, rowClass, pageSize = 25, initialSort, empty, page: sPage, total, onPage, caption, flush }: Props<T>) {
  const [sort, setSort] = useState(initialSort);
  const [page, setPage] = useState(0);
  const server = onPage != null;

  const sorted = useMemo(() => {
    if (!sort || server) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col || !col.sort) return rows;
    const val = typeof col.sort === 'function' ? col.sort : (r: T) => (r as any)[col.key];
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en-IN', { numeric: true, sensitivity: 'base' });
      return sort.dir === 'asc' ? c : -c;
    });
  }, [rows, sort, columns, server]);

  // New data (a search or filter) returns to the first page.
  useEffect(() => { setPage(0); }, [rows.length]);

  const size = pageSize || sorted.length || 1;
  const count = server ? (total ?? rows.length) : sorted.length;
  const pages = Math.max(1, Math.ceil(count / size));
  const cur = server ? (sPage ?? 0) : Math.min(page, pages - 1);
  const shown = server || !pageSize ? sorted : sorted.slice(cur * size, cur * size + size);
  const go = (p: number) => (server ? onPage!(p) : setPage(p));

  const toggleSort = (c: Column<T>) => {
    if (!c.sort) return;
    setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }));
  };

  const pageButtons = () => {
    const out: (number | '…')[] = [];
    for (let i = 0; i < pages; i++) {
      if (i === 0 || i === pages - 1 || Math.abs(i - cur) <= 1) out.push(i);
      else if (out[out.length - 1] !== '…') out.push('…');
    }
    return out;
  };

  return (
    <div className="table-wrap" style={flush ? { border: 0, borderRadius: 0 } : undefined}>
      <table className="t">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" style={{ width: c.width, textAlign: c.align }}
                className={[c.sort ? 'sortable' : '', c.hideSm ? 'hide-sm' : '', c.className || ''].join(' ').trim() || undefined}
                aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                onClick={() => toggleSort(c)}
                onKeyDown={(e) => { if (c.sort && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleSort(c); } }}
                tabIndex={c.sort ? 0 : undefined}>
                {c.label}{c.sort && <span className="sort" aria-hidden="true">{sort?.key === c.key ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && !rows.length ? (
            [0, 1, 2, 3, 4].map((i) => (
              <tr key={i}>{columns.map((c) => <td key={c.key} className={c.hideSm ? 'hide-sm' : undefined}><Skel h={12} w={`${50 + ((i * 7 + c.key.length * 13) % 45)}%`} /></td>)}</tr>
            ))
          ) : shown.length === 0 ? (
            <tr><td colSpan={columns.length} style={{ padding: 0 }}>
              <EmptyState icon={empty?.icon || 'search'} title={empty?.title || 'Nothing here yet'} text={empty?.text} action={empty?.action} />
            </td></tr>
          ) : shown.map((r) => (
            <tr key={rowKey(r)} className={[onRow ? 'clickable' : '', rowClass?.(r) || ''].join(' ').trim() || undefined}
              onClick={onRow ? (e) => { if (!(e.target as HTMLElement).closest('a, button, input, select, label, textarea')) onRow(r); } : undefined}
              onKeyDown={onRow ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onRow(r); } : undefined}
              tabIndex={onRow ? 0 : undefined}>
              {columns.map((c) => (
                <td key={c.key} className={[c.hideSm ? 'hide-sm' : '', c.align === 'right' ? 'amt' : '', c.className || ''].join(' ').trim() || undefined}>
                  {c.render ? c.render(r) : String((r as any)[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {count > size && (
        <div className="t-foot">
          <span>{cur * size + 1}–{Math.min(count, cur * size + size)} of {count}</span>
          <div className="pager" role="navigation" aria-label="Pages">
            <button type="button" disabled={cur === 0} onClick={() => go(cur - 1)} aria-label="Previous page">‹</button>
            {pageButtons().map((p, i) => p === '…'
              ? <span key={`e${i}`} className="faint" style={{ padding: '0 4px', alignSelf: 'center' }}>…</span>
              : <button key={p} type="button" aria-current={p === cur} onClick={() => go(p)}>{p + 1}</button>)}
            <button type="button" disabled={cur >= pages - 1} onClick={() => go(cur + 1)} aria-label="Next page">›</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default DataTable;
