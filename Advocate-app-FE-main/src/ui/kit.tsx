// Red Tape building blocks. Thin wrappers over the classes in redtape.css, so
// pages stay readable and the markup matches the prototype exactly.
import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';
import Icon, { type IconName } from './Icon';

export { Icon };
export type { IconName };

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ---------- Status ---------- */
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'tape' | '';

// One mapping from backend status words to chip tones, used across pages.
export function toneFor(status?: string | null): Tone {
  const s = String(status || '').toUpperCase().replace(/[\s-]+/g, '_');
  if (['PAID', 'ACTIVE', 'COMPLETED', 'DONE', 'APPROVED', 'WON', 'DISPOSED_IN_FAVOUR', 'SENT', 'DELIVERED', 'SUCCESS', 'LOW', 'VERIFIED'].includes(s)) return 'ok';
  if (['PENDING', 'UNPAID', 'PARTIAL', 'PARTIALLY_PAID', 'MEDIUM', 'IN_PROGRESS', 'TO_REVIEW', 'SUBMITTED', 'DRAFT', 'SCHEDULED', 'OPEN', 'QUEUED', 'REVIEW'].includes(s)) return 'warn';
  if (['OVERDUE', 'HIGH', 'URGENT', 'CRITICAL', 'FAILED', 'REJECTED', 'LOST', 'ERROR', 'BOUNCED'].includes(s)) return 'bad';
  if (['NEW', 'UPCOMING', 'INFO', 'ADJOURNED'].includes(s)) return 'info';
  return '';
}

export const titleCase = (s?: string | null) =>
  String(s || '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

export function Chip({ tone = '', plain, children, title }: { tone?: Tone; plain?: boolean; children: ReactNode; title?: string }) {
  return <span className={cx('chip', tone, plain && 'plain')} title={title}>{children}</span>;
}

// A status word from the API, shown as a chip with the right tone and casing.
export function StatusChip({ status }: { status?: string | null }) {
  if (!status) return null;
  return <Chip tone={toneFor(status)}>{titleCase(status)}</Chip>;
}

export function Avatar({ name, src, size }: { name?: string | null; src?: string; size?: 'sm' | 'lg' }) {
  const initials = String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
  // Stable colour per name, from a muted palette that reads in both themes
  const palette = ['#4B5563', '#5B4B6B', '#3F5B54', '#6B5340', '#40536B', '#6B4048'];
  const hue = [...String(name || '')].reduce((n, ch) => n + ch.charCodeAt(0), 0) % palette.length;
  if (src) return <img className={cx('avatar', size)} src={src} alt="" style={{ objectFit: 'cover' }} />;
  return <span className={cx('avatar', size)} style={{ background: palette[hue] }} aria-hidden="true">{initials}</span>;
}

/* ---------- Buttons ---------- */
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'tape' | 'ghost' | 'danger' | 'danger-solid';
  size?: 'sm';
  icon?: IconName;
  iconOnly?: boolean;
  loading?: boolean;
};
export function Button({ variant, size, icon, iconOnly, loading, className, children, type = 'button', ...rest }: BtnProps) {
  return (
    <button type={type} {...rest}
      className={cx('btn', variant === 'danger-solid' ? 'danger solid' : variant, size, iconOnly && 'icon', loading && 'loading', className)}>
      {icon && <Icon name={icon} size="sm" />}{children}
    </button>
  );
}

/* ---------- Layout ---------- */
export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}

export function Panel({ title, sub, actions, flush, className, children }: { title?: ReactNode; sub?: ReactNode; actions?: ReactNode; flush?: boolean; className?: string; children?: ReactNode }) {
  return (
    <section className={cx('panel', className)}>
      {(title || actions) && (
        <div className="panel-head">
          <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>{title && <h3>{title}</h3>}{sub && <span className="sub">{sub}</span>}</div>
          {actions}
        </div>
      )}
      <div className={cx('panel-body', flush && 'flush')}>{children}</div>
    </section>
  );
}

export function EmptyState({ icon = 'info', title, text, action }: { icon?: IconName; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="art"><Icon name={icon} size="lg" /></div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Skel({ h = 14, w = '100%', style }: { h?: number | string; w?: number | string; style?: React.CSSProperties }) {
  return <div className="skel" style={{ height: h, width: w, ...style }} />;
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="row faint small" role="status"><span className="pp-spin" />{label}…</span>;
}

/* ---------- Popover menu ---------- */
export type MenuItem = { label: string; icon?: IconName; onClick: () => void; danger?: boolean; meta?: string } | '-';

// A menu anchored to a button; closes on outside click, Escape or a choice.
export function PopMenu({ anchor, items, onClose, width = 230, align = 'left' }: { anchor: HTMLElement | null; items: MenuItem[]; onClose: () => void; width?: number; align?: 'left' | 'right' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !anchor?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); anchor?.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const els = Array.from(ref.current?.querySelectorAll('button') ?? []);
        const i = els.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus();
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    ref.current?.querySelector('button')?.focus();
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [anchor, onClose]);
  if (!anchor) return null;
  const r = anchor.getBoundingClientRect();
  const left = align === 'right' ? Math.max(8, r.right - width) : Math.min(r.left, window.innerWidth - width - 8);
  const top = r.bottom + 6;
  return createPortal(
    <div ref={ref} className="popover menu" role="menu" style={{ left, top, width, maxHeight: `calc(100vh - ${top + 12}px)`, overflowY: 'auto' }}>
      {items.map((it, i) => it === '-'
        ? <div key={i} className="sep" />
        : (
          <button key={i} type="button" role="menuitem" className={cx(it.danger && 'danger')} onClick={() => { onClose(); it.onClick(); }}>
            {it.icon && <Icon name={it.icon} size="sm" />}<span className="grow">{it.label}</span>
          </button>
        ))}
    </div>,
    document.body,
  );
}
