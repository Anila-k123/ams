import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation } from 'react-router-dom';
import Icon from '../ui/Icon';
import { NAV, activeItem, groupOf, type NavItem, type NavGroup, type Perm, type CountKey } from './nav';

const OPEN_KEY = 'navOpen';

type Props = {
  can: (perm?: Perm) => boolean;
  counts: Partial<Record<CountKey, number>>;
  hot: CountKey[];
  rail: boolean;                     // icon-only rail (collapsed, or tablet width)
  firmName?: string;
  onNavigate: () => void;            // closes the mobile drawer
};

function Count({ n, hot }: { n?: number; hot?: boolean }) {
  if (!n) return null;
  return <span className={`count${hot ? ' hot' : ''}`}>{n > 99 ? '99+' : n}</span>;
}

export default function Sidebar({ can, counts, hot, rail, firmName, onNavigate }: Props) {
  const { pathname } = useLocation();
  const navRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState<string>(() => localStorage.getItem(OPEN_KEY) ?? 'court');
  const [flyout, setFlyout] = useState<{ group: NavGroup; top: number; left: number } | null>(null);

  const visible = (items: NavItem[]) => items.filter((it) => can(it.perm));
  const current = activeItem(pathname);
  const currentGroup = groupOf(current);

  // The group holding the current page always opens, so the active item is visible.
  useEffect(() => {
    if (currentGroup) { setOpen(currentGroup.id); localStorage.setItem(OPEN_KEY, currentGroup.id); }
  }, [currentGroup]);

  // Accordion: opening one group closes the others; clicking the open one closes it.
  const toggle = (id: string) => {
    const next = open === id ? '' : id;
    setOpen(next);
    localStorage.setItem(OPEN_KEY, next);
  };

  // Rail mode has no room to expand a group inline, so its pages show in a flyout.
  const showFlyout = useCallback((g: NavGroup, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setFlyout({ group: g, top: Math.max(8, Math.min(r.top - 6, window.innerHeight - 320)), left: r.right + 8 });
  }, []);
  useEffect(() => { setFlyout(null); }, [pathname, rail]);

  const link = (it: NavItem, inGroup = false) => (
    <NavLink key={it.path} to={it.path} end={it.end} title={it.label} onClick={onNavigate}
      className={() => (current === it ? 'active' : '')}
      aria-current={current === it ? 'page' : undefined} tabIndex={inGroup && open !== groupOf(it)?.id ? -1 : undefined}>
      <Icon name={it.icon} /><span>{it.label}</span>
      {it.countKey && <Count n={counts[it.countKey]} hot={hot.includes(it.countKey)} />}
    </NavLink>
  );

  // Up/Down arrows move between pinned links, group headers and the open group's links.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const els = Array.from(navRef.current?.querySelectorAll<HTMLElement>('.nav-pinned a, .nav-head, .nav-sec.open .nav-items a') ?? [])
      .filter((x) => x.offsetParent);
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length].focus();
  };

  const pinned = visible(NAV.pinned);
  const bottom = visible(NAV.bottom);

  return (
    <aside className="side" aria-label="Main navigation">
      <div className="brand">
        <span className="seal" aria-hidden="true">P</span>
        <div><b>PactPro</b>{firmName && <small className="ellipsis">{firmName}</small>}</div>
      </div>


      <nav className="nav" ref={navRef} aria-label="Sections" onKeyDown={onKeyDown}
        onMouseLeave={(e) => { if (!(e.relatedTarget as HTMLElement | null)?.closest?.('.nav-flyout')) setFlyout(null); }}>
        <div className="nav-group nav-pinned">
          <div className="nav-label">Workspace</div>
          {pinned.map((it) => link(it))}
        </div>
        <div className="nav-groups">
          {NAV.groups.map((g) => {
            const items = visible(g.items);
            if (!items.length) return null;
            const isOpen = open === g.id && !rail;
            const hasActive = currentGroup === g;
            // A closed group shows its urgent count on the header, so nothing urgent hides.
            const urgent = items.reduce((n, it) => n + (it.countKey && hot.includes(it.countKey) ? counts[it.countKey] || 0 : 0), 0);
            return (
              <div key={g.id} className={`nav-sec${isOpen ? ' open' : ''}${hasActive ? ' has-active' : ''}`} data-group={g.id}>
                <button type="button" className="nav-head" aria-expanded={isOpen} aria-controls={`ng-${g.id}`} title={g.label}
                  onClick={(e) => (rail ? showFlyout(g, e.currentTarget) : toggle(g.id))}
                  onMouseEnter={(e) => { if (rail) showFlyout(g, e.currentTarget); }}>
                  <Icon name={g.icon} /><span>{g.label}</span>
                  {urgent > 0 && <span className="count hot head-count">{urgent}</span>}
                  <Icon name="chevron" size="sm" className="chev" />
                </button>
                <div className="nav-items" id={`ng-${g.id}`} role="group" aria-label={g.label}>
                  <div className="nav-items-in">{items.map((it) => link(it, true))}</div>
                </div>
              </div>
            );
          })}
        </div>
      </nav>

      {bottom.length > 0 && <div className="nav nav-bottom">{bottom.map((it) => link(it))}</div>}


      {flyout && createPortal(
        <div className="popover menu nav-flyout" role="menu" aria-label={flyout.group.label}
          style={{ left: flyout.left, top: flyout.top }}
          onMouseLeave={(e) => { if (!(e.relatedTarget as HTMLElement | null)?.closest?.('.nav-head')) setFlyout(null); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setFlyout(null); }}>
          <div className="faint xs" style={{ padding: '6px 10px 4px' }}>{flyout.group.label}</div>
          {visible(flyout.group.items).map((it) => (
            <NavLink key={it.path} to={it.path} end={it.end} role="menuitem" onClick={() => { setFlyout(null); onNavigate(); }}>
              <Icon name={it.icon} size="sm" /><span>{it.label}</span>
              {it.countKey && counts[it.countKey] ? <span className="faint xs" style={{ marginLeft: 'auto' }}>{counts[it.countKey]}</span> : null}
            </NavLink>
          ))}
        </div>,
        document.body,
      )}
    </aside>
  );
}
