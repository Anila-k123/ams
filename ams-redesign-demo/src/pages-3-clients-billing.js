/* ==========================================================================
   PAGES 3: Clients, client detail, documents, invoices, payments, expenses,
   reports. Wrapped in an IIFE so helper names never collide with the other
   page files (all page files share one global scope). Everything is wired by
   event delegation, never inline onclick, for the same reason.
   ========================================================================== */
(() => {
  /* Small page-local styles; tokens only so light and dark both work. */
  document.head.insertAdjacentHTML('beforeend', `<style>
    .p3-bad { color: var(--bad); }
    .p3-ok { color: var(--ok); }
    .p3-head-panel { display: flex; gap: var(--s4); align-items: flex-start; flex-wrap: wrap; }
    .p3-head-panel h1 { font-size: var(--t-2xl); margin: 2px 0 6px; }
    .p3-tile-wrap { position: relative; }
    .p3-tile-wrap .p3-tile-more { position: absolute; top: 6px; right: 6px; background: var(--surface); }
    .p3-inv { font-size: var(--t-sm); }
    .p3-inv .p3-inv-top { display: flex; justify-content: space-between; gap: var(--s4); flex-wrap: wrap; padding-bottom: var(--s4); border-bottom: 2px solid var(--ink); }
    .p3-inv h3 { font: 500 var(--t-xl) var(--f-display); }
    .p3-inv .p3-box { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s4); margin: var(--s4) 0; }
    .p3-inv .p3-tot { margin-left: auto; max-width: 320px; margin-top: var(--s3); }
    .p3-inv .p3-words { margin-top: var(--s3); padding: var(--s3); background: var(--surface-2); border-radius: var(--r-md); }
    .p3-storage { display: flex; align-items: center; gap: var(--s3); font-size: var(--t-sm); color: var(--ink-2); margin-bottom: var(--s4); flex-wrap: wrap; }
    .p3-storage .meter { width: 160px; }
    @media (max-width: 768px) { .p3-inv .p3-box { grid-template-columns: 1fr; } }
  </style>`);

  /* ---------- shared helpers ---------- */
  const redraw = () => router();
  const sum = (arr, f) => arr.reduce((s, x) => s + (f ? f(x) : x), 0);
  const clientCases = (id) => D.cases.filter(c => c.client === +id);
  const outstanding = (id) => sum(clientCases(id), c => Math.max(0, c.fee - c.paid));
  const moreBtn = (id, label) => `<button class="btn ghost sm icon" data-pop data-more="${id}" aria-label="Actions for ${esc(label)}">${I('more', 'sm')}</button>`;
  const figures = (items) => `<div class="figures" style="margin-bottom:var(--s5)">${items.map(([lbl, val, meta, cls]) => `<div class="figure"><div class="lbl">${lbl}</div><div class="val ${cls || ''}">${val}</div>${meta ? `<div class="meta">${meta}</div>` : ''}</div>`).join('')}</div>`;
  const barRows = (rows, color = 'var(--ink)') => { const max = Math.max(1, ...rows.map(r => r[1])); return rows.map(([l, v, disp]) => `<div class="bar-row"><span class="ellipsis" title="${esc(l)}">${esc(l)}</span><div class="bar-track" role="img" aria-label="${esc(l)}: ${esc(disp ?? v)}"><i style="width:${(v / max * 100).toFixed(1)}%;background:${color}"></i></div><span class="num right">${disp ?? v}</span></div>`).join(''); };
  const seg = (name, opts, cur, label) => `<div class="seg" data-seg="${name}" role="group" aria-label="${label}">${opts.map(([v, l]) => `<button data-v="${v}" aria-pressed="${v === cur}">${l}</button>`).join('')}</div>`;
  const pageHead = (title, sub, actions) => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="actions">${actions || ''}</div></div>`;
  const caseCell = (c) => c ? `<a class="link mono small" href="#/cases/${c.id}">${esc(c.no)}</a>` : '<span class="faint">None</span>';
  const tryPrint = () => { try { window.print(); } catch (e) { toast('Printing is blocked in this window. Use Download PDF instead.', 'warn'); } };
  /* Delegated "more" menus: rowsById maps data-more id to a row */
  const wireMore = (root, find, items) => root.addEventListener('click', e => { const b = e.target.closest('[data-more]'); if (!b) return; e.stopPropagation(); const r = find(b.dataset.more); if (r) popMenu(b, items(r)); });

  /* Effective invoice status: an unpaid invoice past its due date is overdue. */
  const invStatus = (i) => i.status === 'Unpaid' && daysFrom(i.due) < 0 ? 'Overdue' : i.status;

  /* Amount in words, Indian system (crore, lakh, thousand). */
  const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (n) => n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '');
  const words = (n) => {
    n = Math.round(n); if (!n) return 'Zero';
    const cr = Math.floor(n / 1e7); n %= 1e7; const lk = Math.floor(n / 1e5); n %= 1e5; const th = Math.floor(n / 1e3); n %= 1e3; const h = Math.floor(n / 100); n %= 100;
    let s = '';
    if (cr) s += words(cr) + ' Crore '; if (lk) s += two(lk) + ' Lakh '; if (th) s += two(th) + ' Thousand '; if (h) s += ONES[h] + ' Hundred ';
    if (n) s += (s ? 'and ' : '') + two(n);
    return s.trim();
  };
  const rupeesInWords = (n) => 'Rupees ' + words(n) + ' only';

  /* ---------- shared dialogs ---------- */
  function portalDialog(c, after) {
    modal({
      title: 'Client portal access', sub: esc(c.name), size: 'narrow',
      body: `<div class="stack" style="gap:14px">
        <label class="switch"><input type="checkbox" id="pt-on" ${c.portal ? 'checked' : ''}> Portal access enabled</label>
        <table class="t"><thead><tr><th scope="col">Login</th><th scope="col">Status</th></tr></thead><tbody>
          <tr><td class="small">${esc(c.email)}</td><td>${c.portal ? chip('Active', 'ok') : chip('Off', '')}</td></tr></tbody></table>
        <p class="faint xs">The client sees their own cases, hearings, invoices and documents you mark as shared.</p></div>`,
      foot: `<button class="btn ghost" data-close>Close</button><button class="btn primary" id="pt-inv">${I('send', 'sm')}Send invite link (valid 72 hours)</button>`,
      onMount(el, close) {
        el.querySelector('#pt-on').onchange = (e) => { c.portal = e.target.checked; toast(c.portal ? `Portal enabled for ${esc(c.name)}` : `Portal access turned off for ${esc(c.name)}`, 'ok'); after && after(); };
        el.querySelector('#pt-inv').onclick = (e) => busy(e.currentTarget, () => { c.portal = true; close(); toast(`Invite link sent to ${esc(c.email)}. It expires in 72 hours.`, 'ok'); after && after(); });
      },
    });
  }
  const clientMenu = (c) => [
    { label: 'Open', icon: 'eye', onClick: () => go('/clients/' + c.id) },
    { label: 'Edit', icon: 'edit', onClick: () => FORMS.client(c, redraw) },
    { label: 'Portal logins', icon: 'key', onClick: () => portalDialog(c, redraw) },
    '-',
    c.archived
      ? { label: 'Restore', icon: 'restore', onClick: () => { c.archived = false; toast(`Restored ${esc(c.name)}`, 'ok'); redraw(); } }
      : { label: 'Archive', icon: 'archive', danger: true, onClick: () => confirmDialog({ title: 'Archive this client?', text: `${esc(c.name)} will be hidden from lists. Their cases, invoices and documents stay as they are. You can restore the client later.`, confirm: 'Archive client', danger: true, onConfirm: () => { c.archived = true; toast(`Archived ${esc(c.name)}`, 'ok', { action: { label: 'Show archived', href: '#/clients?archived=1' } }); redraw(); } }) },
  ];

  /* ==========================================================================
     /clients: client list
     ========================================================================== */
  let showArchived = false;
  page('/clients', {
    title: 'Clients', perm: 'CLIENT_VIEW', skeleton: 'table',
    render: () => `${pageHead('Clients', `${D.clients.filter(c => !c.archived).length} clients. Outstanding is unpaid fees across their matters.`, can('CLIENT_CREATE') ? `<button class="btn primary" id="cl-add">${I('plus', 'sm')}Add client</button>` : '')}<div id="cl-tbl"></div>`,
    mount(root) {
      if (query().get('archived')) showArchived = true;
      const add = root.querySelector('#cl-add'); if (add) add.onclick = () => FORMS.client(null, redraw);
      const advs = D.advocates.filter(a => a.role.includes('Advocate')).map(a => a.name);
      DataTable(root.querySelector('#cl-tbl'), {
        rowsFn: () => D.clients.filter(c => showArchived || !c.archived),
        search: { placeholder: 'Search name, phone, email or city', keys: ['name', 'phone', 'email', 'city', 'district'] },
        filters: [
          { label: 'Type', options: ['Individual', 'Company'], key: 'kind' },
          { label: 'Advocate', options: advs, test: (r, v) => (advById(r.advocate) || {}).name === v },
          { label: 'Portal', options: ['Enabled', 'Off'], test: (r, v) => (v === 'Enabled') === !!r.portal },
        ],
        toolbarExtra: `<button class="filter-chip" id="cl-arch" aria-pressed="${showArchived}">${I('archive', 'sm')}Show archived</button>`,
        columns: [
          { key: 'name', label: 'Client', sort: true, render: c => `<div class="row" style="gap:10px">${avatar(c.name, 'sm')}<div><div class="cell-title">${esc(c.name)}${c.archived ? ' ' + chip('Archived', '') : ''}</div><div class="cell-sub">${esc(c.kind)}</div></div></div>` },
          { key: 'phone', label: 'Contact', render: c => `<div class="small nowrap">${esc(c.phone)}</div><div class="cell-sub">${esc(c.email)}</div>`, hideSm: true },
          { key: 'city', label: 'Location', sort: true, render: c => `${esc(c.city)}<div class="cell-sub">${esc(c.district)}</div>`, hideSm: true },
          { key: 'advocate', label: 'Handling advocate', sort: c => (advById(c.advocate) || {}).name, render: c => esc((advById(c.advocate) || {}).name || '—'), hideSm: true },
          { key: 'm', label: 'Matters', cls: 'amt', sort: c => clientCases(c.id).filter(x => x.status !== 'Closed').length, render: c => `<span class="num">${clientCases(c.id).filter(x => x.status !== 'Closed').length}</span>` },
          { key: 'o', label: 'Outstanding', cls: 'amt', sort: c => outstanding(c.id), render: c => { const o = outstanding(c.id); return `<span class="mono">${o ? inr(o) : '<span class="faint">Nil</span>'}</span>`; } },
          { key: 'portal', label: 'Portal', render: c => c.portal ? chip('Enabled', 'ok') : chip('Off', ''), hideSm: true },
          { key: 'a', label: '<span class="sr-only">Actions</span>', cls: 'actions', render: c => moreBtn(c.id, c.name) },
        ],
        initialSort: { key: 'name', dir: 'asc' },
        onRow: c => go('/clients/' + c.id),
        empty: { icon: 'users', title: 'No clients yet', text: 'Add your first client to open matters and raise invoices.' },
      });
      const chipBtn = root.querySelector('#cl-arch');
      chipBtn.onclick = () => { showArchived = !showArchived; redraw(); };
      wireMore(root, id => clientById(id), clientMenu);
    },
  });

  /* ==========================================================================
     /clients/:id: client detail
     ========================================================================== */
  const docTile = (d) => `<div class="p3-tile-wrap"><div class="doc-tile" role="button" tabindex="0" data-doc="${d.id}" aria-label="Preview ${esc(d.name)}">
      <div class="sheet"><span class="ext">${esc(d.ext)}</span><div class="pg">${'<i></i>'.repeat(6)}</div></div>
      <div class="body"><div class="name">${esc(d.name)}</div><div class="mono xs faint ellipsis" style="margin-top:4px">${esc(caseById(d.caseId).no)}</div>
      <div class="row between xs muted" style="margin-top:6px"><span>${esc(d.cat)}</span><span class="mono">v${d.version}</span></div>
      <div class="row between xs faint" style="margin-top:6px"><span>${sizeFmt(d.kb)}, ${fdateShort(d.date)}</span>${d.shared ? chip('Shared', 'ok') : ''}${d.status === 'Archived' ? chip('Archived', '') : ''}</div></div></div>
      <button class="btn ghost sm icon p3-tile-more" data-pop data-more="${d.id}" aria-label="Actions for ${esc(d.name)}">${I('more', 'sm')}</button></div>`;
  const wireTiles = (root) => {
    root.addEventListener('click', e => { if (e.target.closest('[data-more]')) return; const t = e.target.closest('[data-doc]'); if (t) previewDoc(D.documents.find(d => d.id === +t.dataset.doc)); });
    root.addEventListener('keydown', e => { const t = e.target.closest('.doc-tile[data-doc]'); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); t.click(); } });
  };

  page('/clients/:id', {
    title: (p) => (clientById(p.id) || {}).name || 'Client not found', crumbs: [['Clients', '/clients']], skeleton: 'detail', perm: 'CLIENT_VIEW',
    render(p) {
      const c = clientById(p.id);
      if (!c) return emptyState({ icon: 'users', title: 'Client not found', text: 'This client may have been deleted, or the link is wrong.', action: '<a class="btn" href="#/clients">Back to clients</a>' });
      const cs = clientCases(c.id); const ids = cs.map(x => x.id);
      const active = cs.filter(x => x.status !== 'Closed');
      const next = D.events.filter(e => e.type === 'Hearing' && ids.includes(e.caseId) && e.at >= TODAY).sort((a, b) => a.at - b.at)[0];
      const invs = D.invoices.filter(i => i.client === c.id);
      const billed = sum(invs.filter(i => i.status !== 'Draft' && i.status !== 'Canceled'), i => i.total);
      const out = outstanding(c.id);
      const adv = advById(c.advocate);
      return `<div class="panel" style="margin-bottom:var(--s5)"><div class="panel-body" style="padding:var(--s6)"><div class="p3-head-panel">
          ${avatar(c.name, 'lg')}
          <div class="grow" style="min-width:220px">
            <div class="row wrap" style="gap:8px">${chip(c.kind, 'plain')}${c.archived ? chip('Archived', '') : ''}${c.portal ? chip('Portal enabled', 'ok') : ''}<span class="faint small">Client since ${fdate(c.since, { month: 'short', year: 'numeric' })}</span></div>
            <h1 class="serif">${esc(c.name)}</h1>
            <div class="meta-line"><span>${I('phone', 'sm')}${esc(c.phone)}</span><span>${I('mail', 'sm')}${esc(c.email)}</span><span>${I('pin', 'sm')}${esc([c.building, c.street, c.city, c.pin].filter(Boolean).join(', '))}</span>${adv ? `<span>${I('user', 'sm')}${esc(adv.name)}</span>` : ''}${c.gstin ? `<span class="mono">GSTIN ${esc(c.gstin)}</span>` : ''}</div>
          </div>
          <div class="row wrap" style="gap:8px">
            <button class="btn" id="cd-edit">${I('edit', 'sm')}Edit</button>
            <button class="btn" id="cd-portal">${I('globe', 'sm')}Portal access</button>
            <button class="btn" id="cd-inv">${I('receipt', 'sm')}Raise invoice</button>
            <button class="btn primary" id="cd-case">${I('plus', 'sm')}New case</button>
          </div></div></div></div>
        ${figures([
          ['Active matters', active.length, `${cs.length} in total`],
          ['Next hearing', next ? `<span style="font-size:.7em">${rel(next.at)}</span>` : '<span class="faint" style="font-size:.7em">None listed</span>', next ? `<span class="mono">${esc(next.title)}</span>` : ''],
          ['Billed', inrShort(billed), `${invs.length} invoices`],
          ['Outstanding', inrShort(out), out ? 'Unpaid fees on matters' : 'All fees paid', out ? '' : ''],
        ])}
        <div data-tab-scope>
          <div class="tabs" data-tabs aria-label="Client sections">
            <button data-tab="m" aria-selected="true">Matters <span class="faint">${cs.length}</span></button>
            <button data-tab="h">Hearings</button>
            <button data-tab="i">Invoices and payments</button>
            <button data-tab="d">Documents <span class="faint">${D.documents.filter(d => d.client === c.id).length}</span></button>
            <button data-tab="c">Communication</button>
            <button data-tab="n">Notes</button>
          </div>
          <div class="tab-panel" data-panel="m"><div id="cd-m"></div></div>
          <div class="tab-panel" data-panel="h"><div id="cd-h"></div></div>
          <div class="tab-panel" data-panel="i"><h3 style="margin-bottom:10px">Invoices</h3><div id="cd-i"></div><h3 style="margin:24px 0 10px">Payments</h3><div id="cd-p"></div></div>
          <div class="tab-panel" data-panel="d"><div id="cd-d"></div></div>
          <div class="tab-panel" data-panel="c"><div id="cd-c"></div></div>
          <div class="tab-panel" data-panel="n"><div id="cd-n"></div></div>
        </div>`;
    },
    mount(root, p) {
      const c = clientById(p.id); if (!c) return;
      const cs = clientCases(c.id); const ids = cs.map(x => x.id);
      root.querySelector('#cd-edit').onclick = () => FORMS.client(c, redraw);
      root.querySelector('#cd-portal').onclick = () => portalDialog(c, redraw);
      root.querySelector('#cd-inv').onclick = () => FORMS.invoice({ caseId: (cs.find(x => x.status !== 'Closed') || {}).id, onSave: redraw });
      root.querySelector('#cd-case').onclick = () => go('/cases/new');

      DataTable(root.querySelector('#cd-m'), {
        rows: cs, onRow: x => go('/cases/' + x.id),
        columns: [
          { key: 'no', label: 'Case', sort: true, render: x => `<div class="mono small cell-title">${esc(x.no)}</div><div class="cell-sub">${esc(x.title)}</div>` },
          { key: 'courtName', label: 'Court', render: x => `${esc(x.courtName)}<div class="cell-sub">${esc(x.hall || '')}</div>`, hideSm: true },
          { key: 'stage', label: 'Stage', hideSm: true },
          { key: 'next', label: 'Next hearing', sort: x => x.next ? +x.next : 9e15, render: x => x.next ? rel(x.next) : '<span class="faint">None</span>' },
          { key: 'bal', label: 'Fee due', cls: 'amt', render: x => `<span class="mono">${x.fee - x.paid ? inr(x.fee - x.paid) : '<span class="faint">Nil</span>'}</span>` },
          { key: 'status', label: 'Status', render: x => chip(x.status) },
        ],
        empty: { icon: 'case', title: 'No matters yet', text: 'Open a case for this client to start tracking hearings.' },
      });

      const evs = D.events.filter(e => ids.includes(e.caseId) && e.at >= TODAY).sort((a, b) => a.at - b.at);
      DataTable(root.querySelector('#cd-h'), {
        rows: evs, onRow: e => go('/cases/' + e.caseId),
        columns: [
          { key: 'at', label: 'When', sort: e => +e.at, render: e => `<b>${rel(e.at)}</b><div class="cell-sub">${fdate(e.at)}, ${ftime(e.at)}</div>` },
          { key: 'type', label: 'Type', render: e => chip(e.type, e.type === 'Hearing' ? 'info' : 'plain') },
          { key: 'title', label: 'Matter', render: e => `<span class="${e.type === 'Hearing' ? 'mono small' : ''}">${esc(e.title)}</span>` },
          { key: 'court', label: 'Court', render: e => `${esc(e.court)}<div class="cell-sub">${esc(e.hall || '')}</div>`, hideSm: true },
          { key: 'purpose', label: 'Purpose', hideSm: true },
        ],
        empty: { icon: 'calendar', title: 'No upcoming hearings', text: 'Nothing is listed for this client\'s matters.' },
      });

      DataTable(root.querySelector('#cd-i'), {
        rows: D.invoices.filter(i => i.client === c.id), onRow: i => go('/invoices?id=' + i.id),
        columns: [
          { key: 'no', label: 'Invoice no', render: i => `<span class="mono small">${esc(i.no)}</span>` },
          { key: 'case', label: 'Case', render: i => caseCell(caseById(i.caseId)), hideSm: true },
          { key: 'date', label: 'Date', sort: i => +i.date, render: i => fdate(i.date) },
          { key: 'total', label: 'Total', cls: 'amt', render: i => `<span class="mono">${inr(i.total)}</span>` },
          { key: 'status', label: 'Status', render: i => chip(invStatus(i)) },
        ],
        empty: { icon: 'receipt', title: 'No invoices yet' },
      });
      DataTable(root.querySelector('#cd-p'), {
        rows: D.payments.filter(x => x.client === c.id), initialSort: { key: 'date', dir: 'desc' },
        columns: [
          { key: 'date', label: 'Date', sort: x => +x.date, render: x => fdate(x.date) },
          { key: 'case', label: 'Case', render: x => caseCell(caseById(x.caseId)), hideSm: true },
          { key: 'mode', label: 'Mode', render: x => chip(x.mode, 'plain') },
          { key: 'ref', label: 'Reference', render: x => `<span class="mono xs">${esc(x.ref || '—')}</span>`, hideSm: true },
          { key: 'amount', label: 'Amount', cls: 'amt', render: x => `<span class="mono">${inr(x.amount)}</span>` },
        ],
        empty: { icon: 'rupee', title: 'No payments recorded' },
      });

      const drawDocs = () => {
        const docs = D.documents.filter(d => d.client === c.id);
        const box = root.querySelector('#cd-d');
        box.innerHTML = docs.length ? `<div class="doc-grid">${docs.map(d => `<div>${docTile(d)}<label class="switch xs" style="margin-top:8px"><input type="checkbox" data-share="${d.id}" ${d.shared ? 'checked' : ''}> Shared with client</label></div>`).join('')}</div>`
          : emptyState({ icon: 'folder', title: 'No documents', text: 'Upload documents against this client\'s matters.' });
      };
      drawDocs();
      const dbox = root.querySelector('#cd-d');
      wireTiles(dbox);
      wireMore(dbox, id => D.documents.find(d => d.id === +id), d => docMenu(d, drawDocs));
      dbox.addEventListener('change', e => { const s = e.target.closest('[data-share]'); if (!s) return; const d = D.documents.find(x => x.id === +s.dataset.share); d.shared = s.checked; toast(d.shared ? `${esc(d.name)} is now visible on the client portal` : `${esc(d.name)} is no longer shared`, 'ok'); drawDocs(); });

      const log = D.deliveryLog.filter(x => x.name === c.name).map(x => ({ at: x.at, ch: x.channel, subject: x.subject, status: x.status }));
      const portal = c.id === 1 ? D.messages.map(m => ({ at: m.at, ch: 'Portal message', subject: m.subject, status: 'Sent', body: m.body })) : [];
      const msgs = [...log, ...portal].sort((a, b) => b.at - a.at);
      root.querySelector('#cd-c').innerHTML = msgs.length ? `<div class="panel"><div class="list">${msgs.map(m => `<div class="list-item"><div class="row between wrap" style="gap:8px"><div><b class="small">${esc(m.subject)}</b><div class="faint xs">${esc(m.ch)}, ${fdt(m.at)}</div></div>${chip(m.status)}</div>${m.body ? `<p class="small muted" style="margin-top:6px;white-space:pre-line">${esc(m.body)}</p>` : ''}</div>`).join('')}</div></div>`
        : emptyState({ icon: 'send', title: 'No messages sent', text: 'Hearing reminders, receipts and portal messages to this client appear here.' });

      const nbox = root.querySelector('#cd-n');
      nbox.innerHTML = `<div class="panel"><div class="panel-body stack" style="gap:12px">
        ${c.note ? `<p style="white-space:pre-line">${esc(c.note)}</p>` : '<p class="faint">No notes yet.</p>'}
        <div class="field"><label for="cd-note">Add a note</label><textarea id="cd-note" class="input" rows="3" placeholder="Referral, preferences, matter background"></textarea></div>
        <div><button class="btn primary sm" id="cd-note-save">Save note</button></div></div></div>`;
      nbox.querySelector('#cd-note-save').onclick = (e) => { const v = nbox.querySelector('#cd-note').value.trim(); if (!v) { toast('Write something first', 'warn'); return; } busy(e.currentTarget, () => { c.note = (c.note ? c.note + '\n\n' : '') + v; toast('Note saved', 'ok'); redraw(); }); };
    },
  });

  /* ==========================================================================
     /documents
     ========================================================================== */
  const docState = { view: 'grid', q: '', cat: '', type: '', status: 'Active', shared: false };
  const TYPE_EXT = { PDF: ['pdf'], Word: ['doc', 'docx'], Image: ['jpg', 'jpeg', 'png'], ZIP: ['zip'] };
  function docMenu(d, after) {
    return [
      { label: 'Preview', icon: 'eye', onClick: () => previewDoc(d) },
      { label: 'Summarise', icon: 'sparkle', onClick: () => toast(`<b>AI summary of ${esc(d.name)}.</b> ${esc(caseById(d.caseId).desc)} Filed in ${esc(caseById(d.caseId).no)}.`, 'info', { ms: 8000 }) },
      { label: 'Versions', icon: 'history', onClick: () => drawer({ title: 'Version history', sub: esc(d.name), body: `<div class="timeline">${Array.from({ length: d.version }, (_, i) => `<div class="tl-item ${i === 0 ? 'key' : ''}"><div class="small"><b class="mono">v${d.version - i}</b> ${i === 0 ? '(current)' : ''}</div><div class="when">${fdate(day(-i * 9 - 1 - (d.id % 5)))}, uploaded by ${esc(i === 0 ? d.by : D.advocates[(d.id + i) % 3].name)}</div></div>`).join('')}</div>`, foot: '<button class="btn primary" data-close>Done</button>' }) },
      { label: 'Rename', icon: 'edit', onClick: () => modal({ title: 'Rename document', size: 'narrow', body: `<form id="rn" novalidate>${field({ id: 'rn-n', label: 'File name', value: d.name, required: true, err: 'Enter a file name.' })}</form>`, foot: '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="rn-s">Rename</button>', onMount(el, close) { el.querySelector('#rn-s').onclick = () => { if (!validateForm(el.querySelector('#rn'))) return; d.name = el.querySelector('#rn-n').value.trim(); close(); toast('Document renamed', 'ok'); after(); }; } }) },
      { label: d.shared ? 'Stop sharing with client' : 'Share with client', icon: 'globe', onClick: () => { d.shared = !d.shared; toast(d.shared ? `Shared ${esc(d.name)} on the client portal` : `${esc(d.name)} is no longer shared`, 'ok'); after(); } },
      '-',
      d.status === 'Archived'
        ? { label: 'Restore', icon: 'restore', onClick: () => { d.status = 'Active'; toast('Document restored', 'ok'); after(); } }
        : { label: 'Archive', icon: 'archive', onClick: () => { d.status = 'Archived'; toast(`Archived ${esc(d.name)}`, 'ok'); after(); } },
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => confirmDialog({ title: 'Delete this document?', text: `${esc(d.name)} and all ${d.version} version${d.version > 1 ? 's' : ''} will be removed. This can't be undone.`, confirm: 'Delete document', danger: true, onConfirm: () => { D.documents.splice(D.documents.indexOf(d), 1); toast('Document deleted', 'ok'); after(); } }) },
    ];
  }
  const filteredDocs = () => D.documents.filter(d => {
    const c = caseById(d.caseId); const cl = clientById(d.client);
    if (docState.q && !`${d.name} ${d.cat} ${c.no} ${cl.name}`.toLowerCase().includes(docState.q.toLowerCase())) return false;
    if (docState.cat && d.cat !== docState.cat) return false;
    if (docState.type && !TYPE_EXT[docState.type].includes(d.ext)) return false;
    if (docState.status && d.status !== docState.status) return false;
    if (docState.shared && !d.shared) return false;
    return true;
  });
  page('/documents', {
    title: 'Documents', perm: 'DOCUMENT_VIEW', skeleton: 'cards',
    render() {
      const q = query().get('q'); if (q != null) { docState.q = q; docState.status = ''; }
      const total = sum(D.documents, d => d.kb); const pct = total / (10 * 1024 * 1024) * 100;
      const sel = (id, label, opts, v) => `<select class="input" id="${id}" aria-label="${label}"><option value="">${label}: All</option>${opts.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      return `${pageHead('Documents', 'Pleadings, orders, evidence and client papers across all matters.', can('DOCUMENT_UPLOAD') ? `<button class="btn primary" id="dc-up">${I('upload', 'sm')}Upload</button>` : '')}
        <div class="p3-storage"><span><b class="num">${D.documents.length}</b> files, <b class="num">${sizeFmt(total)}</b> used of 10 GB</span><div class="meter" role="meter" aria-valuenow="${pct.toFixed(1)}" aria-valuemin="0" aria-valuemax="100" aria-label="Storage used"><i style="width:${Math.max(pct, 1.5)}%;background:var(--ink)"></i></div></div>
        <div class="toolbar">
          <div class="input-icon">${I('search', 'sm')}<input class="input" id="dc-q" type="search" placeholder="Search file, case or client" aria-label="Search documents" value="${esc(docState.q)}"></div>
          ${sel('dc-cat', 'Category', D.docCategories, docState.cat)}
          ${sel('dc-type', 'Type', Object.keys(TYPE_EXT), docState.type)}
          ${sel('dc-st', 'Status', ['Active', 'Archived'], docState.status)}
          <button class="filter-chip" id="dc-sh" aria-pressed="${docState.shared}">${I('globe', 'sm')}Shared with client</button>
          <span class="grow"></span>
          ${seg('dview', [['grid', `${I('grid', 'sm')}<span class="sr-only">Grid</span>`], ['list', `${I('rows', 'sm')}<span class="sr-only">List</span>`]], docState.view, 'View')}
        </div>
        <div id="dc-body"></div>`;
    },
    mount(root) {
      const up = root.querySelector('#dc-up'); if (up) up.onclick = () => FORMS.upload({ onSave: redraw });
      const body = root.querySelector('#dc-body');
      const draw = () => {
        const docs = filteredDocs();
        const empty = emptyState({ icon: 'folder', title: 'No documents match', text: 'Try another category or type, or clear the filters.', action: '<button class="btn sm" id="dc-clear">Clear filters</button>' });
        if (docState.view === 'grid') {
          body.innerHTML = docs.length ? `<div class="doc-grid">${docs.map(docTile).join('')}</div>` : empty;
        } else {
          body.innerHTML = '<div id="dc-tbl"></div>';
          DataTable(body.querySelector('#dc-tbl'), {
            rows: docs, pageSize: 12, onRow: d => previewDoc(d), initialSort: { key: 'date', dir: 'desc' },
            columns: [
              { key: 'name', label: 'Name', sort: true, render: d => `<div class="row" style="gap:8px">${I(docIcon(d.ext), 'sm')}<span class="cell-title ellipsis" style="max-width:280px">${esc(d.name)}</span></div>` },
              { key: 'cat', label: 'Category', sort: true, hideSm: true },
              { key: 'case', label: 'Case', render: d => caseCell(caseById(d.caseId)) },
              { key: 'client', label: 'Client', render: d => esc(clientById(d.client).name), hideSm: true },
              { key: 'kb', label: 'Size', sort: true, cls: 'amt', render: d => `<span class="mono xs">${sizeFmt(d.kb)}</span>`, hideSm: true },
              { key: 'date', label: 'Uploaded', sort: d => +d.date, render: d => `${fdate(d.date)}<div class="cell-sub">${esc(d.by)}</div>`, hideSm: true },
              { key: 'version', label: 'Version', render: d => `<span class="mono xs">v${d.version}</span>`, hideSm: true },
              { key: 'shared', label: 'Shared', render: d => d.shared ? chip('Shared', 'ok') : '<span class="faint small">Private</span>' },
              { key: 'a', label: '<span class="sr-only">Actions</span>', cls: 'actions', render: d => moreBtn(d.id, d.name) },
            ],
            empty: { icon: 'folder', title: 'No documents match', text: 'Clear the filters above to see everything.' },
          });
        }
        const clr = body.querySelector('#dc-clear');
        if (clr) clr.onclick = () => { Object.assign(docState, { q: '', cat: '', type: '', status: 'Active', shared: false }); if (query().get('q') != null) go('/documents'); else redraw(); };
      };
      draw();
      wireTiles(body);
      wireMore(body, id => D.documents.find(d => d.id === +id), d => docMenu(d, () => redraw()));
      root.querySelector('#dc-q').addEventListener('input', e => { docState.q = e.target.value.trim(); draw(); });
      root.querySelector('#dc-cat').onchange = e => { docState.cat = e.target.value; draw(); };
      root.querySelector('#dc-type').onchange = e => { docState.type = e.target.value; draw(); };
      root.querySelector('#dc-st').onchange = e => { docState.status = e.target.value; draw(); };
      root.querySelector('#dc-sh').onclick = e => { docState.shared = !docState.shared; e.currentTarget.setAttribute('aria-pressed', docState.shared); draw(); };
      root.addEventListener('segchange', e => { if (e.target.dataset.seg === 'dview') { docState.view = e.detail; draw(); } });
    },
  });

  /* ==========================================================================
     /invoices
     ========================================================================== */
  let invFilter = 'all';
  function invoiceDrawer(i) {
    const c = caseById(i.caseId); const cl = clientById(i.client); const f = D.firm; const b = f.bank;
    const st = invStatus(i);
    drawer({
      title: `Invoice <span class="mono">${esc(i.no)}</span>`, sub: `${esc(cl.name)}, ${chip(st)}`, wide: true,
      body: `<div class="p3-inv">
        <div class="p3-inv-top"><div><h3>${esc(f.name)}</h3><div class="muted">${esc(f.address)}</div><div class="muted">${esc(f.phone)}, ${esc(f.email)}</div><div class="mono xs" style="margin-top:6px">GSTIN ${esc(f.gstin)}<br>PAN ${esc(f.pan)}</div></div>
          <div style="text-align:right"><div class="serif" style="font-size:var(--t-2xl)">Tax invoice</div><dl class="kv" style="margin-top:8px;text-align:left"><dt>Invoice no</dt><dd class="mono">${esc(i.no)}</dd><dt>Date</dt><dd>${fdate(i.date)}</dd><dt>Due</dt><dd>${fdate(i.due)}</dd><dt>Place of supply</dt><dd>Tamil Nadu (33)</dd></dl></div></div>
        <div class="p3-box"><div><div class="faint xs">Bill to</div><b>${esc(cl.name)}</b><div class="muted">${esc([cl.building, cl.street, cl.city, cl.pin].filter(Boolean).join(', '))}</div>${cl.gstin ? `<div class="mono xs">GSTIN ${esc(cl.gstin)}</div>` : '<div class="faint xs">Unregistered</div>'}</div>
          <div><div class="faint xs">Matter</div><b class="mono">${esc(c.no)}</b><div class="muted">${esc(c.title)}</div><div class="muted">${esc(c.courtName)}</div></div></div>
        <div class="table-wrap"><table class="t"><thead><tr><th scope="col">#</th><th scope="col">Particulars</th><th scope="col">SAC</th><th scope="col" class="amt">Amount</th></tr></thead><tbody>
          ${i.items.map((it, n) => `<tr><td>${n + 1}</td><td>${esc(it.d)}</td><td class="mono xs">${esc(b.hsn)}</td><td class="amt mono">${inr(it.a)}</td></tr>`).join('')}</tbody></table></div>
        <dl class="kv p3-tot" style="grid-template-columns:1fr auto"><dt>Taxable value</dt><dd class="mono right">${inr(i.taxable)}</dd><dt>CGST 9%</dt><dd class="mono right">${inr(i.gst / 2)}</dd><dt>SGST 9%</dt><dd class="mono right">${inr(i.gst / 2)}</dd><dt style="color:var(--ink);font-weight:600">Total</dt><dd class="right" style="font:500 var(--t-xl) var(--f-display)">${inr(i.total)}</dd></dl>
        <div class="p3-words"><span class="faint xs">Amount in words</span><div><b>${rupeesInWords(i.total)}</b></div></div>
        <div style="margin-top:var(--s4)"><div class="faint xs" style="margin-bottom:4px">Bank details</div><dl class="kv"><dt>In favour of</dt><dd>${esc(b.favour)}</dd><dt>Bank</dt><dd>${esc(b.name)}, ${esc(b.branch)}</dd><dt>Account no</dt><dd class="mono">${esc(b.account)}</dd><dt>IFSC</dt><dd class="mono">${esc(b.ifsc)}</dd><dt>MICR</dt><dd class="mono">${esc(b.micr)}</dd><dt>HSN / SAC</dt><dd class="mono">${esc(b.hsn)}, ${esc(b.category.charAt(0) + b.category.slice(1).toLowerCase())}</dd></dl></div>
        <p class="faint xs" style="margin-top:var(--s4)">This is a computer generated invoice. Subject to Chennai jurisdiction.</p></div>`,
      foot: `<button class="btn" id="iv-pdf">${I('download', 'sm')}Download PDF</button><button class="btn primary" id="iv-send">${I('send', 'sm')}Send to client</button>`,
      onMount(el) {
        el.querySelector('#iv-pdf').onclick = () => toast(`Downloading ${esc(i.no)}.pdf`, 'ok');
        el.querySelector('#iv-send').onclick = (e) => busy(e.currentTarget, () => toast(`Invoice ${esc(i.no)} emailed to ${esc(cl.email)}`, 'ok'));
      },
    });
  }
  function markPaid(i) {
    FORMS.payment({ caseId: i.caseId, onSave: redraw });
    // Preselect the invoice and amount in the shared payment form.
    setTimeout(() => { const s = document.querySelector('#p-inv'); const a = document.querySelector('#p-amt'); if (s) s.value = i.id; if (a) a.value = i.total; }, 0);
  }
  const invMenu = (i) => {
    const st = invStatus(i); const open = st === 'Unpaid' || st === 'Overdue';
    return [
      { label: 'View', icon: 'eye', onClick: () => invoiceDrawer(i) },
      ...(open ? [{ label: 'Mark paid', icon: 'check', onClick: () => markPaid(i) }, { label: 'Send reminder', icon: 'mail', onClick: () => toast(`Payment reminder for ${esc(i.no)} sent to ${esc(clientById(i.client).email)}`, 'ok') }] : []),
      ...(i.status === 'Draft' ? [{ label: 'Raise invoice', icon: 'send', onClick: () => { i.status = 'Unpaid'; toast(`${esc(i.no)} raised`, 'ok'); redraw(); } }] : []),
      ...(i.status !== 'Paid' && i.status !== 'Canceled' ? ['-', { label: 'Cancel invoice', icon: 'x', danger: true, onClick: () => confirmDialog({ title: 'Cancel this invoice?', text: `${esc(i.no)} for ${inr(i.total)} will be marked cancelled. The number is not reused, as GST rules require.`, confirm: 'Cancel invoice', danger: true, onConfirm: () => { i.status = 'Canceled'; toast(`${esc(i.no)} cancelled`, 'ok'); redraw(); } }) }] : []),
    ];
  };
  page('/invoices', {
    title: 'Invoices', perm: 'INVOICE_VIEW', skeleton: 'table',
    render() {
      const live = D.invoices.filter(i => i.status !== 'Canceled');
      const paid = sum(live.filter(i => i.status === 'Paid'), i => i.total);
      const unpaid = live.filter(i => invStatus(i) === 'Unpaid'); const over = live.filter(i => invStatus(i) === 'Overdue'); const drafts = live.filter(i => i.status === 'Draft');
      return `${pageHead('Invoices', 'GST invoices for legal services, SAC 998212', can('INVOICE_CREATE') ? `<button class="btn primary" id="iv-new">${I('plus', 'sm')}Generate invoice</button>` : '')}
        ${figures([
          ['Collected', inrShort(paid), `${live.filter(i => i.status === 'Paid').length} paid invoices`],
          ['Unpaid', inrShort(sum(unpaid, i => i.total)), `${unpaid.length} not yet due`],
          ['Overdue', `<span class="p3-bad">${inrShort(sum(over, i => i.total))}</span>`, `${over.length} past due date`],
          ['Drafts', drafts.length, drafts.length ? inr(sum(drafts, i => i.total)) + ' not raised' : 'None'],
        ])}
        <div class="row" style="margin-bottom:var(--s3)">${seg('ivf', [['all', 'All'], ['Unpaid', 'Unpaid'], ['Overdue', 'Overdue'], ['Paid', 'Paid'], ['Draft', 'Drafts']], invFilter, 'Invoice status')}</div>
        <div id="iv-tbl"></div>`;
    },
    mount(root) {
      const nb = root.querySelector('#iv-new'); if (nb) nb.onclick = () => FORMS.invoice({ onSave: redraw });
      const t = DataTable(root.querySelector('#iv-tbl'), {
        rowsFn: () => D.invoices.filter(i => invFilter === 'all' || invStatus(i) === invFilter),
        search: { placeholder: 'Search invoice no, client or case', keys: ['no', i => clientById(i.client).name, i => caseById(i.caseId).no] },
        initialSort: { key: 'date', dir: 'desc' }, onRow: invoiceDrawer,
        columns: [
          { key: 'no', label: 'Invoice no', sort: true, render: i => `<span class="mono small">${esc(i.no)}</span>` },
          { key: 'client', label: 'Client', sort: i => clientById(i.client).name, render: i => esc(clientById(i.client).name) },
          { key: 'case', label: 'Case', render: i => caseCell(caseById(i.caseId)), hideSm: true },
          { key: 'date', label: 'Date', sort: i => +i.date, render: i => fdate(i.date), hideSm: true },
          { key: 'due', label: 'Due', sort: i => +i.due, render: i => { const s = invStatus(i); if (s === 'Overdue') return `<span class="p3-bad">${-daysFrom(i.due)} days overdue</span>`; if (s === 'Unpaid') return rel(i.due); return `<span class="faint">${fdate(i.due)}</span>`; } },
          { key: 'taxable', label: 'Taxable', cls: 'amt', sort: true, render: i => `<span class="mono">${inr(i.taxable)}</span>`, hideSm: true },
          { key: 'gst', label: 'GST', cls: 'amt', render: i => `<span class="mono">${inr(i.gst)}</span>`, hideSm: true },
          { key: 'total', label: 'Total', cls: 'amt', sort: true, render: i => `<span class="mono">${inr(i.total)}</span>` },
          { key: 'status', label: 'Status', sort: i => invStatus(i), render: i => chip(invStatus(i) === 'Canceled' ? 'Cancelled' : invStatus(i), invStatus(i) === 'Canceled' ? '' : undefined) },
          { key: 'a', label: '<span class="sr-only">Actions</span>', cls: 'actions', render: i => moreBtn(i.id, i.no) },
        ],
        empty: { icon: 'receipt', title: 'No invoices here', text: 'Generate an invoice against a case to bill a client.' },
      });
      root.addEventListener('segchange', e => { if (e.target.dataset.seg === 'ivf') { invFilter = e.detail; t.state.page = 1; t.refresh(); } });
      wireMore(root, id => D.invoices.find(i => i.id === +id), invMenu);
      const qid = query().get('id'); if (qid) { const i = D.invoices.find(x => x.id === +qid); if (i) invoiceDrawer(i); }
    },
  });

  /* ==========================================================================
     /payments
     ========================================================================== */
  page('/payments', {
    title: 'Payments', perm: 'PAYMENT_VIEW', skeleton: 'table',
    render() {
      const P = D.payments;
      const month = sum(P.filter(p => p.date.getMonth() === TODAY.getMonth() && p.date.getFullYear() === TODAY.getFullYear()), p => p.amount);
      const last30 = sum(P.filter(p => daysFrom(p.date) >= -30), p => p.amount);
      const adv = sum(P.filter(p => !p.invoice), p => p.amount);
      const byMode = D.paymentModes.map(m => [m, sum(P.filter(p => p.mode === m), p => p.amount), P.filter(p => p.mode === m).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]);
      const top = byMode.slice().sort((a, b) => b[2] - a[2])[0];
      return `${pageHead('Payments', 'Fees received from clients, against invoices or as advances.', can('PAYMENT_CREATE') ? `<button class="btn primary" id="pm-new">${I('plus', 'sm')}Record payment</button>` : '')}
        ${figures([
          ['Received this month', inrShort(month), fdate(TODAY, { month: 'long', year: 'numeric' })],
          ['Last 30 days', inrShort(last30), `${P.filter(p => daysFrom(p.date) >= -30).length} payments`],
          ['Advances held', inrShort(adv), 'Not yet adjusted to an invoice'],
          ['Most used mode', `<span style="font-size:.7em">${esc(top ? top[0] : '—')}</span>`, top ? `${top[2]} of ${P.length} payments` : ''],
        ])}
        <div class="split"><div id="pm-tbl"></div>
          <div class="panel"><div class="panel-head"><h3>By mode</h3><span class="sub">All time</span></div><div class="panel-body">${barRows(byMode.map(([m, v]) => [m, v, inrShort(v)]))}</div></div></div>`;
    },
    mount(root) {
      const nb = root.querySelector('#pm-new'); if (nb) nb.onclick = () => FORMS.payment({ onSave: redraw });
      const clients = [...new Set(D.payments.map(p => clientById(p.client).name))].sort();
      DataTable(root.querySelector('#pm-tbl'), {
        rows: D.payments, initialSort: { key: 'date', dir: 'desc' },
        search: { placeholder: 'Search reference or client', keys: ['ref', p => clientById(p.client).name] },
        filters: [{ label: 'Mode', options: D.paymentModes, key: 'mode' }, { label: 'Client', options: clients, test: (p, v) => clientById(p.client).name === v }],
        columns: [
          { key: 'date', label: 'Date', sort: p => +p.date, render: p => fdate(p.date) },
          { key: 'client', label: 'Client', sort: p => clientById(p.client).name, render: p => `<a class="link" href="#/clients/${p.client}">${esc(clientById(p.client).name)}</a>` },
          { key: 'case', label: 'Case', render: p => caseCell(caseById(p.caseId)), hideSm: true },
          { key: 'amount', label: 'Amount', sort: true, cls: 'amt', render: p => `<span class="mono">${inr(p.amount)}</span>` },
          { key: 'mode', label: 'Mode', render: p => chip(p.mode, 'plain'), hideSm: true },
          { key: 'ref', label: 'Reference', render: p => `<span class="mono xs">${esc(p.ref || '—')}</span>`, hideSm: true },
          { key: 'invoice', label: 'Against invoice', render: p => { const i = p.invoice && D.invoices.find(x => x.id === p.invoice); return i ? `<a class="link mono xs" href="#/invoices?id=${i.id}">${esc(i.no)}</a>` : `<span class="faint">${esc(p.note || 'Advance')}</span>`; } },
        ],
        empty: { icon: 'rupee', title: 'No payments yet', text: 'Record a payment when a client pays.' },
      });
    },
  });

  /* ==========================================================================
     /expenses
     ========================================================================== */
  let expView = 'case';
  function caseFinance(c) {
    const ex = D.expenses.filter(x => x.caseId === c.id); const py = D.payments.filter(x => x.caseId === c.id);
    const te = sum(ex, x => x.amount); const tp = sum(py, x => x.amount); const bal = tp - te;
    drawer({
      title: 'Case financial overview', sub: `<span class="mono">${esc(c.no)}</span>, ${esc(clientById(c.client).name)}`, wide: true,
      body: `${figures([['Received', inr(tp)], ['Expenses', inr(te)], ['Balance', `<span class="${bal < 0 ? 'p3-bad' : ''}">${inr(bal)}</span>`]])}
        <h4 style="margin-bottom:8px">Expenses</h4>
        ${ex.length ? `<div class="table-wrap"><table class="t"><thead><tr><th scope="col">Date</th><th scope="col">Title</th><th scope="col">Category</th><th scope="col" class="amt">Amount</th></tr></thead><tbody>${ex.map(x => `<tr><td class="nowrap">${fdate(x.date)}</td><td>${esc(x.title)}</td><td>${esc(x.cat)}</td><td class="amt mono">${inr(x.amount)}</td></tr>`).join('')}<tr><td colspan="3"><b>Total</b></td><td class="amt mono"><b>${inr(te)}</b></td></tr></tbody></table></div>` : '<p class="faint small">No expenses recorded.</p>'}
        <h4 style="margin:20px 0 8px">Payments received</h4>
        ${py.length ? `<div class="table-wrap"><table class="t"><thead><tr><th scope="col">Date</th><th scope="col">Mode</th><th scope="col">Reference</th><th scope="col" class="amt">Amount</th></tr></thead><tbody>${py.map(x => `<tr><td class="nowrap">${fdate(x.date)}</td><td>${esc(x.mode)}</td><td class="mono xs">${esc(x.ref || '—')}</td><td class="amt mono">${inr(x.amount)}</td></tr>`).join('')}<tr><td colspan="3"><b>Total</b></td><td class="amt mono"><b>${inr(tp)}</b></td></tr></tbody></table></div>` : '<p class="faint small">No payments recorded.</p>'}`,
      foot: `<button class="btn" id="cf-x">${I('wallet', 'sm')}Add expense</button><button class="btn primary" id="cf-p">${I('rupee', 'sm')}Record payment</button>`,
      onMount(el, close) {
        el.querySelector('#cf-x').onclick = () => { close(); FORMS.expense({ caseId: c.id, onSave: redraw }); };
        el.querySelector('#cf-p').onclick = () => { close(); FORMS.payment({ caseId: c.id, onSave: redraw }); };
      },
    });
  }
  function expenseReport(kind) {
    const list = D.expenses.filter(x => kind === 'today' ? daysFrom(x.date) === 0 : x.date.getMonth() === TODAY.getMonth() && x.date.getFullYear() === TODAY.getFullYear());
    // A thin month makes a thin demo; fall back to the last 90 days for the monthly view.
    const rows = kind === 'month' && list.length < 3 ? D.expenses.filter(x => daysFrom(x.date) >= -90) : list;
    const label = kind === 'today' ? `Today's expense report, ${fdate(TODAY)}` : `Monthly expense report, ${fdate(TODAY, { month: 'long', year: 'numeric' })}`;
    const cats = D.expenseCategories.map(ca => [ca, sum(rows.filter(x => x.cat === ca), x => x.amount)]).filter(x => x[1]);
    modal({
      title: label, size: 'wide',
      body: rows.length ? `${figures([['Total spent', inr(sum(rows, x => x.amount))], ['Entries', rows.length], ['Unpaid', inr(sum(rows.filter(x => x.status !== 'Paid'), x => x.amount))]])}
        <h4 style="margin-bottom:8px">By category</h4>${barRows(cats.map(([ca, v]) => [ca, v, inr(v)]))}
        <h4 style="margin:20px 0 8px">Entries</h4><div class="table-wrap"><table class="t"><thead><tr><th scope="col">Date</th><th scope="col">Title</th><th scope="col">Case</th><th scope="col">Mode</th><th scope="col" class="amt">Amount</th></tr></thead><tbody>
        ${rows.map(x => `<tr><td class="nowrap">${fdate(x.date)}</td><td>${esc(x.title)}</td><td class="mono xs">${esc(caseById(x.caseId).no)}</td><td>${esc(x.mode)}</td><td class="amt mono">${inr(x.amount)}</td></tr>`).join('')}
        <tr><td colspan="4"><b>Total</b></td><td class="amt mono"><b>${inr(sum(rows, x => x.amount))}</b></td></tr></tbody></table></div>`
        : emptyState({ icon: 'wallet', title: 'No expenses today', text: 'Expenses added today will appear in this report.' }),
      foot: `<button class="btn ghost" data-close>Close</button><button class="btn" id="er-print">${I('print', 'sm')}Print</button><button class="btn primary" id="er-pdf">${I('download', 'sm')}Download PDF</button>`,
      onMount(el) { el.querySelector('#er-print').onclick = tryPrint; el.querySelector('#er-pdf').onclick = () => toast('Expense report PDF downloaded', 'ok'); },
    });
  }
  page('/expenses', {
    title: 'Expenses', perm: 'EXPENSE_VIEW', skeleton: 'table',
    render() {
      return `${pageHead('Expenses', 'Court fees, travel and out-of-pocket costs per matter, against fees received.', `<button class="btn" id="ex-today">${I('file', 'sm')}Today's report</button><button class="btn" id="ex-month">${I('chart', 'sm')}Monthly report</button>${can('EXPENSE_CREATE') ? `<button class="btn primary" id="ex-new">${I('plus', 'sm')}Add expense</button>` : ''}`)}
        <div class="row" style="margin-bottom:var(--s3)">${seg('exv', [['case', 'By case'], ['all', 'All expenses']], expView, 'Expense view')}</div>
        <div id="ex-body"></div>`;
    },
    mount(root) {
      const nb = root.querySelector('#ex-new'); if (nb) nb.onclick = () => FORMS.expense({ onSave: redraw });
      root.querySelector('#ex-today').onclick = () => expenseReport('today');
      root.querySelector('#ex-month').onclick = () => expenseReport('month');
      const body = root.querySelector('#ex-body');
      const draw = () => {
        body.innerHTML = '<div></div>';
        const el = body.firstChild;
        if (expView === 'case') {
          const rows = D.cases.filter(c => D.expenses.some(x => x.caseId === c.id) || D.payments.some(p => p.caseId === c.id)).map(c => {
            const e = sum(D.expenses.filter(x => x.caseId === c.id), x => x.amount); const r = sum(D.payments.filter(p => p.caseId === c.id), p => p.amount);
            return { c, id: c.id, no: c.no, e, r, bal: r - e };
          });
          DataTable(el, {
            rows, onRow: r => caseFinance(r.c), initialSort: { key: 'e', dir: 'desc' },
            search: { placeholder: 'Search case or client', keys: ['no', r => clientById(r.c.client).name] },
            filters: [{ label: 'Status', options: ['Active', 'Pending', 'Closed'], test: (r, v) => r.c.status === v }],
            columns: [
              { key: 'no', label: 'Case', sort: true, render: r => `<div class="mono small cell-title">${esc(r.no)}</div><div class="cell-sub">${esc(r.c.title)}</div>` },
              { key: 'cl', label: 'Client', render: r => esc(clientById(r.c.client).name), hideSm: true },
              { key: 'st', label: 'Status', render: r => chip(r.c.status), hideSm: true },
              { key: 'e', label: 'Expenses', sort: true, cls: 'amt', render: r => `<span class="mono">${inr(r.e)}</span>` },
              { key: 'r', label: 'Received', sort: true, cls: 'amt', render: r => `<span class="mono">${inr(r.r)}</span>`, hideSm: true },
              { key: 'bal', label: 'Balance', sort: true, cls: 'amt', render: r => `<span class="mono ${r.bal < 0 ? 'p3-bad' : 'p3-ok'}">${r.bal < 0 ? '−' : ''}${inr(Math.abs(r.bal))}</span>` },
              { key: 'a', label: '<span class="sr-only">Actions</span>', cls: 'actions', render: r => `<button class="btn ghost sm" data-view="${r.id}">View</button>` },
            ],
          });
        } else {
          DataTable(el, {
            rows: D.expenses, initialSort: { key: 'date', dir: 'desc' },
            search: { placeholder: 'Search expense or case', keys: ['title', x => caseById(x.caseId).no] },
            filters: [{ label: 'Category', options: D.expenseCategories, key: 'cat' }, { label: 'Status', options: ['Paid', 'Pending', 'Unpaid'], key: 'status' }],
            onRow: x => caseFinance(caseById(x.caseId)),
            columns: [
              { key: 'date', label: 'Date', sort: x => +x.date, render: x => fdate(x.date) },
              { key: 'title', label: 'Title', sort: true, render: x => `<span class="cell-title">${esc(x.title)}</span>` },
              { key: 'case', label: 'Case', render: x => caseCell(caseById(x.caseId)), hideSm: true },
              { key: 'cat', label: 'Category', sort: true, hideSm: true },
              { key: 'mode', label: 'Mode', hideSm: true },
              { key: 'status', label: 'Status', render: x => chip(x.status) },
              { key: 'amount', label: 'Amount', sort: true, cls: 'amt', render: x => `<span class="mono">${inr(x.amount)}</span>` },
            ],
            empty: { icon: 'wallet', title: 'No expenses yet' },
          });
        }
      };
      draw();
      body.addEventListener('click', e => { const b = e.target.closest('[data-view]'); if (b) caseFinance(caseById(b.dataset.view)); });
      root.addEventListener('segchange', e => { if (e.target.dataset.seg === 'exv') { expView = e.detail; draw(); } });
    },
  });

  /* ==========================================================================
     /reports
     Figures derive from D and scale with the chosen range so switching range
     changes numbers plausibly. Deterministic, so the demo is repeatable.
     ========================================================================== */
  const RANGES = { month: ['This month', 1, 6, 12.4], last: ['Last month', 0.92, 6, -4.1], quarter: ['This quarter', 2.85, 9, 8.7], year: ['This year', 10.6, 12, 21.3], custom: ['Custom', 1, 6, 3.2] };
  let rptRange = 'month'; let rptFrom = day(-45).toISOString().slice(0, 10); let rptTo = TODAY.toISOString().slice(0, 10);
  const MONTHS = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(TODAY); d.setDate(1); d.setMonth(d.getMonth() - (n - 1 - i)); return d.toLocaleDateString('en-IN', { month: 'short' }); });
  const delta = (pct, goodUp = true) => { const up = pct >= 0; const good = up === goodUp; return `<span class="${good ? 'up' : 'down'}">${up ? '+' : '−'}${Math.abs(pct).toFixed(1)}%</span> vs previous period`; };
  function reportBody() {
    const [, f0, months, chg] = RANGES[rptRange];
    const f = rptRange === 'custom' ? Math.max(0.1, (new Date(rptTo) - new Date(rptFrom)) / 864e5 / 30) : f0;
    const monthRev = sum(D.payments, p => p.amount) / 4; const monthExp = sum(D.expenses, x => x.amount) / 6;
    const rev = Math.round(monthRev * f); const exp = Math.round(monthExp * f);
    const outAmt = sum(D.invoices.filter(i => ['Unpaid', 'Overdue'].includes(invStatus(i))), i => i.total);
    const labels = MONTHS(months);
    const inc = labels.map((_, i) => Math.round(monthRev * (0.72 + 0.28 * Math.sin(i * 1.3 + 1) + i * 0.02)));
    const out = labels.map((_, i) => Math.round(monthExp * (0.8 + 0.35 * Math.cos(i * 1.7))));
    const st = ['Active', 'Pending', 'Closed'].map(s => ({ label: s, value: D.cases.filter(c => c.status === s).length }));
    st[0].color = 'var(--ink)'; st[1].color = 'var(--warn)'; st[2].color = 'var(--mute)';
    const levels = ['Supreme Court', 'High Court', 'District'];
    const types = Object.entries(D.cases.reduce((m, c) => { m[c.type] = (m[c.type] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const newCl = MONTHS(6).map((_, i) => D.clients.filter(c => { const k = Math.floor(-daysFrom(c.since) / 30); return k === 5 - i; }).length + (i % 2));
    const topCl = Object.entries(D.invoices.reduce((m, i) => { if (i.status !== 'Canceled') m[i.client] = (m[i.client] || 0) + i.total; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const hearToday = D.events.filter(e => e.type === 'Hearing' && daysFrom(e.at) === 0).length;
    const hear30 = D.events.filter(e => e.type === 'Hearing' && daysFrom(e.at) > 0 && daysFrom(e.at) <= 30).length;
    const courts = Object.entries(D.events.filter(e => e.type === 'Hearing').reduce((m, e) => { m[e.court] = (m[e.court] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
    const csv = (s) => `<button class="btn ghost sm" data-csv="${s}">${I('download', 'sm')}Download CSV</button>`;
    return `<div class="section-title"><h2>Financial</h2>${csv('financial')}</div>
      ${figures([
        ['Revenue', inrShort(rev), delta(chg)], ['Expenses', inrShort(exp), delta(chg * 0.4 - 2, false)],
        ['Net income', inrShort(rev - exp), delta(chg * 1.1)], ['Outstanding', inrShort(outAmt), delta(-chg * 0.6, false)],
      ])}
      <div class="panel"><div class="panel-head"><h3>Cash flow</h3>${legend([{ label: 'Income', color: 'var(--ink)' }, { label: 'Expenses', color: 'var(--tape)' }])}</div><div class="panel-body">${lineChart({ labels, series: [{ name: 'Income', data: inc, color: 'var(--ink)' }, { name: 'Expenses', data: out, color: 'var(--tape)', dash: true }], money: true })}</div></div>
      <div class="section-title"><h2>Cases</h2>${csv('cases')}</div>
      <div class="grid g-3">
        <div class="panel"><div class="panel-head"><h3>By status</h3></div><div class="panel-body stack" style="align-items:center;gap:12px">${donut({ parts: st, label: String(D.cases.length), sub: 'cases' })}${legend(st)}</div></div>
        <div class="panel"><div class="panel-head"><h3>By court level</h3></div><div class="panel-body">${barChart({ labels: levels, series: [{ name: 'Cases', data: levels.map(l => D.cases.filter(c => c.level === l).length) }], height: 200 })}</div></div>
        <div class="panel"><div class="panel-head"><h3>By case type</h3><span class="sub">Top 6</span></div><div class="panel-body">${barRows(types)}</div></div>
      </div>
      <div class="section-title"><h2>Clients</h2>${csv('clients')}</div>
      <div class="grid g-2">
        <div class="panel"><div class="panel-head"><h3>New clients per month</h3></div><div class="panel-body">${barChart({ labels: MONTHS(6), series: [{ name: 'New clients', data: newCl }], height: 200 })}</div></div>
        <div class="panel"><div class="panel-head"><h3>Top clients by billing</h3></div><div class="table-wrap" style="border:0"><table class="t"><thead><tr><th scope="col">Client</th><th scope="col" class="amt">Billed</th><th scope="col" class="amt">Outstanding</th></tr></thead><tbody>
          ${topCl.map(([id, v]) => `<tr><td><a class="link" href="#/clients/${id}">${esc(clientById(id).name)}</a></td><td class="amt mono">${inr(Math.round(v * Math.min(f, 1.4)))}</td><td class="amt mono">${inr(outstanding(id))}</td></tr>`).join('')}</tbody></table></div></div>
      </div>
      <div class="section-title"><h2>Hearings</h2>${csv('hearings')}</div>
      ${figures([['Today', hearToday, 'Listed across all courts'], ['Upcoming 30 days', hear30, 'Scheduled hearings'], ['Adjourned rate', (34 + chg / 4).toFixed(0) + '%', delta(-chg / 3, false)]])}
      <div class="panel"><div class="panel-head"><h3>Hearings by court</h3></div><div class="panel-body">${barRows(courts)}</div></div>`;
  }
  page('/reports', {
    title: 'Reports', perm: 'REPORT_VIEW', skeleton: 'dashboard',
    render() {
      return `${pageHead('Reports', 'Practice performance across billing, cases, clients and hearings.', `<button class="btn primary" id="rp-pdf">${I('download', 'sm')}Export PDF</button>`)}
        <div class="row wrap" style="gap:12px">${seg('rng', Object.entries(RANGES).map(([k, v]) => [k, v[0]]), rptRange, 'Date range')}
          <div class="row" id="rp-custom" ${rptRange === 'custom' ? '' : 'hidden'} style="gap:8px"><label class="sr-only" for="rp-from">From</label><input type="date" class="input" id="rp-from" value="${rptFrom}"><span class="faint">to</span><label class="sr-only" for="rp-to">To</label><input type="date" class="input" id="rp-to" value="${rptTo}"></div></div>
        <div id="rp-body">${reportBody()}</div>`;
    },
    mount(root) {
      const body = root.querySelector('#rp-body'); const cust = root.querySelector('#rp-custom');
      const draw = () => { body.innerHTML = reportBody(); };
      root.querySelector('#rp-pdf').onclick = (e) => busy(e.currentTarget, () => toast(`Report for ${esc(RANGES[rptRange][0].toLowerCase())} exported as PDF`, 'ok'));
      root.addEventListener('segchange', e => { if (e.target.dataset.seg !== 'rng') return; rptRange = e.detail; cust.hidden = rptRange !== 'custom'; draw(); });
      root.querySelector('#rp-from').onchange = e => { rptFrom = e.target.value; draw(); };
      root.querySelector('#rp-to').onchange = e => { rptTo = e.target.value; draw(); };
      body.addEventListener('click', e => { const b = e.target.closest('[data-csv]'); if (b) toast(`${b.dataset.csv.charAt(0).toUpperCase() + b.dataset.csv.slice(1)} data downloaded as CSV`, 'ok'); });
    },
  });
})();
