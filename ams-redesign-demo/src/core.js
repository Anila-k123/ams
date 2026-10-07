/* ==========================================================================
   CORE: icons, formatting, components, router, shell, global overlays.
   Pages register themselves with page(path, def). See README section in
   DESIGN_SYSTEM.md for the page API.
   ========================================================================== */

/* ---------- Icons (inline SVG, 24px grid, 1.6 stroke) ---------- */
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  case: '<path d="M4 7h16v13H4z"/><path d="M9 7V4h6v3"/><path d="M4 12h16"/>',
  gavel: '<path d="m14 13-8.5 8.5a2.1 2.1 0 0 1-3-3L11 10"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  tasks: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 2 2 3-3M7 15h0M11 15h6M13 10h4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  board: '<rect x="3" y="4" width="18" height="13" rx="1.5"/><path d="M8 21h8M12 17v4"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17.5h.01"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
  rupee: '<path d="M6 4h12M6 9h12M14.5 4c3 0 3 9-2.5 9H7l8 7"/>',
  wallet: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19v3"/><path d="M3 7.5V18a2 2 0 0 0 2 2h15V8H5.5A2.5 2.5 0 0 1 3 5.5"/><circle cx="16.5" cy="14" r="1"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20"/>',
  scale: '<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3.5 3.5 0 0 0 6 0zM19 7l-3 7a3.5 3.5 0 0 0 6 0z"/>',
  dict: '<path d="M5 3h12a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2z"/><path d="M5 17a2 2 0 0 1 2-2h12M9 7h6"/>',
  swap: '<path d="M4 8h14l-4-4M20 16H6l4 4"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  template: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/>',
  send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M4 3h16"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v11h14V9M10 13h4"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  warn: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5h.01"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  sort: '<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  rows: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  kanban: '<rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.7 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3"/><path d="M4 4v4h4M20 20v-4h-4"/>',
  print: '<path d="M6 9V3h12v6M6 18H4v-7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7h-2"/><rect x="6" y="14" width="12" height="7"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  translate: '<path d="M4 5h9M8.5 3v2M6 5c0 4 3 7 6 8M11 5c-1 4-4 7-7 8M13 21l4-9 4 9M14.5 18h5"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
  note: '<path d="M5 3h14v12l-6 6H5z"/><path d="M13 21v-6h6M9 8h6M9 12h3"/>',
  live: '<circle cx="12" cy="12" r="3"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4"/>',
  cloud: '<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19.5 10 4 4 0 0 1 18 18z"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  minus: '<path d="M5 12h14"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
  zip: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M11 4v2M11 8v2M11 12v2"/>',
};
const I = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.info}</svg>`;

/* ---------- Formatting ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const inr = (n) => '₹' + inrFmt.format(Math.round(n || 0));
const inrShort = (n) => n >= 1e7 ? '₹' + (n / 1e7).toFixed(2) + ' Cr' : n >= 1e5 ? '₹' + (n / 1e5).toFixed(2) + ' L' : inr(n);
const fdate = (d, o = { day: 'numeric', month: 'short', year: 'numeric' }) => d ? new Date(d).toLocaleDateString('en-IN', o) : '—';
const fdateShort = (d) => fdate(d, { day: 'numeric', month: 'short' });
const ftime = (d) => d ? new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '';
const fdt = (d) => fdate(d) + ', ' + ftime(d);
const daysFrom = (d) => Math.round((new Date(d).setHours(0, 0, 0, 0) - TODAY) / 864e5);
const rel = (d) => {
  const n = daysFrom(d);
  if (n === 0) return 'Today'; if (n === 1) return 'Tomorrow'; if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return 'In ' + n + ' days'; if (n < -1 && n > -7) return -n + ' days ago';
  return fdate(d, { day: 'numeric', month: 'short' });
};
const ago = (d) => {
  const m = Math.round((Date.now() - new Date(d)) / 6e4);
  if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
  const h = Math.round(m / 60); if (h < 24) return h + ' h ago';
  return rel(d);
};
const initials = (name) => String(name).replace(/^(M\/s\.|Dr\.|Sri|Thiru\.|Tmt\.)\s*/i, '').split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const AV_COLORS = ['#3F5E7A', '#6A4C6B', '#4F6B4A', '#7A5A3A', '#47566E', '#6B4A4A', '#3D6766'];
const avatar = (name, cls = '') => { let h = 0; for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `<span class="avatar ${cls}" style="background:${AV_COLORS[h % AV_COLORS.length]}" aria-hidden="true">${esc(initials(name))}</span>`; };
const caseById = (id) => D.cases.find(c => c.id === +id);
const clientById = (id) => D.clients.find(c => c.id === +id);
const advById = (id) => D.advocates.find(a => a.id === +id);
const docIcon = (ext) => ({ pdf: 'file', docx: 'file', doc: 'file', jpg: 'image', png: 'image', zip: 'zip' }[ext] || 'file');
const sizeFmt = (kb) => kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB';
const isoDate = (d) => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const uid = (() => { let n = 0; return (p = 'u') => p + (++n); })();

/* ---------- Status vocabulary -> chip tone ----------
   Closed / Disposed are neutral (finished, not failed). Red is reserved for
   things that need action: overdue, failed, urgent. */
const TONE = {
  Active: 'ok', Pending: 'warn', Closed: '', Disposed: '', Reserved: 'info',
  Paid: 'ok', Unpaid: 'warn', Overdue: 'bad', Draft: '', Partial: 'warn',
  'In Progress': 'info', 'To review': 'warn', Completed: 'ok', Canceled: '',
  'Awaiting review': 'warn', Approved: 'ok', 'Changes requested': 'bad',
  High: 'bad', Medium: 'warn', Low: '',
  Sent: 'ok', Failed: 'bad', Success: 'ok', Ready: 'ok', Processing: 'warn', Generating: 'warn',
  New: 'tape', Confirmed: 'ok', Dismissed: '', Archived: '', Changed: 'warn', Repealed: 'bad',
};
const chip = (label, tone) => `<span class="chip ${tone ?? TONE[label] ?? ''}">${esc(label)}</span>`;
const tagHtml = (t) => `<span class="tag ${['High Priority', 'Urgent'].includes(t) ? 'hot' : ''}">${esc(t)}</span>`;

/* ---------- Session & permissions ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem('pp_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('pp_' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const session = { role: store.get('role', 'Senior Advocate'), authed: store.get('authed', false) };
const can = (perm) => !perm || (D.rolePerms[session.role] || []).includes(perm) || session.role === 'Super Admin';

/* ---------- Toasts ---------- */
function toast(msg, kind = 'ok', opts = {}) {
  let host = document.querySelector('.toasts');
  if (!host) { host = document.createElement('div'); host.className = 'toasts'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.innerHTML = `${I(kind === 'bad' ? 'warn' : kind === 'warn' ? 'alert' : kind === 'info' ? 'info' : 'ok')}<div class="grow">${msg}${opts.action ? ` <a class="link" style="color:inherit" href="${opts.action.href}">${esc(opts.action.label)}</a>` : ''}</div><button aria-label="Dismiss">${I('x', 'sm')}</button>`;
  const kill = () => { t.classList.add('out'); setTimeout(() => t.remove(), 240); };
  t.querySelector('button').onclick = kill;
  host.appendChild(t);
  setTimeout(kill, opts.ms || 4200);
}

/* ---------- Focus trap for overlays ---------- */
function trapFocus(container, onEsc) {
  const prev = document.activeElement;
  const sel = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';
  const handler = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onEsc(); }
    if (e.key !== 'Tab') return;
    const f = [...container.querySelectorAll(sel)].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  };
  container.addEventListener('keydown', handler);
  setTimeout(() => { const first = container.querySelector('[autofocus]') || container.querySelector('input,select,textarea') || container.querySelector(sel); first && first.focus(); }, 30);
  return () => { container.removeEventListener('keydown', handler); prev && prev.focus && prev.focus(); };
}

/* ---------- Modal ----------
   modal({ title, sub, body, foot, size: 'narrow'|'wide'|'xwide', onMount(el, close) })
   Footer buttons with data-close close the modal. Returns { el, close }. */
function modal({ title, sub = '', body = '', foot = '', size = '', onMount, onClose, top = false }) {
  const wrap = document.createElement('div');
  wrap.className = 'overlay' + (top ? ' top' : '');
  const id = uid('m');
  wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-labelledby="${id}">
    <div class="modal-head"><div><h2 id="${id}">${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button class="btn ghost icon" data-close aria-label="Close">${I('x')}</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  document.body.appendChild(wrap);
  let release;
  const close = () => { release && release(); wrap.remove(); onClose && onClose(); };
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  const el = wrap.querySelector('.modal');
  release = trapFocus(el, close);
  wireCommon(el);
  onMount && onMount(el, close);
  return { el, close };
}

/* ---------- Drawer (right side sheet) ---------- */
function drawer({ title, sub = '', body = '', foot = '', wide = false, onMount }) {
  const wrap = document.createElement('div');
  wrap.className = 'drawer-wrap';
  const id = uid('d');
  wrap.innerHTML = `<aside class="drawer ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${id}">
    <div class="drawer-head"><div class="grow"><h2 id="${id}" style="font-size:var(--t-xl)">${title}</h2>${sub ? `<div class="muted small" style="margin-top:4px">${sub}</div>` : ''}</div><button class="btn ghost icon" data-close aria-label="Close">${I('x')}</button></div>
    <div class="drawer-body">${body}</div>${foot ? `<div class="drawer-foot">${foot}</div>` : ''}</aside>`;
  document.body.appendChild(wrap);
  let release;
  const close = () => { release && release(); wrap.remove(); };
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
  const el = wrap.querySelector('.drawer');
  release = trapFocus(el, close);
  wireCommon(el);
  onMount && onMount(el, close);
  return { el, close };
}

/* ---------- Confirm ---------- */
function confirmDialog({ title, text, confirm = 'Confirm', danger = false, typeToConfirm, onConfirm }) {
  modal({
    title, size: 'narrow',
    body: `<p class="muted">${text}</p>${typeToConfirm ? `<div class="field" style="margin-top:16px"><label for="ttc">Type <b class="mono">${typeToConfirm}</b> to continue</label><input id="ttc" class="input mono" autocomplete="off"></div>` : ''}`,
    foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? 'danger solid' : 'primary'}" id="cfm" ${typeToConfirm ? 'disabled' : ''}>${confirm}</button>`,
    onMount(el, close) {
      const b = el.querySelector('#cfm');
      if (typeToConfirm) el.querySelector('#ttc').addEventListener('input', e => { b.disabled = e.target.value !== typeToConfirm; });
      b.onclick = () => { close(); onConfirm && onConfirm(); };
    },
  });
}

/* ---------- Popover menu ----------
   popMenu(anchorEl, [{ label, icon, onClick, danger }, '-' ...]) */
function popMenu(anchor, items, { align = 'right', width } = {}) {
  closePopovers();
  const p = document.createElement('div');
  p.className = 'popover menu';
  p.setAttribute('role', 'menu');
  if (width) p.style.width = width + 'px';
  p.innerHTML = items.map((it, i) => it === '-' ? '<div class="sep"></div>' : it.html ? it.html : `<button role="menuitem" data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon ? I(it.icon, 'sm') : ''}<span>${it.label}</span>${it.meta ? `<span class="faint xs" style="margin-left:auto">${it.meta}</span>` : ''}</button>`).join('');
  document.body.appendChild(p);
  placePopover(p, anchor, align);
  p.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (!b) return; const it = items[+b.dataset.i]; closePopovers(); it.onClick && it.onClick(); });
  p.addEventListener('keydown', e => {
    const btns = [...p.querySelectorAll('button')]; const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
    if (e.key === 'Escape') { closePopovers(); anchor.focus(); }
  });
  setTimeout(() => { const f = p.querySelector('button'); f && f.focus(); }, 10);
  return p;
}
function placePopover(p, anchor, align = 'right') {
  const r = anchor.getBoundingClientRect(); const pw = p.offsetWidth; const ph = p.offsetHeight;
  let left = align === 'right' ? r.right - pw : r.left;
  left = Math.max(8, Math.min(left, innerWidth - pw - 8));
  let top = r.bottom + 6; if (top + ph > innerHeight - 8) top = Math.max(8, r.top - ph - 6);
  p.style.left = left + 'px'; p.style.top = top + 'px';
}
function closePopovers() { document.querySelectorAll('.popover').forEach(p => p.remove()); }
document.addEventListener('mousedown', e => { if (!e.target.closest('.popover') && !e.target.closest('[data-pop]')) closePopovers(); });

/* ---------- Empty state & skeletons ---------- */
const emptyState = ({ icon = 'search', title, text = '', action = '' }) => `<div class="empty"><div class="art">${I(icon, 'lg')}</div><h3>${title}</h3>${text ? `<p>${text}</p>` : ''}${action ? `<div style="margin-top:8px">${action}</div>` : ''}</div>`;
const skel = (w = '100%', h = 14, r) => `<div class="skel" style="width:${w};height:${h}px${r ? ';border-radius:' + r : ''}"></div>`;
const SKELETONS = {
  table: () => `<div class="page-head"><div class="stack" style="gap:10px">${skel('220px', 28)}${skel('360px', 14)}</div></div><div class="row" style="gap:8px;margin-bottom:16px">${skel('320px', 36)}${skel('140px', 36)}${skel('140px', 36)}</div><div class="table-wrap"><div style="padding:14px" class="stack">${Array.from({ length: 8 }, () => `<div class="row" style="gap:18px">${skel('22%', 14)}${skel('30%', 14)}${skel('14%', 14)}${skel('12%', 14)}${skel('10%', 14)}</div>`).join('')}</div></div>`,
  dashboard: () => `<div class="stack" style="gap:10px;margin-bottom:24px">${skel('300px', 30)}${skel('420px', 14)}</div><div class="grid g-4" style="margin-bottom:20px">${Array.from({ length: 4 }, () => skel('100%', 96, '12px')).join('')}</div><div class="split"><div class="stack">${skel('100%', 320, '12px')}${skel('100%', 220, '12px')}</div><div class="stack">${skel('100%', 260, '12px')}${skel('100%', 260, '12px')}</div></div>`,
  detail: () => `${skel('100%', 170, '12px')}<div class="row" style="gap:16px;margin:24px 0 20px">${Array.from({ length: 7 }, () => skel('80px', 14)).join('')}</div><div class="split"><div class="stack">${skel('100%', 260, '12px')}${skel('100%', 180, '12px')}</div>${skel('100%', 360, '12px')}</div>`,
  cards: () => `<div class="stack" style="gap:10px;margin-bottom:24px">${skel('240px', 28)}${skel('380px', 14)}</div><div class="doc-grid">${Array.from({ length: 8 }, () => skel('100%', 190, '12px')).join('')}</div>`,
};

/* ---------- Tabs: [data-tabs] > button[data-tab] + [data-panel] siblings ---------- */
function wireTabs(root) {
  root.querySelectorAll('[data-tabs]:not([data-wired])').forEach(tl => {
    tl.dataset.wired = '1';
    tl.setAttribute('role', 'tablist');
    const scope = tl.closest('[data-tab-scope]') || tl.parentElement;
    const btns = [...tl.querySelectorAll('[data-tab]')];
    const show = (name, focus) => {
      btns.forEach(b => { const on = b.dataset.tab === name; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
      scope.querySelectorAll(':scope [data-panel]').forEach(p => { if (p.closest('[data-tab-scope]') !== tl.closest('[data-tab-scope]')) return; p.hidden = p.dataset.panel !== name; });
      tl.dispatchEvent(new CustomEvent('tabchange', { detail: name }));
    };
    btns.forEach((b, i) => {
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => show(b.dataset.tab));
      b.addEventListener('keydown', e => {
        if (e.key === 'ArrowRight') show(btns[(i + 1) % btns.length].dataset.tab, true);
        if (e.key === 'ArrowLeft') show(btns[(i - 1 + btns.length) % btns.length].dataset.tab, true);
      });
    });
    show((btns.find(b => b.getAttribute('aria-selected') === 'true') || btns[0]).dataset.tab);
  });
}
/* Segmented controls: .seg[data-seg] > button[data-v]; dispatches 'segchange' */
function wireSegs(root) {
  root.querySelectorAll('.seg[data-seg]:not([data-wired])').forEach(s => {
    s.dataset.wired = '1';
    s.addEventListener('click', e => {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      s.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
      s.dispatchEvent(new CustomEvent('segchange', { detail: b.dataset.v, bubbles: true }));
    });
  });
}
function wireCommon(root) { wireTabs(root); wireSegs(root); }

/* ---------- Form validation ----------
   Inputs inside .field; add `required`, data-rule="email|phone|gstin|pincode|min:N".
   Error text comes from .err inside the field. Returns true when valid. */
function validateForm(form) {
  let ok = true; let first;
  form.querySelectorAll('.field').forEach(f => {
    const inp = f.querySelector('input,select,textarea'); if (!inp) return;
    const v = (inp.value || '').trim(); const rule = inp.dataset.rule || '';
    let bad = false;
    if (inp.required && !v) bad = true;
    else if (v && rule === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) bad = true;
    else if (v && rule === 'phone' && v.replace(/\D/g, '').length < 10) bad = true;
    else if (v && rule === 'gstin' && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i.test(v)) bad = true;
    else if (v && rule === 'pincode' && !/^\d{6}$/.test(v)) bad = true;
    else if (v && rule.startsWith('min:') && v.length < +rule.slice(4)) bad = true;
    f.classList.toggle('invalid', bad);
    f.classList.toggle('valid', !bad && !!v && !!rule);
    inp.setAttribute('aria-invalid', bad);
    if (bad) { ok = false; first = first || inp; }
  });
  first && first.focus();
  return ok;
}
/* field(): label + control + hint + error, used by every form */
function field({ id, label, type = 'text', value = '', placeholder = '', required = false, rule = '', hint = '', err = '', options, full = false, rows, attrs = '' }) {
  id = id || uid('f');
  let ctl;
  if (options) ctl = `<select id="${id}" class="input" ${required ? 'required' : ''} ${attrs}>${placeholder ? `<option value="">${esc(placeholder)}</option>` : ''}${options.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select>`;
  else if (type === 'textarea') ctl = `<textarea id="${id}" class="input" rows="${rows || 3}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''} ${attrs}>${esc(value)}</textarea>`;
  else ctl = `<input id="${id}" type="${type}" class="input ${type === 'number' ? 'num' : ''}" value="${esc(value)}" placeholder="${esc(placeholder)}" ${required ? 'required' : ''} ${rule ? `data-rule="${rule}"` : ''} ${attrs}>`;
  return `<div class="field ${full ? 'full' : ''}"><label for="${id}">${label}${required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>${ctl}${hint ? `<span class="hint">${hint}</span>` : ''}<span class="err" role="alert">${I('warn', 'sm')}${err || (required ? 'This field is required.' : 'Check this value.')}</span></div>`;
}
/* Fake async: shows button spinner then runs fn */
function busy(btn, fn, ms = 700) { btn.classList.add('loading'); setTimeout(() => { btn.classList.remove('loading'); fn(); }, ms); }

/* ---------- DataTable ----------
   DataTable(el, { columns:[{ key, label, sort?:true|fn, render?(row), cls?, hideSm? }],
     rows | rowsFn(), search?:{ placeholder, keys:[] }, filters?:[{ key, label, options, test?(row,v) }],
     toolbarExtra?: html, pageSize?: 10, onRow?(row), rowClass?(row), empty?: { icon,title,text,action },
     initialSort?: { key, dir } })
   Returns { refresh(), state }. */
function DataTable(el, cfg) {
  const st = { q: '', f: {}, sort: cfg.initialSort || null, page: 1 };
  const pageSize = cfg.pageSize || 10;
  const sid = uid('tbl');
  el.innerHTML = `${cfg.search || cfg.filters || cfg.toolbarExtra ? `<div class="toolbar">
      ${cfg.search ? `<div class="input-icon">${I('search', 'sm')}<input class="input" id="${sid}-q" type="search" placeholder="${esc(cfg.search.placeholder)}" aria-label="${esc(cfg.search.placeholder)}" value="${esc(cfg.search.initial || '')}"></div>` : ''}
      ${(cfg.filters || []).map((f, i) => `<select class="input" data-fi="${i}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}: All</option>${f.options.map(o => `<option>${esc(o)}</option>`).join('')}</select>`).join('')}
      <button class="btn ghost sm" data-clear hidden>${I('x', 'sm')}Clear</button>
      <span class="grow"></span>${cfg.toolbarExtra || ''}</div>` : ''}
    <div class="table-wrap"><table class="t"><thead><tr>${cfg.columns.map(c => `<th scope="col" class="${c.sort ? 'sortable' : ''} ${c.cls || ''} ${c.hideSm ? 'hide-sm' : ''}" data-k="${c.key}" ${c.sort ? 'tabindex="0"' : ''}>${c.label}${c.sort ? '<span class="sort">↕</span>' : ''}</th>`).join('')}</tr></thead><tbody></tbody></table></div>
    <div class="t-foot"><span class="t-count"></span><div class="pager"></div></div>`;
  if (cfg.search && cfg.search.initial) st.q = cfg.search.initial.toLowerCase();
  const tbody = el.querySelector('tbody');
  const render = () => {
    let rows = (cfg.rowsFn ? cfg.rowsFn() : cfg.rows).slice();
    if (st.q) rows = rows.filter(r => (cfg.search.keys.map(k => typeof k === 'function' ? k(r) : r[k]).join(' ')).toLowerCase().includes(st.q));
    (cfg.filters || []).forEach((f, i) => { const v = st.f[i]; if (v) rows = rows.filter(r => f.test ? f.test(r, v) : String(r[f.key]) === v); });
    if (st.sort) {
      const col = cfg.columns.find(c => c.key === st.sort.key);
      const get = typeof col.sort === 'function' ? col.sort : (r) => r[col.key];
      rows.sort((a, b) => { const x = get(a), y = get(b); const r = x instanceof Date || typeof x === 'number' ? (x - y) : String(x ?? '').localeCompare(String(y ?? ''), 'en', { numeric: true }); return st.sort.dir === 'asc' ? r : -r; });
    }
    const total = rows.length; const pages = Math.max(1, Math.ceil(total / pageSize));
    st.page = Math.min(st.page, pages);
    const slice = rows.slice((st.page - 1) * pageSize, st.page * pageSize);
    tbody.innerHTML = slice.length ? slice.map((r, i) => `<tr data-ri="${i}" class="${cfg.onRow ? 'clickable' : ''} ${cfg.rowClass ? cfg.rowClass(r) : ''}">${cfg.columns.map(c => `<td class="${c.cls || ''} ${c.hideSm ? 'hide-sm' : ''}">${c.render ? c.render(r) : esc(r[c.key])}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${cfg.columns.length}">${emptyState(st.q || Object.values(st.f).some(Boolean) ? { icon: 'search', title: 'No matches', text: 'Nothing matches these filters. Clear them to see everything.', action: '<button class="btn sm" data-clear2>Clear filters</button>' } : (cfg.empty || { title: 'Nothing here yet' }))}</td></tr>`;
    tbody._rows = slice;
    el.querySelector('.t-count').textContent = total ? `Showing ${(st.page - 1) * pageSize + 1}–${Math.min(st.page * pageSize, total)} of ${total}` : '0 results';
    const pg = el.querySelector('.pager');
    pg.innerHTML = pages > 1 ? `<button data-p="${st.page - 1}" ${st.page === 1 ? 'disabled' : ''} aria-label="Previous page">${I('chevronLeft', 'sm')}</button>${Array.from({ length: pages }, (_, i) => `<button data-p="${i + 1}" aria-current="${i + 1 === st.page}">${i + 1}</button>`).join('')}<button data-p="${st.page + 1}" ${st.page === pages ? 'disabled' : ''} aria-label="Next page">${I('chevron', 'sm')}</button>` : '';
    el.querySelectorAll('th[data-k]').forEach(th => { if (st.sort && th.dataset.k === st.sort.key) th.setAttribute('aria-sort', st.sort.dir === 'asc' ? 'ascending' : 'descending'); else th.removeAttribute('aria-sort'); const s = th.querySelector('.sort'); if (s) s.textContent = st.sort && th.dataset.k === st.sort.key ? (st.sort.dir === 'asc' ? '↑' : '↓') : '↕'; });
    const clr = el.querySelector('[data-clear]'); if (clr) clr.hidden = !(st.q || Object.values(st.f).some(Boolean));
    cfg.afterRender && cfg.afterRender(el, rows);
  };
  const clearAll = () => { st.q = ''; st.f = {}; const q = el.querySelector(`#${sid}-q`); if (q) q.value = ''; el.querySelectorAll('[data-fi]').forEach(s => s.value = ''); st.page = 1; render(); };
  const q = el.querySelector(`#${sid}-q`);
  q && q.addEventListener('input', e => { st.q = e.target.value.trim().toLowerCase(); st.page = 1; render(); });
  el.querySelectorAll('[data-fi]').forEach(s => s.addEventListener('change', e => { st.f[+s.dataset.fi] = e.target.value; st.page = 1; render(); }));
  el.addEventListener('click', e => {
    if (e.target.closest('[data-clear],[data-clear2]')) return clearAll();
    const p = e.target.closest('[data-p]'); if (p) { st.page = +p.dataset.p; render(); return; }
    const th = e.target.closest('th.sortable'); if (th) return sortBy(th.dataset.k);
    const tr = e.target.closest('tbody tr[data-ri]');
    if (tr && cfg.onRow && !e.target.closest('button,a,input,select,label')) cfg.onRow(tbody._rows[+tr.dataset.ri]);
  });
  el.addEventListener('keydown', e => { const th = e.target.closest('th.sortable'); if (th && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); sortBy(th.dataset.k); } });
  const sortBy = (k) => { st.sort = st.sort && st.sort.key === k ? { key: k, dir: st.sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }; render(); };
  render();
  return { refresh: render, state: st, el };
}

/* ---------- Tiny SVG charts (no library; themed via tokens) ---------- */
const SERIES = ['var(--ink)', 'var(--tape)', 'var(--info)', 'var(--ok)', 'var(--warn)', 'var(--mute)'];
function barChart({ labels, series, height = 220, money = false, stacked = false }) {
  const W = 640, H = height, pl = 52, pr = 8, pt = 10, pb = 28;
  const totals = labels.map((_, i) => stacked ? series.reduce((s, x) => s + x.data[i], 0) : Math.max(...series.map(x => x.data[i])));
  const max = niceMax(Math.max(...totals, 1)); const iw = W - pl - pr, ih = H - pt - pb;
  const bw = iw / labels.length; const gw = Math.min(42, bw * .62); const each = stacked ? gw : gw / series.length;
  const fmt = (v) => money ? (v >= 1e5 ? (v / 1e5).toFixed(v % 1e5 ? 1 : 0) + 'L' : v >= 1e3 ? (v / 1e3) + 'k' : v) : v;
  let g = '';
  for (let t = 0; t <= 4; t++) { const v = max * t / 4; const y = pt + ih - ih * t / 4; g += `<line class="grid-l" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/><text x="${pl - 8}" y="${y + 4}" text-anchor="end">${fmt(v)}</text>`; }
  labels.forEach((l, i) => {
    const x0 = pl + bw * i + (bw - gw) / 2; let acc = 0;
    series.forEach((s, j) => {
      const v = s.data[i]; const h = ih * v / max;
      const x = stacked ? x0 : x0 + each * j; const y = stacked ? pt + ih - ih * (acc + v) / max : pt + ih - h;
      g += `<rect x="${x}" y="${y}" width="${Math.max(each - (stacked ? 0 : 2), 2)}" height="${Math.max(h, 0)}" rx="2" fill="${s.color || SERIES[j]}"><title>${esc(l)}: ${esc(s.name)} ${money ? inr(v) : v}</title></rect>`;
      acc += v;
    });
    g += `<text x="${pl + bw * i + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Bar chart">${g}</svg>`;
}
function lineChart({ labels, series, height = 220, money = false }) {
  const W = 640, H = height, pl = 52, pr = 12, pt = 10, pb = 28;
  const max = niceMax(Math.max(...series.flatMap(s => s.data), 1)); const iw = W - pl - pr, ih = H - pt - pb;
  const X = (i) => pl + iw * i / (labels.length - 1); const Y = (v) => pt + ih - ih * v / max;
  const fmt = (v) => money ? (v >= 1e5 ? (v / 1e5).toFixed(1) + 'L' : v >= 1e3 ? Math.round(v / 1e3) + 'k' : v) : v;
  let g = '';
  for (let t = 0; t <= 4; t++) { const v = max * t / 4; const y = Y(v); g += `<line class="grid-l" x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}"/><text x="${pl - 8}" y="${y + 4}" text-anchor="end">${fmt(v)}</text>`; }
  labels.forEach((l, i) => { g += `<text x="${X(i)}" y="${H - 8}" text-anchor="middle">${esc(l)}</text>`; });
  series.forEach((s, j) => {
    const c = s.color || SERIES[j]; const pts = s.data.map((v, i) => `${X(i)},${Y(v)}`).join(' ');
    if (j === 0) g += `<polygon points="${X(0)},${Y(0) + (ih - (Y(0) - pt)) * 0 + 0} ${pts} ${X(s.data.length - 1)},${pt + ih} ${X(0)},${pt + ih}" fill="${c}" opacity=".07"/>`;
    g += `<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" ${s.dash ? 'stroke-dasharray="4 4"' : ''}/>`;
    const li = s.data.length - 1; g += `<circle cx="${X(li)}" cy="${Y(s.data[li])}" r="3.5" fill="${c}"/>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Line chart">${g}</svg>`;
}
function donut({ parts, size = 160, label = '', sub = '' }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1; const r = 60, c = 2 * Math.PI * r; let off = 0;
  const arcs = parts.map((p, i) => { const len = c * p.value / total; const a = `<circle cx="80" cy="80" r="${r}" fill="none" stroke="${p.color || SERIES[i]}" stroke-width="18" stroke-dasharray="${Math.max(len - 2, 0)} ${c}" stroke-dashoffset="${-off}" transform="rotate(-90 80 80)"><title>${esc(p.label)}: ${p.value}</title></circle>`; off += len; return a; }).join('');
  return `<svg class="chart" viewBox="0 0 160 160" width="${size}" height="${size}" role="img" aria-label="${esc(label)}"><circle cx="80" cy="80" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="18"/>${arcs}<text x="80" y="80" text-anchor="middle" style="font:500 28px var(--f-display);fill:var(--ink)">${esc(label)}</text><text x="80" y="100" text-anchor="middle">${esc(sub)}</text></svg>`;
}
const legend = (items) => `<div class="legend">${items.map((it, i) => `<span><i style="background:${it.color || SERIES[i]}"></i>${esc(it.label)}${it.value != null ? ` <b class="num" style="color:var(--ink)">${it.value}</b>` : ''}</span>`).join('')}</div>`;
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }

/* ==========================================================================
   NAVIGATION MODEL
   ========================================================================== */
/* Sidebar model.
   pinned: daily-use items, always visible.  groups: collapsible, one open at a time
   (accordion); the group holding the current page opens itself; the open group is
   remembered.  bottom: pinned under the groups, next to the profile. */
const NAV = {
  pinned: [
    { path: '/', label: 'Today', icon: 'home' },
    { path: '/cases', label: 'Cases', icon: 'case', perm: 'CASE_VIEW', count: () => D.cases.filter(c => c.status !== 'Closed').length },
    { path: '/hearings', label: 'Hearings & events', icon: 'calendar', perm: 'EVENT_VIEW' },
    { path: '/tasks', label: 'Tasks', icon: 'tasks', perm: 'TASK_VIEW', count: () => D.tasks.filter(t => t.status === 'To review').length, hot: true },
  ],
  groups: [
    { id: 'court', label: 'Court', icon: 'gavel', items: [
      { path: '/causelist', label: 'Daily causelist', icon: 'list', perm: 'CASE_VIEW' },
      { path: '/display-board', label: 'Display board', icon: 'board', perm: 'CASE_VIEW' },
      { path: '/appeals', label: 'Appeal alert', icon: 'alert', perm: 'CASE_EDIT', count: () => D.appeals.filter(a => a.status === 'New').length, hot: true },
    ] },
    { id: 'clients', label: 'Clients & documents', icon: 'users', items: [
      { path: '/clients', label: 'Clients', icon: 'users', perm: 'CLIENT_VIEW' },
      { path: '/documents', label: 'Documents', icon: 'folder', perm: 'DOCUMENT_VIEW' },
    ] },
    { id: 'billing', label: 'Billing', icon: 'rupee', items: [
      { path: '/invoices', label: 'Invoices', icon: 'receipt', perm: 'INVOICE_VIEW', count: () => D.invoices.filter(i => i.status === 'Overdue').length, hot: true },
      { path: '/payments', label: 'Payments', icon: 'rupee', perm: 'PAYMENT_VIEW' },
      { path: '/expenses', label: 'Expenses', icon: 'wallet', perm: 'EXPENSE_VIEW' },
      { path: '/reports', label: 'Reports', icon: 'chart', perm: 'REPORT_VIEW' },
    ] },
    { id: 'drafting', label: 'Drafting', icon: 'pen', items: [
      { path: '/drafting', label: 'Drafts', icon: 'pen', perm: 'DRAFT_VIEW' },
      { path: '/drafting/templates', label: 'Templates', icon: 'template', perm: 'DRAFT_VIEW' },
      { path: '/drafting/playbooks', label: 'Playbooks', icon: 'shield', perm: 'DRAFT_VIEW' },
    ] },
    { id: 'library', label: 'Library', icon: 'book', items: [
      { path: '/acts', label: 'Acts', icon: 'book', perm: 'CASE_VIEW' },
      { path: '/law-codes', label: 'Law codes', icon: 'swap', perm: 'CASE_VIEW' },
      { path: '/dictionary', label: 'Legal dictionary', icon: 'dict', perm: 'CASE_VIEW' },
    ] },
    { id: 'firm', label: 'Firm', icon: 'key', items: [
      { path: '/notifications', label: 'Notifications', icon: 'bell', perm: 'SETTINGS_EDIT' },
      { path: '/communication', label: 'Communication', icon: 'send', perm: 'SETTINGS_EDIT' },
      { path: '/users', label: 'Users', icon: 'user', perm: 'USER_MANAGE' },
      { path: '/roles', label: 'Roles', icon: 'key', perm: 'ROLE_MANAGE' },
      { path: '/activity', label: 'System activity', icon: 'history', perm: 'AUDIT_VIEW' },
      { path: '/backup', label: 'Backup', icon: 'database', perm: 'BACKUP_MANAGE' },
    ] },
  ],
  bottom: [
    { path: '/settings', label: 'Settings', icon: 'cog' },
  ],
};
const NAV_ALL = () => [...NAV.pinned, ...NAV.groups.flatMap(g => g.items), ...NAV.bottom];

/* ==========================================================================
   ROUTER
   page(path, { title, crumbs?: [[label, href]...], perm?, skeleton?: 'table'|'dashboard'|'detail'|'cards',
                bare?: true (no shell; auth & portal), render(params) -> html, mount?(root, params) })
   ========================================================================== */
const PAGES = [];
function page(path, def) {
  const keys = []; const re = new RegExp('^' + path.replace(/:[a-zA-Z]+/g, m => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$');
  PAGES.push({ path, re, keys, ...def });
}
const go = (hash) => { location.hash = hash.startsWith('#') ? hash : '#' + hash; };
const currentPath = () => (location.hash.replace(/^#/, '') || '/').split('?')[0];
const query = () => new URLSearchParams((location.hash.split('?')[1]) || '');
let mountedPath = null; let navTimer;

function resolve(path) {
  // Specific routes win over parameterised ones (e.g. /drafting/new before /drafting/:id)
  const ordered = PAGES.slice().sort((a, b) => a.keys.length - b.keys.length);
  for (const p of ordered) { const m = path.match(p.re); if (m) return { p, params: Object.fromEntries(p.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) }; }
  return null;
}

function router() {
  closePopovers();
  const path = currentPath();
  const hit = resolve(path);
  const isPublic = hit && hit.p.public;
  if (!session.authed && !isPublic) { go('/login'); return; }
  if (!hit) return renderInShell({ title: 'Page not found', render: () => notFound() }, {}, path);
  if (hit.p.bare) { document.querySelector('#app').innerHTML = hit.p.render(hit.params); window.scrollTo(0, 0); hit.p.mount && hit.p.mount(document.querySelector('#app'), hit.params); wireCommon(document.querySelector('#app')); document.title = (hit.p.title ? hit.p.title + ' · ' : '') + 'PactPro'; mountedPath = path; return; }
  if (hit.p.perm && !can(hit.p.perm)) return renderInShell({ title: 'No access', render: () => forbidden(hit.p) }, {}, path);
  renderInShell(hit.p, hit.params, path);
}

function renderInShell(p, params, path) {
  if (!document.querySelector('.app')) buildShell();
  const content = document.querySelector('#content');
  const title = typeof p.title === 'function' ? p.title(params) : p.title;
  document.title = title + ' · PactPro';
  setCrumbs(p, params, title);
  highlightNav(path);
  document.querySelector('.app').classList.remove('mobile-open');
  clearTimeout(navTimer);
  // Simulated fetch: a brief skeleton keeps transitions honest and shows loading states.
  const skeleton = p.skeleton && SKELETONS[p.skeleton] && mountedPath !== path;
  const paint = () => {
    try {
      content.innerHTML = p.render(params);
      content.classList.remove('fade-in'); void content.offsetWidth; content.classList.add('fade-in');
      wireCommon(content);
      p.mount && p.mount(content, params);
    } catch (err) {
      console.error(err);
      content.innerHTML = errorState(err);
    }
    mountedPath = path;
  };
  if (skeleton) { content.innerHTML = SKELETONS[p.skeleton](); content.setAttribute('aria-busy', 'true'); navTimer = setTimeout(() => { content.removeAttribute('aria-busy'); paint(); }, 320); }
  else paint();
  if (mountedPath !== path) { window.scrollTo(0, 0); document.querySelector('#content').focus({ preventScroll: true }); }
}

function setCrumbs(p, params, title) {
  const cr = (typeof p.crumbs === 'function' ? p.crumbs(params) : p.crumbs) || [];
  document.querySelector('#crumbs').innerHTML = [...cr.map(([l, h]) => `<a href="#${h}">${esc(l)}</a><span class="sep">/</span>`), `<b>${esc(title)}</b>`].join('');
}
function highlightNav(path) {
  let best = null;
  document.querySelectorAll('.nav a[data-path]').forEach(a => {
    const p = a.dataset.path;
    const match = p === '/' ? path === '/' : (path === p || path.startsWith(p + '/'));
    if (match && (!best || p.length > best.dataset.path.length)) best = a;
    a.classList.remove('active'); a.removeAttribute('aria-current');
  });
  document.querySelectorAll('.nav-sec').forEach(s => s.classList.remove('has-active'));
  if (best) {
    best.classList.add('active'); best.setAttribute('aria-current', 'page');
    // The group holding the current page always opens, so the active item is visible
    const sec = best.closest('.nav-sec');
    if (sec) { sec.classList.add('has-active'); openNavGroup(sec.dataset.group, false); }
  }
}

const notFound = () => `<div class="panel" style="max-width:640px;margin:6vh auto 0"><div class="panel-body" style="padding:48px 40px">
  <div class="mono faint">Error 404</div>
  <h1 style="margin:8px 0 12px">This page isn't on the cause list</h1>
  <p class="muted" style="max-width:52ch">The address <span class="mono">${esc(location.hash || '/')}</span> doesn't match any page. It may have been moved, or the link was typed incorrectly.</p>
  <div class="row wrap" style="margin-top:24px"><a class="btn primary" href="#/">${I('home', 'sm')}Go to Today</a><button class="btn" onclick="openPalette()">${I('search', 'sm')}Search PactPro</button></div></div></div>`;
const forbidden = (p) => `<div class="panel" style="max-width:640px;margin:6vh auto 0"><div class="panel-body" style="padding:48px 40px">
  <div class="mono faint">Error 403</div>
  <h1 style="margin:8px 0 12px">Your role can't open ${esc(typeof p.title === 'string' ? p.title : 'this page')}</h1>
  <p class="muted" style="max-width:52ch">You're signed in as <b>${esc(session.role)}</b>. This page needs the <span class="mono">${esc(p.perm)}</span> permission. Ask a Super Admin to add it to your role.</p>
  <div class="row wrap" style="margin-top:24px"><a class="btn primary" href="#/">${I('home', 'sm')}Go to Today</a><button class="btn" onclick="switchRole('Senior Advocate')">Switch back to Senior Advocate</button></div></div></div>`;
const errorState = (err) => `<div class="panel" style="max-width:640px;margin:6vh auto 0"><div class="panel-body" style="padding:48px 40px">
  <div class="mono faint">Something failed</div>
  <h1 style="margin:8px 0 12px">This page couldn't load</h1>
  <p class="muted">PactPro couldn't reach the server. Your work is saved. Check your connection and try again.</p>
  <pre class="mono xs faint" style="white-space:pre-wrap;margin-top:16px">${esc(err && err.message || err)}</pre>
  <div class="row" style="margin-top:20px"><button class="btn primary" onclick="router()">${I('refresh', 'sm')}Try again</button><a class="btn" href="#/">Go to Today</a></div></div></div>`;

/* ==========================================================================
   SHELL
   ========================================================================== */
const navLink = (it) => {
  const n = it.count ? it.count() : 0;
  return `<a href="#${it.path}" data-path="${it.path}" title="${esc(it.label)}">${I(it.icon)}<span>${it.label}</span>${n ? `<span class="count ${it.hot ? 'hot' : ''}">${n}</span>` : ''}</a>`;
};
function navHtml() {
  const open = store.get('navOpen', 'court');
  const pinned = NAV.pinned.filter(it => can(it.perm));
  const groups = NAV.groups.map(g => {
    const items = g.items.filter(it => can(it.perm));
    if (!items.length) return '';
    // A closed group shows its urgent count on the header, so nothing urgent hides
    const hot = items.filter(it => it.hot && it.count).reduce((n, it) => n + it.count(), 0);
    const isOpen = open === g.id;
    return `<div class="nav-sec ${isOpen ? 'open' : ''}" data-group="${g.id}">
      <button class="nav-head" aria-expanded="${isOpen}" aria-controls="ng-${g.id}" data-toggle="${g.id}" title="${esc(g.label)}">${I(g.icon)}<span>${g.label}</span>${hot ? `<span class="count hot head-count">${hot}</span>` : ''}<svg class="i sm chev" viewBox="0 0 24 24" aria-hidden="true">${ICONS.chevron}</svg></button>
      <div class="nav-items" id="ng-${g.id}" role="group" aria-label="${esc(g.label)}"><div class="nav-items-in">${items.map(navLink).join('')}</div></div>
    </div>`;
  }).join('');
  return `<div class="nav-group nav-pinned">${pinned.map(navLink).join('')}</div><div class="nav-groups">${groups}</div>`;
}
/* Accordion: opening one group closes the others. toggle=false when auto-opening for the current page. */
function openNavGroup(id, toggle = true) {
  const secs = [...document.querySelectorAll('.nav-sec')];
  const target = secs.find(x => x.dataset.group === id);
  if (!target) return;
  const willOpen = toggle ? !target.classList.contains('open') : true;
  secs.forEach(x => { const on = x === target && willOpen; x.classList.toggle('open', on); x.querySelector('.nav-head').setAttribute('aria-expanded', on); });
  store.set('navOpen', willOpen ? id : '');
}
function navRail() { const a = document.querySelector('.app'); return !!a && (a.classList.contains('collapsed') || (innerWidth <= 1024 && innerWidth > 768)) && !a.classList.contains('mobile-open'); }
/* Icon rail: with no room to expand inline, a group's pages appear in a flyout beside the rail */
function navFlyout(head) {
  document.querySelectorAll('.nav-flyout').forEach(x => x.remove());
  const g = NAV.groups.find(x => x.id === head.dataset.toggle);
  const p = document.createElement('div');
  p.className = 'popover menu nav-flyout'; p.setAttribute('role', 'menu'); p.setAttribute('aria-label', g.label);
  p.innerHTML = `<div class="faint xs" style="padding:6px 10px 4px">${esc(g.label)}</div>` + g.items.filter(it => can(it.perm)).map(it => `<a role="menuitem" href="#${it.path}">${I(it.icon, 'sm')}<span>${it.label}</span>${it.count && it.count() ? `<span class="faint xs" style="margin-left:auto">${it.count()}</span>` : ''}</a>`).join('');
  document.body.appendChild(p);
  const r = head.getBoundingClientRect();
  p.style.left = (r.right + 8) + 'px'; p.style.top = Math.max(8, Math.min(r.top - 6, innerHeight - p.offsetHeight - 8)) + 'px';
  p.addEventListener('mouseleave', e => { if (!e.relatedTarget || !e.relatedTarget.closest('.nav-head')) p.remove(); });
  p.addEventListener('click', e => { if (e.target.closest('a')) p.remove(); });
  p.addEventListener('keydown', e => {
    const links = [...p.querySelectorAll('a')]; const i = links.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); links[(i + 1) % links.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); links[(i - 1 + links.length) % links.length].focus(); }
    if (e.key === 'Escape') { p.remove(); head.focus(); }
  });
  return p;
}
function wireNav(nav) {
  nav.addEventListener('click', e => {
    const h = e.target.closest('[data-toggle]'); if (!h) return;
    if (navRail()) { const f = navFlyout(h).querySelector('a'); f && f.focus(); return; }
    openNavGroup(h.dataset.toggle);
  });
  nav.addEventListener('mouseover', e => { const h = e.target.closest('.nav-head'); if (h && navRail()) { const f = document.querySelector('.nav-flyout'); if (!f || f.getAttribute('aria-label') !== h.title) navFlyout(h); } });
  nav.addEventListener('mouseleave', e => { if (!e.relatedTarget || !e.relatedTarget.closest('.nav-flyout')) document.querySelectorAll('.nav-flyout').forEach(x => x.remove()); });
  // Up/Down arrows move between pinned links, group headers and the open group's links
  nav.addEventListener('keydown', e => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const els = [...nav.querySelectorAll('.nav-pinned a, .nav-head, .nav-sec.open .nav-items a')].filter(x => x.offsetParent);
    const i = els.indexOf(document.activeElement); if (i < 0) return;
    e.preventDefault(); els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length].focus();
  });
}
function buildShell() {
  const collapsed = store.get('collapsed', false);
  document.querySelector('#app').innerHTML = `
  <div class="app ${collapsed ? 'collapsed' : ''}">
    <a href="#content" class="sr-only" style="position:absolute">Skip to content</a>
    <aside class="side" aria-label="Main navigation">
      <div class="brand"><span class="seal" aria-hidden="true">P</span><div><b>PactPro</b><small>${esc(D.firm.name)}</small></div></div>
      <button class="side-search" onclick="openPalette()" aria-label="Search (Ctrl+K)">${I('search', 'sm')}<span>Search or jump to</span><kbd>Ctrl K</kbd></button>
      <nav class="nav" id="nav" aria-label="Sections">${navHtml()}</nav>
      <div class="nav nav-bottom">${NAV.bottom.filter(it => can(it.perm)).map(navLink).join('')}</div>
      <div class="side-foot">${avatar(D.me.name)}<div class="who grow"><b>${esc(D.me.name)}</b><span id="role-lbl">${esc(session.role)}</span></div></div>
    </aside>
    <div class="scrim" onclick="toggleSidebar(false)"></div>
    <div class="main">
      <header class="top">
        <button class="icon-btn hamb" onclick="toggleSidebar()" aria-label="Open menu">${I('menu')}</button>
        <button class="icon-btn hide-sm" onclick="toggleCollapse()" aria-label="Collapse sidebar" title="Collapse sidebar">${I('sidebar')}</button>
        <nav class="crumbs" id="crumbs" aria-label="Breadcrumb"></nav>
        <div class="spacer"></div>
        <button class="top-search" onclick="openPalette()" aria-label="Search">${I('search', 'sm')}<span>Search cases, clients, CNR…</span><kbd>Ctrl K</kbd></button>
        <button class="btn primary sm hide-sm" data-pop onclick="quickActions(this)" aria-haspopup="menu">${I('plus', 'sm')}New</button>
        <button class="icon-btn" data-pop id="bell" onclick="openNotifications(this)" aria-label="Notifications">${I('bell')}<span class="dot" id="bell-dot"></span></button>
        <button class="icon-btn" onclick="toggleTheme()" id="theme-btn" aria-label="Switch theme"></button>
        <button class="user-btn" data-pop onclick="userMenu(this)" aria-haspopup="menu" aria-label="Account menu">${avatar(D.me.name, 'sm')}<span class="name small">${esc(D.me.name.split(' ')[0])}</span>${I('chevronDown', 'sm')}</button>
      </header>
      <main id="content" class="content" tabindex="-1"></main>
    </div>
  </div>`;
  updateBell(); updateThemeBtn(); wireNav(document.querySelector("#nav"));
  setTimeout(hearingAlert, 2500);
}
function refreshNav() { const n = document.querySelector('#nav'); if (n) { n.innerHTML = navHtml(); highlightNav(currentPath()); } }
function toggleSidebar(force) { const a = document.querySelector('.app'); a.classList.toggle('mobile-open', force); }
function toggleCollapse() { const a = document.querySelector('.app'); a.classList.toggle('collapsed'); store.set('collapsed', a.classList.contains('collapsed')); }

/* Theme: explicit choice wins; otherwise follow the OS. */
function effectiveTheme() { const t = document.documentElement.dataset.theme; return t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
function toggleTheme() { const next = effectiveTheme() === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = next; store.set('theme', next); updateThemeBtn(); }
function updateThemeBtn() { const b = document.querySelector('#theme-btn'); if (!b) return; const dark = effectiveTheme() === 'dark'; b.innerHTML = I(dark ? 'sun' : 'moon'); b.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme'); b.title = b.getAttribute('aria-label'); }
(() => { const t = store.get('theme', null); if (t) document.documentElement.dataset.theme = t; })();

function switchRole(role) { session.role = role; store.set('role', role); refreshNav(); const l = document.querySelector('#role-lbl'); if (l) l.textContent = role; router(); toast(`Viewing PactPro as ${esc(role)}`, 'info'); }

function userMenu(btn) {
  popMenu(btn, [
    { html: `<div style="padding:8px 10px 10px"><b>${esc(D.me.name)}</b><div class="faint xs">${esc(D.me.email)}</div></div><div class="sep"></div>` },
    { label: 'Profile & settings', icon: 'cog', onClick: () => go('/settings') },
    { label: 'Client portal preview', icon: 'globe', onClick: () => go('/portal') },
    { label: 'Keyboard shortcuts', icon: 'bolt', meta: '?', onClick: shortcutsHelp },
    '-',
    { html: `<div class="faint xs" style="padding:6px 10px 4px">View as role (demo of permissions)</div>` },
    ...['Senior Advocate', 'Junior Advocate', 'Intern', 'Accountant', 'Super Admin'].map(r => ({ label: r, icon: session.role === r ? 'check' : 'user', onClick: () => switchRole(r) })),
    '-',
    { label: 'Sign out', icon: 'logout', danger: true, onClick: signOut },
  ], { width: 260 });
}
function signOut() { session.authed = false; store.set('authed', false); document.querySelector('#app').innerHTML = ''; go('/login'); router(); toast('Signed out', 'info'); }

/* Quick actions ("New" menu) */
function quickActions(btn) {
  popMenu(btn, [
    { label: 'Case', icon: 'case', meta: 'C', onClick: () => go('/cases/new') },
    { label: 'Hearing or event', icon: 'calendar', meta: 'H', onClick: () => FORMS.event() },
    { label: 'Client', icon: 'users', onClick: () => FORMS.client() },
    { label: 'Task', icon: 'tasks', meta: 'T', onClick: () => FORMS.task() },
    '-',
    { label: 'Invoice', icon: 'receipt', onClick: () => FORMS.invoice() },
    { label: 'Payment received', icon: 'rupee', onClick: () => FORMS.payment() },
    { label: 'Expense', icon: 'wallet', onClick: () => FORMS.expense() },
    { label: 'Upload documents', icon: 'upload', onClick: () => FORMS.upload() },
    '-',
    { label: 'Draft', icon: 'pen', onClick: () => go('/drafting/new') },
  ], { width: 240 });
}

/* ---------- Notifications panel ---------- */
const NOTIF_ICON = { HEARING_REMINDER: 'gavel', TASK_SUBMITTED: 'tasks', PAYMENT_RECEIVED: 'rupee', OVERDUE_PAYMENT_REMINDER: 'receipt', CLIENT_REGISTERED: 'users', HEARING_RESCHEDULED: 'calendar', TASK_CHANGES_REQUESTED: 'edit', CASE_STATUS_UPDATED: 'case' };
function updateBell() { const n = D.notifications.filter(x => x.unread).length; const d = document.querySelector('#bell-dot'); if (d) { d.textContent = n; d.hidden = !n; } const b = document.querySelector('#bell'); if (b) b.setAttribute('aria-label', `Notifications, ${n} unread`); }
function openNotifications(btn) {
  closePopovers();
  const p = document.createElement('div');
  p.className = 'popover notif-panel'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'Notifications');
  const draw = () => {
    const n = D.notifications.filter(x => x.unread).length;
    p.innerHTML = `<div class="head"><div><h3>Notifications</h3><div class="faint xs">${n ? n + ' unread' : 'All caught up'}</div></div><div class="row"><button class="btn ghost sm" id="mark-all" ${n ? '' : 'disabled'}>Mark all read</button></div></div>
      <div style="max-height:min(460px,60vh);overflow:auto">${D.notifications.map(x => `<div class="notif ${x.unread ? 'unread' : ''}" data-id="${x.id}" tabindex="0" role="button"><span class="ic">${I(NOTIF_ICON[x.kind] || 'bell', 'sm')}</span><div class="grow"><div class="small">${esc(x.text)}</div><div class="faint xs" style="margin-top:2px">${ago(x.at)}</div></div>${x.unread ? '<span class="sr-only">Unread</span>' : ''}</div>`).join('')}</div>
      <div style="padding:10px 16px;border-top:1px solid var(--line)"><a class="link small" href="#/notifications">Open delivery log</a></div>`;
    p.querySelector('#mark-all').onclick = () => { D.notifications.forEach(x => x.unread = false); updateBell(); draw(); };
  };
  draw();
  document.body.appendChild(p); placePopover(p, btn);
  p.addEventListener('click', e => { const it = e.target.closest('.notif'); if (!it) return; const x = D.notifications.find(n => n.id === +it.dataset.id); x.unread = false; updateBell(); closePopovers(); location.hash = x.route; });
  p.addEventListener('keydown', e => { if (e.key === 'Escape') { closePopovers(); btn.focus(); } if (e.key === 'Enter' && e.target.closest('.notif')) e.target.click(); });
  setTimeout(() => (p.querySelector('.notif') || p).focus(), 10);
}

/* Hearing alert: the one ambient interruption in the app */
function hearingAlert() {
  const c = D.cases.find(x => x.next && daysFrom(x.next) === 0 && x.next > new Date()) || D.cases.find(x => x.next && daysFrom(x.next) === 0);
  if (!c || !document.querySelector('.app') || store.get('alerted-' + TODAY.toDateString(), false)) return;
  store.set('alerted-' + TODAY.toDateString(), true);
  toast(`<b>${esc(c.no)}</b> is listed today as item ${c.item} in ${esc(c.hall)}, ${ftime(c.next)}.`, 'warn', { ms: 8000, action: { label: 'Open case', href: '#/cases/' + c.id } });
}

/* ---------- Command palette (Ctrl/Cmd+K) ---------- */
let paletteOpen = false;
function openPalette(prefill = '') {
  if (paletteOpen) return; paletteOpen = true;
  const wrap = document.createElement('div');
  wrap.className = 'overlay top';
  wrap.innerHTML = `<div class="palette" role="dialog" aria-modal="true" aria-label="Search and commands">
    <div class="palette-input">${I('search')}<input id="pal-q" placeholder="Search cases, clients, CNR, documents, or type a command" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="pal-list" value="${esc(prefill)}"><kbd>Esc</kbd></div>
    <div class="palette-list" id="pal-list" role="listbox"></div>
    <div class="palette-foot"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>↵</kbd> open</span><span><kbd>Esc</kbd> close</span><span style="margin-left:auto">Try “900”, “Kannan”, “invoice”, “dark”</span></div></div>`;
  document.body.appendChild(wrap);
  const q = wrap.querySelector('#pal-q'); const list = wrap.querySelector('#pal-list');
  let items = []; let sel = 0;
  const recent = store.get('recent', []);
  const commands = [
    ['New case', 'plus', () => go('/cases/new')], ['New hearing or event', 'calendar', () => FORMS.event()], ['New client', 'users', () => FORMS.client()],
    ['New task', 'tasks', () => FORMS.task()], ['Generate invoice', 'receipt', () => FORMS.invoice()], ['Record payment', 'rupee', () => FORMS.payment()],
    ['Add expense', 'wallet', () => FORMS.expense()], ['Upload documents', 'upload', () => FORMS.upload()], ['New draft', 'pen', () => go('/drafting/new')],
    ['Switch theme', 'moon', toggleTheme], ['Keyboard shortcuts', 'bolt', shortcutsHelp], ['Sign out', 'logout', signOut],
  ];
  const pages = NAV_ALL().filter(it => can(it.perm)).map(it => [it.label, it.icon, () => go(it.path)]);
  const build = () => {
    const s = q.value.trim().toLowerCase(); const groups = [];
    const m = (t) => t.toLowerCase().includes(s);
    if (!s) {
      if (recent.length) groups.push(['Recent', recent.slice(0, 4).map(r => ({ label: r.label, icon: r.icon, meta: r.meta, run: () => go(r.href) }))]);
      groups.push(['Jump to', pages.slice(0, 8).map(([l, i, r]) => ({ label: l, icon: i, run: r }))]);
      groups.push(['Actions', commands.slice(0, 6).map(([l, i, r]) => ({ label: l, icon: i, run: r }))]);
    } else {
      const cs = D.cases.filter(c => m(c.no) || m(c.title) || m(c.cnr) || m(clientById(c.client).name)).slice(0, 6).map(c => ({ label: `${c.no}`, sub: c.title, icon: 'case', meta: c.status, href: '/cases/' + c.id }));
      const cl = D.clients.filter(c => m(c.name) || m(c.phone) || m(c.email)).slice(0, 4).map(c => ({ label: c.name, sub: c.city, icon: 'users', meta: 'Client', href: '/clients/' + c.id }));
      const iv = D.invoices.filter(i => m(i.no) || m(clientById(i.client).name)).slice(0, 3).map(i => ({ label: i.no, sub: clientById(i.client).name + ', ' + inr(i.total), icon: 'receipt', meta: i.status, href: '/invoices?id=' + i.id }));
      const dc = D.documents.filter(d => m(d.name)).slice(0, 4).map(d => ({ label: d.name, sub: caseById(d.caseId).no, icon: docIcon(d.ext), meta: d.cat, href: '/documents?q=' + encodeURIComponent(d.name) }));
      const pg = pages.filter(([l]) => m(l)).map(([l, i, r]) => ({ label: l, icon: i, run: r, meta: 'Page' }));
      const cm = commands.filter(([l]) => m(l)).map(([l, i, r]) => ({ label: l, icon: i, run: r, meta: 'Action' }));
      [['Cases', cs], ['Clients', cl], ['Invoices', iv], ['Documents', dc], ['Pages', pg], ['Actions', cm]].forEach(g => g[1].length && groups.push(g));
    }
    items = groups.flatMap(g => g[1]); sel = 0;
    let idx = 0;
    list.innerHTML = items.length ? groups.map(([name, its]) => `<div class="palette-group">${name}</div>${its.map(it => `<div class="palette-item" role="option" id="pi${idx}" data-i="${idx++}">${I(it.icon, 'sm')}<div class="grow ellipsis"><span class="${it.icon === 'case' ? 'mono' : ''}">${esc(it.label)}</span>${it.sub ? ` <span class="faint small">${esc(it.sub)}</span>` : ''}</div><span class="meta">${esc(it.meta || '')}</span></div>`).join('')}`).join('')
      : emptyState({ icon: 'search', title: `No results for “${esc(q.value)}”`, text: 'Search by case number, party name, CNR, client, invoice number or document name.' });
    paint();
  };
  const paint = () => { list.querySelectorAll('.palette-item').forEach(el => { const on = +el.dataset.i === sel; el.setAttribute('aria-selected', on); if (on) el.scrollIntoView({ block: 'nearest' }); }); q.setAttribute('aria-activedescendant', 'pi' + sel); };
  const run = (it) => {
    if (!it) return; close();
    if (it.href) { const r = store.get('recent', []).filter(x => x.href !== it.href); r.unshift({ label: it.label, icon: it.icon, meta: it.meta, href: it.href }); store.set('recent', r.slice(0, 6)); go(it.href); }
    else it.run();
  };
  const close = () => { paletteOpen = false; wrap.remove(); };
  q.addEventListener('input', build);
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); paint(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); paint(); }
    if (e.key === 'Enter') { e.preventDefault(); run(items[sel]); }
    if (e.key === 'Escape') close();
  });
  list.addEventListener('mousemove', e => { const it = e.target.closest('.palette-item'); if (it && +it.dataset.i !== sel) { sel = +it.dataset.i; paint(); } });
  list.addEventListener('click', e => { const it = e.target.closest('.palette-item'); if (it) run(items[+it.dataset.i]); });
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  build(); q.focus(); q.select();
}
function shortcutsHelp() {
  const rows = [['Ctrl / ⌘ K', 'Search and commands'], ['G then T', 'Go to Today'], ['G then C', 'Go to Cases'], ['G then H', 'Go to Hearings'], ['G then I', 'Go to Invoices'], ['N', 'New menu'], ['?', 'This list'], ['Esc', 'Close any dialog']];
  modal({ title: 'Keyboard shortcuts', size: 'narrow', body: `<table class="t"><tbody>${rows.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('')}</tbody></table>` });
}
let gPending = false;
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (session.authed) openPalette(); return; }
  if (e.target.closest('input,textarea,select,[contenteditable]') || document.querySelector('.overlay,.drawer-wrap') || !document.querySelector('.app')) return;
  if (e.key === '?') { shortcutsHelp(); return; }
  if (e.key === 'n') { const b = document.querySelector('.top .btn.primary'); b && quickActions(b); return; }
  if (gPending) { const map = { t: '/', c: '/cases', h: '/hearings', i: '/invoices', k: '/tasks', d: '/documents' }; if (map[e.key]) go(map[e.key]); gPending = false; return; }
  if (e.key === 'g') { gPending = true; setTimeout(() => gPending = false, 900); }
});

/* ==========================================================================
   SHARED FORMS (used by quick actions, palette and pages)
   Each opens a modal with validation and a success toast. opts.caseId pre-selects.
   ========================================================================== */
const caseOptions = () => D.cases.filter(c => c.status !== 'Closed').map(c => [c.id, `${c.no} · ${c.title}`]);
const FORMS = {
  client(existing, onSave) {
    const c = existing || {};
    modal({
      title: existing ? 'Edit client' : 'New client', sub: existing ? esc(c.name) : 'The handling advocate is notified in the app and by email.', size: 'wide',
      body: `<form class="form-grid" novalidate id="cf">
        <div class="fieldset-title">Basic details</div>
        ${field({ id: 'c-name', label: 'Name', value: c.name, required: true, err: 'Enter the client\'s name.' })}
        ${field({ id: 'c-kind', label: 'Client type', options: ['Individual', 'Company'], value: c.kind })}
        ${field({ id: 'c-email', label: 'Email', type: 'email', value: c.email, required: true, rule: 'email', err: 'Enter a valid email, like name@example.com.' })}
        ${field({ id: 'c-phone', label: 'Phone', type: 'tel', value: c.phone, required: true, rule: 'phone', placeholder: '+91 98400 00000', err: 'Enter a 10-digit mobile number.' })}
        ${field({ id: 'c-gstin', label: 'GSTIN', value: c.gstin, rule: 'gstin', placeholder: 'Optional, 15 characters', err: 'GSTIN should look like 33AAKFK4471M1ZQ.' })}
        ${field({ id: 'c-adv', label: 'Handling advocate', options: D.advocates.filter(a => a.role.includes('Advocate')).map(a => [a.id, a.name]), value: c.advocate || 1 })}
        <div class="fieldset-title">Address</div>
        ${field({ id: 'c-bld', label: 'Building / door no.', value: c.building })}
        ${field({ id: 'c-st', label: 'Street and area', value: c.street })}
        ${field({ id: 'c-city', label: 'City', value: c.city || 'Chennai' })}
        ${field({ id: 'c-dist', label: 'District', value: c.district || 'Chennai' })}
        ${field({ id: 'c-state', label: 'State', value: 'Tamil Nadu', options: ['Tamil Nadu', 'Kerala', 'Karnataka', 'Andhra Pradesh', 'Puducherry'] })}
        ${field({ id: 'c-pin', label: 'PIN code', value: c.pin, rule: 'pincode', err: 'PIN code is 6 digits.' })}
        ${field({ id: 'c-note', label: 'Notes', type: 'textarea', value: c.note, full: true, placeholder: 'Matter background, referral, preferences' })}
      </form>`,
      foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="c-save">${existing ? 'Save changes' : 'Add client'}</button>`,
      onMount(el, close) {
        el.querySelector('#c-save').onclick = (e) => {
          if (!validateForm(el.querySelector('#cf'))) return;
          busy(e.currentTarget, () => {
            const v = (id) => el.querySelector('#' + id).value.trim();
            const data = { name: v('c-name'), kind: v('c-kind'), email: v('c-email'), phone: v('c-phone'), gstin: v('c-gstin'), advocate: +v('c-adv'), building: v('c-bld'), street: v('c-st'), city: v('c-city'), district: v('c-dist'), pin: v('c-pin'), note: v('c-note') };
            if (existing) Object.assign(existing, data); else D.clients.unshift({ id: Math.max(...D.clients.map(x => x.id)) + 1, since: new Date(), portal: false, ...data });
            close(); toast(existing ? `Saved ${esc(data.name)}` : `Added ${esc(data.name)} as a client`, 'ok'); onSave ? onSave() : (currentPath().startsWith('/clients') && router());
          });
        };
      },
    });
  },
  event(opts = {}) {
    const isH = (opts.type || 'Hearing') === 'Hearing';
    modal({
      title: 'New hearing or event', size: 'wide',
      body: `<form class="form-grid" novalidate id="ef">
        ${field({ id: 'e-type', label: 'Type', options: ['Hearing', 'Client Meeting', 'Payment Due', 'Document Filing'], value: opts.type || 'Hearing' })}
        ${field({ id: 'e-case', label: 'Case', options: caseOptions(), value: opts.caseId, placeholder: 'Select a case', required: true, err: 'Every event belongs to a case.' })}
        ${field({ id: 'e-title', label: 'Title', value: opts.title || '', placeholder: 'For hearings, the case number is used', full: true })}
        ${field({ id: 'e-date', label: 'Date', type: 'date', required: true, value: isoDate(opts.date || day(1)), err: 'Pick a date.' })}
        ${field({ id: 'e-time', label: 'Time', type: 'time', value: '10:30' })}
        <div class="form-grid full" id="e-hearing" style="${isH ? '' : 'display:none'}">
          ${field({ id: 'e-purpose', label: 'Purpose / stage', options: D.hearingPurposes })}
          ${field({ id: 'e-hall', label: 'Court hall / bench', placeholder: 'Court Hall 12' })}
          ${field({ id: 'e-judge', label: 'Judge / coram', placeholder: 'Hon\'ble Mr. Justice …', full: true })}
        </div>
        ${field({ id: 'e-desc', label: 'Notes', type: 'textarea', full: true, placeholder: 'What to carry, who attends' })}
        <label class="check full"><input type="checkbox" id="e-alert" checked> Email the client a hearing reminder the day before</label>
      </form>`,
      foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="e-save">Save event</button>`,
      onMount(el, close) {
        el.querySelector('#e-type').onchange = (e) => { el.querySelector('#e-hearing').style.display = e.target.value === 'Hearing' ? '' : 'none'; };
        el.querySelector('#e-case').onchange = (e) => { const c = caseById(e.target.value); if (c) { el.querySelector('#e-hall').value = c.hall; el.querySelector('#e-judge').value = c.judge; } };
        el.querySelector('#e-save').onclick = (e) => {
          if (!validateForm(el.querySelector('#ef'))) return;
          busy(e.currentTarget, () => {
            const v = (id) => el.querySelector('#' + id).value;
            const c = caseById(v('e-case')); const [hh, mm] = (v('e-time') || '10:30').split(':');
            const at = new Date(v('e-date')); at.setHours(+hh, +mm);
            D.events.push({ id: Math.max(...D.events.map(x => x.id)) + 1, type: v('e-type'), title: v('e-title') || c.no, caseId: c.id, at, purpose: v('e-purpose'), court: c.courtName, hall: v('e-hall'), judge: v('e-judge') });
            close(); toast(`${esc(v('e-type'))} saved for ${fdate(at)}`, 'ok', { action: { label: 'View calendar', href: '#/hearings' } }); opts.onSave ? opts.onSave() : router();
          });
        };
      },
    });
  },
  task(opts = {}) {
    modal({
      title: 'New task',
      body: `<form class="form-grid" novalidate id="tf">
        ${field({ id: 't-title', label: 'What needs to be done?', required: true, full: true, value: opts.title || '', err: 'Describe the task.' })}
        ${field({ id: 't-case', label: 'Case', options: caseOptions(), value: opts.caseId, placeholder: 'Not linked to a case' })}
        ${field({ id: 't-assignee', label: 'Assign to', options: D.advocates.map(a => [a.id, a.id === D.me.id ? 'Myself' : a.name]), value: D.me.id })}
        ${field({ id: 't-priority', label: 'Priority', options: ['High', 'Medium', 'Low'], value: 'Medium' })}
        ${field({ id: 't-due', label: 'Deadline', type: 'date', value: isoDate(day(2)) })}
        <label class="check full"><input type="checkbox" id="t-review" checked> Needs my review when done</label>
      </form>`,
      foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="t-save">Add task</button>`,
      onMount(el, close) {
        el.querySelector('#t-save').onclick = (e) => {
          if (!validateForm(el.querySelector('#tf'))) return;
          busy(e.currentTarget, () => {
            const v = (id) => el.querySelector('#' + id).value;
            D.tasks.unshift({ id: Math.max(...D.tasks.map(t => t.id)) + 1, title: v('t-title'), caseId: +v('t-case') || null, priority: v('t-priority'), due: new Date(v('t-due')), assignee: +v('t-assignee'), by: D.me.id, status: 'In Progress' });
            close(); toast('Task added', 'ok', { action: { label: 'View tasks', href: '#/tasks' } }); refreshNav(); opts.onSave ? opts.onSave() : (currentPath() === '/tasks' && router());
          });
        };
      },
    });
  },
  invoice(opts = {}) {
    let lines = [['Professional fee', '']];
    modal({
      title: 'Generate invoice', sub: 'GST at 18% for legal services (SAC 998212). CGST and SGST apply within Tamil Nadu; IGST outside.', size: 'wide',
      body: `<form novalidate id="if" class="stack" style="gap:16px">
        <div class="form-grid">${field({ id: 'i-case', label: 'Case', options: caseOptions(), value: opts.caseId, placeholder: 'Select a case', required: true, err: 'Invoices are raised against a case.' })}
        ${field({ id: 'i-date', label: 'Invoice date', type: 'date', value: isoDate(TODAY) })}
        ${field({ id: 'i-due', label: 'Due date', type: 'date', value: isoDate(day(30)) })}
        ${field({ id: 'i-gst', label: 'GST treatment', options: ['Forward charge (firm charges GST)', 'Reverse charge (client pays GST)', 'Exempt'] })}</div>
        <div><div class="label" style="margin-bottom:8px">Particulars</div><div id="i-lines" class="stack" style="gap:8px"></div><button type="button" class="btn ghost sm" id="i-add" style="margin-top:8px">${I('plus', 'sm')}Add line</button></div>
        <div class="panel tinted"><div class="panel-body" style="padding:14px 18px"><dl class="kv" id="i-tot" style="grid-template-columns:1fr auto"></dl></div></div>
      </form>`,
      foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn" id="i-draft">Save as draft</button><button class="btn primary" id="i-save">Raise invoice</button>`,
      onMount(el, close) {
        const box = el.querySelector('#i-lines');
        const draw = () => {
          box.innerHTML = lines.map((l, i) => `<div class="row" style="align-items:flex-start"><div class="field grow"><label class="sr-only" for="il-d${i}">Description</label><input class="input" id="il-d${i}" value="${esc(l[0])}" placeholder="Description"></div><div class="field" style="width:150px"><label class="sr-only" for="il-a${i}">Amount</label><input class="input num right" id="il-a${i}" type="number" min="0" value="${esc(l[1])}" placeholder="₹ 0" ${i === 0 ? 'required' : ''}><span class="err">${I('warn', 'sm')}Enter an amount.</span></div><button type="button" class="btn ghost icon" data-rm="${i}" aria-label="Remove line" ${lines.length === 1 ? 'disabled' : ''}>${I('trash', 'sm')}</button></div>`).join('');
          tot();
        };
        const tot = () => {
          const sub = lines.reduce((s, l) => s + (+l[1] || 0), 0); const gst = el.querySelector('#i-gst').value.startsWith('Forward') ? Math.round(sub * .18) : 0;
          el.querySelector('#i-tot').innerHTML = `<dt>Taxable value</dt><dd class="num right">${inr(sub)}</dd><dt>CGST 9%</dt><dd class="num right">${inr(gst / 2)}</dd><dt>SGST 9%</dt><dd class="num right">${inr(gst / 2)}</dd><dt style="color:var(--ink);font-weight:600">Total</dt><dd class="num right" style="font:500 20px var(--f-display)">${inr(sub + gst)}</dd>`;
        };
        box.addEventListener('input', e => { const m = e.target.id.match(/il-([da])(\d+)/); if (m) { lines[+m[2]][m[1] === 'd' ? 0 : 1] = e.target.value; tot(); } });
        box.addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { lines.splice(+b.dataset.rm, 1); draw(); } });
        el.querySelector('#i-add').onclick = () => { lines.push(['', '']); draw(); el.querySelector(`#il-d${lines.length - 1}`).focus(); };
        el.querySelector('#i-gst').onchange = tot;
        const save = (status) => (e) => {
          if (!validateForm(el.querySelector('#if'))) return;
          busy(e.currentTarget, () => {
            const c = caseById(el.querySelector('#i-case').value); const n = Math.max(...D.invoices.map(x => x.id)) + 1;
            const sub = lines.reduce((s, l) => s + (+l[1] || 0), 0);
            D.invoices.unshift({ id: n, no: 'KA/2026-27/' + String(n).padStart(4, '0'), caseId: c.id, client: c.client, date: new Date(el.querySelector('#i-date').value), due: new Date(el.querySelector('#i-due').value), items: lines.map(([d, a]) => ({ d, a: +a })), taxable: sub, gst: Math.round(sub * .18), total: Math.round(sub * 1.18), status });
            close(); toast(status === 'Draft' ? `Draft KA/2026-27/${String(n).padStart(4, '0')} saved` : `Invoice KA/2026-27/${String(n).padStart(4, '0')} raised for ${esc(clientById(c.client).name)}`, 'ok', { action: { label: 'View', href: '#/invoices' } }); opts.onSave ? opts.onSave() : (currentPath() === '/invoices' && router());
          });
        };
        el.querySelector('#i-save').onclick = save('Unpaid'); el.querySelector('#i-draft').onclick = save('Draft');
        draw();
      },
    });
  },
  payment(opts = {}) {
    modal({
      title: 'Record payment received',
      body: `<form class="form-grid" novalidate id="pf">
        ${field({ id: 'p-case', label: 'Case', options: D.cases.map(c => [c.id, `${c.no} · ${clientById(c.client).name}`]), value: opts.caseId, placeholder: 'Select a case', required: true, full: true, err: 'Select the case this payment is for.' })}
        ${field({ id: 'p-amt', label: 'Amount (₹)', type: 'number', required: true, err: 'Enter the amount received.' })}
        ${field({ id: 'p-date', label: 'Date received', type: 'date', value: isoDate(TODAY) })}
        ${field({ id: 'p-mode', label: 'Payment mode', options: D.paymentModes })}
        ${field({ id: 'p-ref', label: 'Reference / transaction no.', placeholder: 'UPI-900-002' })}
        ${field({ id: 'p-inv', label: 'Against invoice', options: D.invoices.filter(i => i.status !== 'Paid' && i.status !== 'Draft').map(i => [i.id, `${i.no} · ${inr(i.total)}`]), placeholder: 'Advance (no invoice)', full: true })}
      </form>`,
      foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="p-save">Record payment</button>`,
      onMount(el, close) {
        el.querySelector('#p-save').onclick = (e) => {
          if (!validateForm(el.querySelector('#pf'))) return;
          busy(e.currentTarget, () => {
            const v = (id) => el.querySelector('#' + id).value; const c = caseById(v('p-case'));
            D.payments.unshift({ id: D.payments.length + 1, caseId: c.id, client: c.client, date: new Date(v('p-date')), amount: +v('p-amt'), mode: v('p-mode'), ref: v('p-ref'), invoice: +v('p-inv') || null });
            if (+v('p-inv')) { const iv = D.invoices.find(i => i.id === +v('p-inv')); if (iv) iv.status = 'Paid'; }
            close(); toast(`Payment of ${inr(+v('p-amt'))} recorded`, 'ok'); opts.onSave ? opts.onSave() : router();
          });
        };
      },
    });
  },
  expense(opts = {}) {
    modal({
      title: 'Add expense',
      body: `<form class="form-grid" novalidate id="xf">
        ${field({ id: 'x-case', label: 'Case', options: D.cases.map(c => [c.id, `${c.no} · ${c.title}`]), value: opts.caseId, placeholder: 'Select a case', required: true, full: true, err: 'Select a case.' })}
        ${field({ id: 'x-title', label: 'What was it for?', required: true, full: true, placeholder: 'Certified copy of decree', err: 'Describe the expense.' })}
        ${field({ id: 'x-amt', label: 'Amount (₹)', type: 'number', required: true, err: 'Enter the amount.' })}
        ${field({ id: 'x-cat', label: 'Category', options: D.expenseCategories })}
        ${field({ id: 'x-date', label: 'Date', type: 'date', value: isoDate(TODAY) })}
        ${field({ id: 'x-mode', label: 'Paid by', options: D.paymentModes })}
      </form>`,
      foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="x-save">Add expense</button>`,
      onMount(el, close) {
        el.querySelector('#x-save').onclick = (e) => {
          if (!validateForm(el.querySelector('#xf'))) return;
          busy(e.currentTarget, () => {
            const v = (id) => el.querySelector('#' + id).value;
            D.expenses.unshift({ id: D.expenses.length + 1, caseId: +v('x-case'), title: v('x-title'), amount: +v('x-amt'), cat: v('x-cat'), date: new Date(v('x-date')), mode: v('x-mode'), status: 'Paid' });
            close(); toast(`Expense of ${inr(+v('x-amt'))} added`, 'ok'); opts.onSave ? opts.onSave() : router();
          });
        };
      },
    });
  },
  upload(opts = {}) {
    let files = [];
    modal({
      title: 'Upload documents', sub: 'PDF, Word, images or ZIP, up to 25 MB each.', size: 'wide',
      body: `<form class="stack" novalidate id="uf" style="gap:16px">
        <label class="dropzone" id="u-drop" for="u-file">${I('upload', 'lg')}<div style="margin-top:8px"><b>Drop files here</b> or <span class="link">browse</span></div><div class="faint xs" style="margin-top:4px">Files are scanned and versioned automatically</div><input type="file" id="u-file" multiple class="sr-only"></label>
        <div id="u-list" class="stack" style="gap:6px"></div>
        <div class="form-grid">
          ${field({ id: 'u-case', label: 'Case', options: D.cases.map(c => [c.id, `${c.no} · ${c.title}`]), value: opts.caseId, placeholder: 'Not linked to a case' })}
          ${field({ id: 'u-cat', label: 'Category', options: D.docCategories.filter(c => c !== 'Draft'), value: opts.cat || 'Petition' })}
        </div>
        <label class="switch"><input type="checkbox" id="u-share"> Share with client on the portal</label>
      </form>`,
      foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="u-save">Upload</button>`,
      onMount(el, close) {
        const drop = el.querySelector('#u-drop'); const list = el.querySelector('#u-list');
        const draw = () => { list.innerHTML = files.map((f, i) => `<div class="row" style="padding:8px 12px;border:1px solid var(--line);border-radius:var(--r-md)">${I('file', 'sm')}<span class="grow ellipsis small">${esc(f.name)}</span><span class="faint xs">${sizeFmt(Math.max(1, Math.round(f.size / 1024)))}</span><button type="button" class="btn ghost sm icon" data-rm="${i}" aria-label="Remove ${esc(f.name)}">${I('x', 'sm')}</button></div>`).join(''); };
        const add = (fl) => { files = files.concat([...fl]); draw(); };
        el.querySelector('#u-file').onchange = e => add(e.target.files);
        ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
        ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
        drop.addEventListener('drop', e => add(e.dataTransfer.files));
        list.addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (b) { files.splice(+b.dataset.rm, 1); draw(); } });
        el.querySelector('#u-save').onclick = (e) => {
          if (!files.length) { files = [{ name: 'Scanned order ' + fdate(TODAY, { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '.') + '.pdf', size: 240000 }]; draw(); }
          busy(e.currentTarget, () => {
            const cid = +el.querySelector('#u-case').value || 1; const c = caseById(cid);
            files.forEach(f => D.documents.unshift({ id: D.documents.length + 1, name: f.name, cat: el.querySelector('#u-cat').value, caseId: cid, client: c.client, ext: (f.name.split('.').pop() || 'pdf').toLowerCase(), kb: Math.max(1, Math.round(f.size / 1024)), version: 1, shared: el.querySelector('#u-share').checked, date: new Date(), by: D.me.name, status: 'Active' }));
            close(); toast(`${files.length} document${files.length > 1 ? 's' : ''} uploaded to ${esc(c.no)}`, 'ok'); opts.onSave ? opts.onSave() : router();
          }, 900);
        };
      },
    });
  },
};

/* Document preview drawer (used by Documents, Case detail, Client detail) */
function previewDoc(d) {
  const c = caseById(d.caseId);
  drawer({
    title: esc(d.name), sub: `${esc(d.cat)}, version ${d.version}, ${sizeFmt(d.kb)}`, wide: true,
    body: `<div class="paper-sheet" style="margin:0 auto 20px;width:100%;max-width:560px;padding:40px 44px;font-size:13.5px">
      <h2>IN THE ${esc(c.courtName.toUpperCase())}</h2>
      <p style="text-align:center"><b>${esc(c.no)}</b></p>
      <p style="text-align:center;margin:14px 0">${esc(c.party[0])}<br><i>…${esc(D.parties(c)[0].role)}</i><br>vs<br>${esc(c.party[1])}<br><i>…${esc(D.parties(c)[1].role)}</i></p>
      <p style="margin-top:14px">${esc(c.desc)}</p>
      <p style="margin-top:10px;color:#6b6b6b">[Preview of page 1. Open the file to read the full document.]</p></div>
      <dl class="kv"><dt>Case</dt><dd><a class="link" href="#/cases/${c.id}">${esc(c.no)}</a></dd><dt>Client</dt><dd>${esc(clientById(d.client).name)}</dd><dt>Uploaded</dt><dd>${fdate(d.date)} by ${esc(d.by)}</dd><dt>Shared with client</dt><dd>${d.shared ? chip('Shared', 'ok') : chip('Private', '')}</dd></dl>
      <h4 style="margin:22px 0 8px">Versions</h4>
      <div class="timeline">${Array.from({ length: d.version }, (_, i) => `<div class="tl-item ${i === 0 ? 'key' : ''}"><div class="small"><b>v${d.version - i}</b> ${i === 0 ? '(current)' : ''}</div><div class="when">${fdate(day(-i * 9 - 1))}, ${esc(D.advocates[i % 3].name)}</div></div>`).join('')}</div>`,
    foot: `<button class="btn" onclick="toast('AI summary: ${esc(c.desc).replace(/'/g, '')}', 'info', {ms:7000})">${I('sparkle', 'sm')}Summarise</button><button class="btn" onclick="toast('Download started: ${esc(d.name).replace(/'/g, '')}')">${I('download', 'sm')}Download</button><button class="btn primary" data-close>Done</button>`,
  });
}

/* ---------- Boot ---------- */
window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', () => { if (!location.hash) location.hash = session.authed ? '#/' : '#/login'; router(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeBtn);
