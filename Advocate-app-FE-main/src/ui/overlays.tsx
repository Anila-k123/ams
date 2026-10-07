// Red Tape overlays: Modal, Drawer and an imperative confirm().
// All render through a portal into <body>, close on Escape and backdrop click,
// keep Tab inside while open, and hand focus back to where it came from.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Shared behaviour: Escape, focus in/out, Tab trap, background scroll lock.
function useDialog(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const back = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => {
      const el = ref.current;
      if (!el || el.contains(document.activeElement)) return;
      const first = el.querySelector<HTMLElement>('[autofocus], [data-autofocus]') || el.querySelector<HTMLElement>(`.modal-body ${FOCUSABLE}, .drawer-body ${FOCUSABLE}`) || el.querySelector<HTMLElement>(FOCUSABLE);
      (first || el).focus();
    }, 20);
    const key = (e: KeyboardEvent) => {
      const el = ref.current;
      if (!el) return;
      // Only the top-most dialog reacts.
      const all = document.querySelectorAll('[data-rt-dialog]');
      if (all[all.length - 1] !== el) return;
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); }
      if (e.key === 'Tab') {
        const els = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((x) => x.offsetParent);
        if (!els.length) return;
        const i = els.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); els[els.length - 1].focus(); }
        else if (!e.shiftKey && i === els.length - 1) { e.preventDefault(); els[0].focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
      back?.focus?.();
    };
  }, [open, ref]);
}

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  size?: 'narrow' | 'wide' | 'xwide';
  footer?: ReactNode;
  children: ReactNode;
  dismissable?: boolean;   // backdrop click closes (default true)
};

export function Modal({ open, onClose, title, sub, size, footer, children, dismissable = true }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(open, onClose, ref);
  if (!open) return null;
  return createPortal(
    <div className="overlay" style={{ zIndex: 1000 }} onMouseDown={(e) => { if (dismissable && e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`modal${size ? ` ${size}` : ''}`} role="dialog" aria-modal="true" tabIndex={-1} data-rt-dialog>
        <div className="modal-head">
          <div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

type DrawerProps = { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; wide?: boolean; footer?: ReactNode; children: ReactNode };

export function Drawer({ open, onClose, title, sub, wide, footer, children }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  useDialog(open, onClose, ref);
  if (!open) return null;
  return createPortal(
    <div className="drawer-wrap" style={{ zIndex: 1000 }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={`drawer${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" tabIndex={-1} data-rt-dialog>
        <div className="drawer-head">
          <div style={{ minWidth: 0 }}><h2 style={{ fontSize: 'var(--t-xl)' }}>{title}</h2>{sub && <div className="row wrap" style={{ marginTop: 6 }}>{sub}</div>}</div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- confirm() ----------
   Imperative, like PrimeReact's confirmDialog, so call sites stay one line:
     confirm({ title: 'Delete this case?', message: '…', danger: true, confirmLabel: 'Delete', accept: () => … })
   <ConfirmHost /> is mounted once in main.jsx. */
export type ConfirmOptions = {
  title?: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  accept?: () => void | Promise<void>;
  reject?: () => void;
};

let pushConfirm: ((o: ConfirmOptions) => void) | null = null;

export function confirm(o: ConfirmOptions) {
  if (pushConfirm) pushConfirm(o);
  else if (window.confirm(typeof o.message === 'string' ? o.message : o.title || 'Are you sure?')) o.accept?.();
}

export function ConfirmHost() {
  const [cur, setCur] = useState<ConfirmOptions | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { pushConfirm = (o) => { setBusy(false); setCur(o); }; return () => { pushConfirm = null; }; }, []);
  const close = () => { if (busy) return; cur?.reject?.(); setCur(null); };
  const ok = async () => {
    if (!cur) return;
    try { setBusy(true); await cur.accept?.(); } finally { setBusy(false); setCur(null); }
  };
  return (
    <Modal open={!!cur} onClose={close} size="narrow" title={cur?.title || 'Are you sure?'}
      footer={<>
        <button type="button" className="btn ghost" onClick={close} disabled={busy}>{cur?.cancelLabel || 'Cancel'}</button>
        <button type="button" className={`btn ${cur?.danger ? 'danger solid' : 'primary'}${busy ? ' loading' : ''}`} onClick={ok} data-autofocus>
          {cur?.confirmLabel || 'Confirm'}
        </button>
      </>}>
      <div className="muted" style={{ fontSize: 'var(--t-md)' }}>{cur?.message}</div>
    </Modal>
  );
}
