/* ==========================================================================
   PAGES 1: CASES
   /cases          Cases register (table and board views)
   /cases/new      Add case (import from court records, or enter manually)
   /cases/:id      Case detail (the flagship file-cover screen)
   Relies on core.js helpers and data.js sample data `D`.
   ========================================================================== */

/* Small additions that only these pages need. Tokens only, so both themes work. */
document.head.insertAdjacentHTML('beforeend', `<style>
  button.figure { font: inherit; color: inherit; text-align: left; background: none; border: 0; border-right: 1px solid var(--line); cursor: pointer; width: 100%; }
  button.figure:last-child { border-right: 0; }
  button.figure:hover { background: var(--surface-2); }
  button.figure[aria-pressed="true"] { background: var(--surface-2); box-shadow: inset 0 -2px 0 var(--ink); }
  .cs-board { grid-template-columns: repeat(4, minmax(240px, 1fr)); }
  @media (max-width: 720px) { .cs-board { grid-template-columns: repeat(4, 82vw); } }
  .cs-today { color: var(--tape-ink); font-weight: 600; }
  .cs-sub { font-size: var(--t-xs); color: var(--ink-3); margin-top: 2px; }
  .cs-pick { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--s3); }
  .cs-pick button { text-align: left; padding: var(--s4); border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); color: var(--ink); font: inherit; cursor: pointer; }
  .cs-pick button:hover { border-color: var(--line-strong); }
  .cs-pick button[aria-pressed="true"] { border-color: var(--ink); box-shadow: 0 0 0 1px var(--ink); }
  .cs-steps { display: flex; flex-wrap: wrap; gap: var(--s2) var(--s5); margin: 0 0 var(--s5); padding: 0; list-style: none; font-size: var(--t-sm); color: var(--ink-3); }
  .cs-steps li { display: inline-flex; align-items: center; gap: 8px; }
  .cs-steps li b { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; border: 1px solid var(--line-strong); font: 500 11px var(--f-mono); }
  .cs-steps li[aria-current="step"] { color: var(--ink); font-weight: 500; }
  .cs-steps li[aria-current="step"] b { background: var(--ink); color: var(--ink-inverse); border-color: var(--ink); }
  .cs-steps li.done b { background: var(--surface-3); }
  .cs-big-date { font: 500 var(--t-3xl)/1.05 var(--f-display); letter-spacing: -.02em; }
  .cs-note { padding: 12px 0; border-top: 1px solid var(--line); }
  .cs-note:first-child { border-top: 0; }
  .cs-task { display: flex; gap: var(--s3); align-items: center; padding: 10px var(--s5); border-top: 1px solid var(--line); }
  .cs-task:first-child { border-top: 0; }
  .cs-task.done .ttl { text-decoration: line-through; color: var(--ink-3); }
</style>`);

/* ---------- Shared helpers for the case pages ---------- */
const CASE_TAGS = ['High Priority', 'Urgent', 'Follow Up', 'On Hold', 'Important', 'Awaiting Documents', 'For Argument', 'Reserved', 'For Orders', 'Appeal'];
const PARTY_ROLES = ['Petitioner', 'Respondent', 'Appellant', 'Complainant', 'Accused', 'Plaintiff', 'Defendant', 'Third Party', 'Witness'];
const RELATIONS = ['Appeal', 'Connected', 'Cross-Objection', 'Same Parties', 'Arising From'];
const STAGE_LANES = [
  ['Admission & notice', ['Admission', 'Notice', 'Mention']],
  ['Pleadings & issues', ['For Counter/Reply', 'Framing of Issues', 'Mediation']],
  ['Evidence', ['Evidence', 'Cross-examination']],
  ['Arguments & orders', ['Arguments', 'For Orders', 'Disposed']],
];
const stageLane = (stage) => (STAGE_LANES.find(([, s]) => s.includes(stage)) || STAGE_LANES[0])[0];
const caseStages = () => [...new Set(STAGE_LANES.flatMap(([, s]) => s))];
const advName = (id) => (advById(id) || {}).name || 'Unassigned';
const outstanding = (c) => Math.max(0, (c.fee || 0) - (c.paid || 0));
const inWeek = (c) => c.next && daysFrom(c.next) >= 0 && daysFrom(c.next) <= 6;
const nextHtml = (c) => c.next ? `<span class="${daysFrom(c.next) === 0 ? 'cs-today' : ''}">${rel(c.next)}</span><div class="cs-sub">${ftime(c.next)}</div>` : '<span class="faint">Not listed</span>';
const tagsShort = (tags) => !tags.length ? '<span class="faint">None</span>' : `<span class="row wrap" style="gap:4px">${tags.slice(0, 2).map(tagHtml).join('')}${tags.length > 2 ? `<span class="faint xs">+${tags.length - 2}</span>` : ''}</span>`;

/* Create a case from either add-case path and keep derived fields consistent with data.js */
function createCase(f) {
  const ct = D.courts.find(x => x.id === f.court) || D.courts[0];
  const id = Math.max(...D.cases.map(c => c.id)) + 1;
  const nh = f.nh == null ? 14 : f.nh;
  const c = {
    id, no: f.no, type: f.type, court: ct.id, hall: f.hall || 'To be listed', judge: f.judge || 'Not yet assigned',
    title: f.title, client: +f.client, adv: +f.adv, status: f.status || 'Active', stage: f.stage || 'Admission',
    nh, h: 10, m: 30, cnr: f.cnr || '', filed: f.filed || new Date(), tags: [], fee: +f.fee || 0, paid: 0,
    opp: f.opp || '—', item: f.item || null, desc: f.desc || '',
  };
  c.courtName = ct.name; c.level = ct.level; c.bench = ct.bench;
  c.next = c.status === 'Closed' ? null : day(nh, 10, 30);
  c.party = c.title.split(/\s+vs\.?\s+/i);
  if (c.party.length < 2) c.party.push('—');
  D.cases.push(c);
  if (c.next) D.events.push({ id: Math.max(...D.events.map(e => e.id)) + 1, type: 'Hearing', title: c.no, caseId: c.id, at: c.next, purpose: c.stage, court: c.courtName, hall: c.hall, judge: c.judge });
  refreshNav();
  return c;
}

/* Row and card actions shared by table and board */
function caseActions(anchor, c, onChange) {
  popMenu(anchor, [
    { label: 'Open', icon: 'eye', onClick: () => go('/cases/' + c.id) },
    { label: 'Add hearing', icon: 'calendar', onClick: () => FORMS.event({ caseId: c.id, onSave: onChange }) },
    { label: 'Raise invoice', icon: 'receipt', onClick: () => FORMS.invoice({ caseId: c.id, onSave: onChange }) },
    '-',
    c.status === 'Closed'
      ? { label: 'Restore', icon: 'restore', onClick: () => { c.status = 'Active'; refreshNav(); onChange(); toast(`${esc(c.no)} restored`); } }
      : { label: 'Archive', icon: 'archive', danger: true, onClick: () => confirmDialog({
        title: 'Archive this case?', confirm: 'Archive case',
        text: `<b class="mono">${esc(c.no)}</b> moves to archived cases and stops appearing in hearing reminders. You can restore it later.`,
        onConfirm: () => { c.status = 'Closed'; c.next = null; refreshNav(); onChange(); toast(`${esc(c.no)} archived`, 'ok'); },
      }) },
  ], { width: 220 });
}

/* ==========================================================================
   /cases : Cases register
   ========================================================================== */
let casesView = 'table';
page('/cases', {
  title: 'Cases', perm: 'CASE_VIEW', skeleton: 'table',
  render() {
    const open = D.cases.filter(c => c.status !== 'Closed');
    const active = open.filter(c => c.status === 'Active').length;
    const pending = open.filter(c => c.status === 'Pending').length;
    const week = open.filter(inWeek).length;
    const due = open.reduce((s, c) => s + outstanding(c), 0);
    const today = open.filter(c => c.next && daysFrom(c.next) === 0).length;
    return `<div class="cs-root"><div class="page-head">
        <div><h1>Cases</h1><p>${open.length} open matters, ${today} listed today, ${D.cases.length - open.length} archived.</p></div>
        <div class="actions">${can('CASE_CREATE') ? `<button class="btn primary" id="cs-add">${I('plus', 'sm')}Add case</button>` : ''}</div>
      </div>
      <div class="figures" style="margin-bottom:var(--s5)" role="group" aria-label="Quick filters">
        <button class="figure" data-fig="Active" aria-pressed="false"><div class="lbl">Active</div><div class="val">${active}</div><div class="meta">Being heard</div></button>
        <button class="figure" data-fig="Pending" aria-pressed="false"><div class="lbl">Pending</div><div class="val">${pending}</div><div class="meta">Admission or reserved</div></button>
        <button class="figure" data-fig="week" aria-pressed="false"><div class="lbl">Hearings this week</div><div class="val">${week}</div><div class="meta">Next 7 days</div></button>
        <button class="figure" data-fig="due" aria-pressed="false"><div class="lbl">Outstanding fees</div><div class="val">${inrShort(due)}</div><div class="meta">Agreed fee less paid</div></button>
      </div>
      <div class="row wrap between" style="margin-bottom:var(--s3)">
        <div class="seg" data-seg aria-label="View">
          <button data-v="table" aria-pressed="${casesView === 'table'}">${I('rows', 'sm')}Table</button>
          <button data-v="board" aria-pressed="${casesView === 'board'}">${I('kanban', 'sm')}Board</button>
        </div>
        <button class="filter-chip" id="cs-arch" aria-pressed="false">${I('archive', 'sm')}Show archived</button>
      </div>
      <div id="cs-table" ${casesView === 'table' ? '' : 'hidden'}></div>
      <div id="cs-board" ${casesView === 'board' ? '' : 'hidden'}></div></div>`;
  },
  mount(page) {
    const root = page.querySelector('.cs-root');
    let showArchived = false; let fig = ''; let dt;
    const preset = query().get('status');
    const statusFilter = () => (dt && dt.state.f[0]) || '';
    const rows = () => D.cases.filter(c => {
      if (c.status === 'Closed' && !showArchived && statusFilter() !== 'Closed') return false;
      if (fig === 'week') return inWeek(c);
      if (fig === 'due') return outstanding(c) > 0 && c.status !== 'Closed';
      return true;
    });
    const redraw = () => { dt.refresh(); drawBoard(); };
    const onChange = () => router();

    dt = DataTable(root.querySelector('#cs-table'), {
      rowsFn: rows,
      search: { placeholder: 'Search case no., title, client or CNR', keys: ['no', 'title', 'cnr', (r) => clientById(r.client).name] },
      filters: [
        { key: 'status', label: 'Status', options: ['Active', 'Pending', 'Closed'] },
        { key: 'level', label: 'Court level', options: ['District', 'High Court', 'Supreme Court'] },
        { key: 'adv', label: 'Advocate', options: D.advocates.filter(a => a.role.includes('Advocate')).map(a => a.name), test: (r, v) => advName(r.adv) === v },
      ],
      initialSort: { key: 'next', dir: 'asc' },
      onRow: (r) => go('/cases/' + r.id),
      rowClass: (r) => r.status === 'Closed' ? 'muted' : '',
      columns: [
        { key: 'no', label: 'Case', sort: true, render: r => `<div class="mono small">${esc(r.no)}</div><div class="cs-sub ellipsis" style="max-width:34ch">${esc(r.title)}</div>` },
        { key: 'courtName', label: 'Court', sort: true, hideSm: true, render: r => `<div class="small">${esc(r.courtName)}</div><div class="cs-sub">${esc(r.hall)}</div>` },
        { key: 'stage', label: 'Stage', sort: true, hideSm: true },
        { key: 'next', label: 'Next hearing', sort: r => r.next ? +r.next : 9e15, render: nextHtml },
        { key: 'client', label: 'Client', sort: r => clientById(r.client).name, hideSm: true, render: r => `<a class="link" href="#/clients/${r.client}">${esc(clientById(r.client).name)}</a>` },
        { key: 'tags', label: 'Tags', hideSm: true, render: r => tagsShort(r.tags) },
        { key: 'status', label: 'Status', sort: true, render: r => chip(r.status) },
        { key: 'act', label: '<span class="sr-only">Actions</span>', cls: 'right', render: r => `<button class="btn ghost sm icon" data-pop data-act="${r.id}" aria-label="Actions for ${esc(r.no)}" aria-haspopup="menu">${I('more', 'sm')}</button>` },
      ],
      empty: { icon: 'case', title: 'No cases yet', text: 'Add your first case by importing it from court records.', action: '<a class="btn primary sm" href="#/cases/new">Add case</a>' },
    });

    if (preset) {
      const sel = root.querySelector('[data-fi="0"]');
      if (sel && [...sel.options].some(o => o.value === preset)) { sel.value = preset; dt.state.f[0] = preset; dt.refresh(); }
    }

    function drawBoard() {
      const list = rows().filter(c => !dt.state.f[1] || c.level === dt.state.f[1]);
      root.querySelector('#cs-board').innerHTML = `<div class="board cs-board">${STAGE_LANES.map(([lane]) => {
        const cs = list.filter(c => stageLane(c.stage) === lane).sort((a, b) => (a.next ? +a.next : 9e15) - (b.next ? +b.next : 9e15));
        return `<section class="lane" aria-label="${esc(lane)}"><h4><span>${esc(lane)}</span><span class="badge-n">${cs.length}</span></h4>
          ${cs.map(c => `<div class="card-mini" role="link" tabindex="0" data-open="${c.id}">
            <div class="row between"><span class="mono xs">${esc(c.no)}</span><button class="btn ghost sm icon" data-pop data-act="${c.id}" aria-label="Actions for ${esc(c.no)}">${I('more', 'sm')}</button></div>
            <div class="small" style="font-weight:500;margin:2px 0 6px">${esc(c.title)}</div>
            <div class="row between xs"><span>${chip(c.status)}</span><span class="${c.next && daysFrom(c.next) === 0 ? 'cs-today' : 'faint'}">${c.next ? rel(c.next) : 'Not listed'}</span></div>
            <div class="cs-sub" style="margin-top:6px">${esc(c.stage)}, ${esc(c.hall)}</div>
          </div>`).join('') || '<p class="faint small" style="padding:8px 4px">No cases at this stage.</p>'}
        </section>`;
      }).join('')}</div>`;
    }
    drawBoard();

    root.querySelector('#cs-add') && root.querySelector('#cs-add').addEventListener('click', () => go('/cases/new'));
    root.addEventListener('segchange', e => {
      casesView = e.detail;
      root.querySelector('#cs-table').hidden = casesView !== 'table';
      root.querySelector('#cs-board').hidden = casesView !== 'board';
    });
    root.querySelector('#cs-arch').addEventListener('click', e => {
      showArchived = !showArchived; e.currentTarget.setAttribute('aria-pressed', showArchived); redraw();
    });
    root.querySelectorAll('[data-fig]').forEach(b => b.addEventListener('click', () => {
      const v = b.dataset.fig; const on = b.getAttribute('aria-pressed') !== 'true';
      root.querySelectorAll('[data-fig]').forEach(x => x.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', on);
      const sel = root.querySelector('[data-fi="0"]');
      fig = ''; sel.value = ''; dt.state.f[0] = '';
      if (on && (v === 'Active' || v === 'Pending')) { sel.value = v; dt.state.f[0] = v; }
      else if (on) fig = v;
      dt.state.page = 1; redraw();
    }));
    root.querySelectorAll('[data-fi]').forEach(s => s.addEventListener('change', drawBoard));
    root.addEventListener('click', e => {
      const a = e.target.closest('[data-act]');
      if (a) { e.stopPropagation(); caseActions(a, caseById(a.dataset.act), onChange); return; }
      const card = e.target.closest('[data-open]'); if (card) go('/cases/' + card.dataset.open);
    });
    root.addEventListener('keydown', e => { const card = e.target.closest('[data-open]'); if (card && e.key === 'Enter' && e.target === card) go('/cases/' + card.dataset.open); });
  },
});

/* ==========================================================================
   /cases/new : Add case
   Import path walks Court > Search > Results > Review, mirroring how the
   court-record import works against the scraper service. Manual path is a
   plain validated form. Both end in createCase().
   ========================================================================== */
const IMPORT_COURTS = [
  { id: 'mhc', title: 'Madras High Court', sub: 'Principal Bench, Chennai' },
  { id: 'mhc-md', title: 'Madras High Court', sub: 'Madurai Bench' },
  { id: 'ccc', title: 'District courts (eCourts)', sub: 'City Civil Court, Chennai and other district courts' },
  { id: 'sci', title: 'Supreme Court of India', sub: 'New Delhi' },
];
const ECOURTS = {
  Chennai: { 'City Civil Court Complex': ['City Civil Court, Chennai', 'Court of Small Causes, Chennai', 'Family Court, Chennai'], 'Egmore Court Complex': ['Chief Metropolitan Magistrate, Egmore'] },
  Coimbatore: { 'Combined Court Complex, Coimbatore': ['Principal District Court, Coimbatore'] },
  Madurai: { 'District Court Complex, Madurai': ['Principal District Court, Madurai'] },
};
const ESTAB_TO_COURT = { 'City Civil Court, Chennai': 'ccc', 'Court of Small Causes, Chennai': 'ccc', 'Family Court, Chennai': 'fam', 'Chief Metropolitan Magistrate, Egmore': 'cmm', 'Principal District Court, Coimbatore': 'dc-cbe', 'Principal District Court, Madurai': 'dc-cbe' };
const CASE_TYPES = [['AS(FIRST APPEAL)-1', 'A.S.', 'First Appeal'], ['OS - Original Suit', 'O.S.', 'Original Suit'], ['W.P.', 'W.P.', 'Writ Petition'], ['C.M.A.', 'C.M.A.', 'Civil Misc. Appeal'], ['C.R.P.', 'C.R.P.', 'Civil Revision Petition'], ['Crl.O.P.', 'Crl.O.P.', 'Criminal Original Petition'], ['SLP(C)', 'SLP(C)', 'Special Leave Petition']];

let addState = null;
const freshAdd = () => ({ path: 'import', step: 1, court: '', ec: { district: '', complex: '', estab: '' }, by: 'number', search: {}, results: [], pick: null });

page('/cases/new', {
  title: 'Add case', perm: 'CASE_CREATE', crumbs: [['Cases', '/cases']],
  render() {
    addState = freshAdd();
    return `<div class="cs-root"><div class="page-head"><div><h1>Add case</h1><p>Import the case from court records to fill in parties, listing and judge automatically, or enter it by hand.</p></div>
        <div class="seg" data-seg aria-label="How to add">
          <button data-v="import" aria-pressed="true">${I('download', 'sm')}Import from court records</button>
          <button data-v="manual" aria-pressed="false">${I('edit', 'sm')}Enter manually</button>
        </div></div>
      <div id="ac-body"></div></div>`;
  },
  mount(page) {
    const root = page.querySelector('.cs-root');
    const body = root.querySelector('#ac-body');
    const st = addState;
    const advOpts = D.advocates.filter(a => a.role.includes('Advocate')).map(a => [a.id, a.name]);
    const clientOpts = D.clients.filter(c => !c.archived).map(c => [c.id, c.name]);

    const stepsHtml = () => `<ol class="cs-steps" aria-label="Import steps">${['Court', 'Search', 'Results', 'Review'].map((s, i) =>
      `<li ${st.step === i + 1 ? 'aria-current="step"' : ''} class="${st.step > i + 1 ? 'done' : ''}"><b>${st.step > i + 1 ? I('check', 'sm') : i + 1}</b>${s}</li>`).join('')}</ol>`;

    const courtLabel = () => {
      if (st.court === 'ccc') return st.ec.estab || 'District court';
      const c = IMPORT_COURTS.find(x => x.id === st.court); return c ? `${c.title}, ${c.sub}` : '';
    };
    const resolvedCourt = () => st.court === 'ccc' ? (ESTAB_TO_COURT[st.ec.estab] || 'ccc') : st.court;

    function stepCourt() {
      const dists = Object.keys(ECOURTS);
      const complexes = st.ec.district ? Object.keys(ECOURTS[st.ec.district]) : [];
      const estabs = st.ec.complex ? ECOURTS[st.ec.district][st.ec.complex] : [];
      return `<div class="panel"><div class="panel-head"><h3>1. Choose the court</h3></div><div class="panel-body stack" style="gap:var(--s4)">
        <div class="cs-pick">${IMPORT_COURTS.map(c => `<button type="button" data-court="${c.id}" aria-pressed="${st.court === c.id}"><b>${esc(c.title)}</b><div class="cs-sub">${esc(c.sub)}</div></button>`).join('')}</div>
        ${st.court === 'ccc' ? `<div class="form-grid">
          ${field({ id: 'ec-state', label: 'State', options: ['TAMIL NADU'], value: 'TAMIL NADU' })}
          ${field({ id: 'ec-district', label: 'District', options: dists, value: st.ec.district, placeholder: 'Select district', required: true, err: 'Select a district.' })}
          ${field({ id: 'ec-complex', label: 'Court complex', options: complexes, value: st.ec.complex, placeholder: st.ec.district ? 'Select court complex' : 'Select a district first', required: true, err: 'Select a court complex.', attrs: st.ec.district ? '' : 'disabled' })}
          ${field({ id: 'ec-estab', label: 'Establishment', options: estabs, value: st.ec.estab, placeholder: st.ec.complex ? 'Select establishment' : 'Select a court complex first', required: true, err: 'Select an establishment.', attrs: st.ec.complex ? '' : 'disabled' })}
        </div>` : ''}
        <div class="row"><span class="grow"></span><button class="btn primary" id="ac-next1" ${st.court && (st.court !== 'ccc' || st.ec.estab) ? '' : 'disabled'}>Continue</button></div>
      </div></div>`;
    }

    function stepSearch() {
      const s = st.search;
      const tab = (k, l) => `<button data-tab="${k}" aria-selected="${st.by === k}">${l}</button>`;
      return `<div class="panel"><div class="panel-head"><h3>2. Search ${esc(courtLabel())}</h3><button class="btn ghost sm" id="ac-back1">Change court</button></div>
        <div class="panel-body"><form id="ac-sf" novalidate data-tab-scope>
          <div class="tabs" data-tabs>${tab('number', 'Case number')}${tab('cnr', 'CNR')}${tab('party', 'Party name')}${tab('adv', 'Advocate')}${tab('fir', 'FIR number')}</div>
          <div data-panel="number"><div class="form-grid">
            ${field({ id: 's-type', label: 'Case type', options: CASE_TYPES.map(t => t[0]), value: s.type || 'AS(FIRST APPEAL)-1' })}
            ${field({ id: 's-no', label: 'Case number', type: 'number', value: s.no || '', placeholder: '700', required: st.by === 'number', err: 'Enter the case number.' })}
            ${field({ id: 's-year', label: 'Year', options: ['2026', '2025', '2024', '2023', '2022', '2021', '2020'], value: s.year || '2025' })}
          </div></div>
          <div data-panel="cnr"><div class="form-grid">${field({ id: 's-cnr', label: 'CNR number', value: s.cnr || '', placeholder: 'TNCH010015532025', required: st.by === 'cnr', hint: '16 characters, printed on every order sheet.', err: 'A CNR is 16 letters and digits, like TNCH010015532025.', attrs: 'maxlength="16" style="text-transform:uppercase;font-family:var(--f-mono)"' })}</div></div>
          <div data-panel="party"><div class="form-grid">${field({ id: 's-party', label: 'Party name', value: s.party || '', placeholder: 'Murugan', required: st.by === 'party', err: 'Enter at least 3 letters of a party name.' })}${field({ id: 's-pyear', label: 'Year', options: ['Any', '2026', '2025', '2024', '2023'], value: 'Any' })}</div></div>
          <div data-panel="adv"><div class="form-grid">${field({ id: 's-adv', label: 'Advocate name or enrolment no.', value: s.adv || D.me.name, required: st.by === 'adv', err: 'Enter an advocate name.' })}</div></div>
          <div data-panel="fir"><div class="form-grid">${field({ id: 's-fir', label: 'FIR number', value: s.fir || '', placeholder: '311', required: st.by === 'fir', err: 'Enter the FIR number.' })}${field({ id: 's-ps', label: 'Police station', placeholder: 'E-3 Teynampet' })}${field({ id: 's-firy', label: 'Year', options: ['2026', '2025', '2024'], value: '2026' })}</div></div>
          <div class="row" style="margin-top:var(--s4)"><span class="grow"></span><button class="btn primary" id="ac-search" type="submit">${I('search', 'sm')}Search court records</button></div>
        </form></div></div>`;
    }

    function fabricate() {
      const by = st.by; const s = st.search; const court = resolvedCourt(); const yr = s.year || '2025';
      const t = CASE_TYPES.find(x => x[0] === s.type) || CASE_TYPES[0];
      const n = s.no || '700';
      const base = [
        { no: `${t[1]} No. ${n}/${yr}`, type: t[2], parties: s.party ? `${s.party} vs State of Tamil Nadu` : 'R. Murugan vs K. Rathinavel', status: 'Pending', filed: day(-380) },
        { no: `${t[1]} No. ${+n + 1}/${yr}`, type: t[2], parties: s.party ? `${s.party} & Anr. vs Chennai Corporation` : 'P. Selvaraj vs Indian Bank', status: 'Pending', filed: day(-372) },
        { no: `${t[1]} No. ${n}/${+yr - 1}`, type: t[2], parties: s.party ? `K. Arumugam vs ${s.party}` : 'S. Lakshmanan vs The Tahsildar, Tambaram', status: 'Disposed', filed: day(-760) },
      ];
      if (by === 'cnr') { base.length = 1; base[0].cnr = s.cnr.toUpperCase(); }
      if (by === 'fir') { base.length = 2; base[0].no = `Crl.O.P. No. 2${s.fir}4/2026`; base[0].type = 'Criminal Original Petition'; base[0].parties = 'V. Ramesh vs State rep. by Inspector of Police'; base[1].no = `Crl.M.P. No. 9${s.fir}/2026`; base[1].type = 'Criminal Misc. Petition'; base[1].parties = 'V. Ramesh vs State rep. by Inspector of Police'; }
      const prefix = court.startsWith('mhc') ? (court === 'mhc-md' ? 'HCMD01' : 'HCMA01') : court === 'sci' ? 'SCIN01' : 'TNCH01';
      return base.map((r, i) => ({ ...r, court, cnr: r.cnr || (prefix + String(1100 + i * 37 + (+n % 900)).padStart(6, '0') + yr).slice(0, 16), id: i }));
    }

    function stepResults() {
      return `<div class="panel"><div class="panel-head"><h3>3. Matching court records</h3><button class="btn ghost sm" id="ac-back2">Edit search</button></div>
        <div class="panel-body flush"><div class="table-wrap" style="border:0;border-radius:0"><table class="t"><thead><tr><th scope="col">Case</th><th scope="col" class="hide-sm">CNR</th><th scope="col" class="hide-sm">Filed</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Select</span></th></tr></thead><tbody>
        ${st.results.map(r => `<tr><td><div class="mono small">${esc(r.no)}</div><div class="cs-sub">${esc(r.parties)}</div></td><td class="mono small hide-sm">${esc(r.cnr)}</td><td class="hide-sm">${fdate(r.filed)}</td><td>${chip(r.status)}</td>
          <td class="right"><button class="btn sm" data-pick="${r.id}">Select</button></td></tr>`).join('')}
        </tbody></table></div><p class="faint xs" style="padding:var(--s3) var(--s5)">${st.results.length} record${st.results.length > 1 ? 's' : ''} found in ${esc(courtLabel())}. Not listed? Try the CNR, or enter the case manually.</p></div></div>`;
    }

    function stepReview() {
      const r = st.pick; const ct = D.courts.find(c => c.id === r.court);
      const [p1, p2] = r.parties.split(' vs ');
      const guessClient = D.clients.find(c => r.parties.includes(c.name));
      return `<div class="split">
        <div class="panel"><div class="panel-head"><h3>4. Review the court record</h3><button class="btn ghost sm" id="ac-back3">Back to results</button></div>
          <div class="panel-body stack" style="gap:var(--s4)">
            <div><div class="mono small faint">${esc(r.no)}</div><h2 style="font-size:var(--t-xl);margin-top:4px">${esc(p1)} <i class="faint" style="font-weight:400">vs</i> ${esc(p2)}</h2></div>
            <dl class="kv">
              <dt>CNR</dt><dd class="mono">${esc(r.cnr)}</dd>
              <dt>Court</dt><dd>${esc(ct.name)}, ${esc(ct.bench)}</dd>
              <dt>Case type</dt><dd>${esc(r.type)}</dd>
              <dt>Filing date</dt><dd>${fdate(r.filed)}</dd>
              <dt>Petitioner</dt><dd>${esc(p1)}</dd>
              <dt>Respondent</dt><dd>${esc(p2)}</dd>
              <dt>Last listed</dt><dd>${fdate(day(-9))}, adjourned</dd>
              <dt>Next date</dt><dd>${r.status === 'Disposed' ? 'Disposed' : fdate(day(14))}</dd>
              <dt>Judge</dt><dd>${ct.level === 'High Court' ? 'Hon\'ble Mr. Justice N. Seshasayee' : ct.level === 'Supreme Court' ? 'Hon\'ble Justice B. V. Nagarathna' : 'Thiru. S. Ravichandran, VI Asst. Judge'}</dd>
            </dl>
            <div class="callout info">${I('info', 'sm')}<div>Hearing dates and orders will keep syncing from court records after you save.</div></div>
          </div></div>
        <div class="panel"><div class="panel-head"><h3>Add to your workspace</h3></div><div class="panel-body"><form id="ac-rf" novalidate class="stack" style="gap:var(--s3)">
          ${field({ id: 'r-client', label: 'Client', options: clientOpts, value: guessClient ? guessClient.id : '', placeholder: 'Select a client', required: true, err: 'Choose who you act for.' })}
          <button type="button" class="btn ghost sm" id="r-newclient" style="align-self:flex-start">${I('plus', 'sm')}New client</button>
          ${field({ id: 'r-adv', label: 'Assign advocate', options: advOpts, value: D.me.id })}
          ${field({ id: 'r-fee', label: 'Agreed fee (₹)', type: 'number', placeholder: 'Optional' })}
          <button class="btn primary" id="r-save" type="submit">Save case to workspace</button>
        </form></div></div></div>`;
    }

    function manualForm() {
      return `<div class="panel"><div class="panel-body"><form id="ac-mf" class="form-grid" novalidate>
        <div class="fieldset-title">Case</div>
        ${field({ id: 'm-no', label: 'Case number', placeholder: 'O.S. No. 900/2025', required: true, err: 'Enter the case number as it appears on the cause list.' })}
        ${field({ id: 'm-type', label: 'Case type', options: [...new Set(D.cases.map(c => c.type))], value: 'Original Suit' })}
        ${field({ id: 'm-title', label: 'Title', placeholder: 'Petitioner vs Respondent', required: true, full: true, hint: 'Write the parties as "Petitioner vs Respondent".', err: 'Write the title as "Petitioner vs Respondent".' })}
        ${field({ id: 'm-court', label: 'Court', options: D.courts.map(c => [c.id, `${c.name}, ${c.bench}`]), placeholder: 'Select a court', required: true, err: 'Select the court.' })}
        ${field({ id: 'm-hall', label: 'Court hall', placeholder: 'Court Hall 12' })}
        ${field({ id: 'm-cnr', label: 'CNR', placeholder: 'Optional, 16 characters', err: 'A CNR is 16 letters and digits.', attrs: 'maxlength="16"' })}
        ${field({ id: 'm-status', label: 'Status', options: ['Active', 'Pending', 'Closed'], value: 'Active' })}
        ${field({ id: 'm-stage', label: 'Stage', options: caseStages(), value: 'Admission' })}
        <div class="fieldset-title">People and fees</div>
        ${field({ id: 'm-client', label: 'Client', options: clientOpts, placeholder: 'Select a client', required: true, err: 'Choose who you act for.' })}
        ${field({ id: 'm-adv', label: 'Handling advocate', options: advOpts, value: D.me.id })}
        ${field({ id: 'm-fee', label: 'Agreed fee (₹)', type: 'number', placeholder: '0' })}
        ${field({ id: 'm-opp', label: 'Opposing counsel', placeholder: 'Optional' })}
        ${field({ id: 'm-desc', label: 'Description', type: 'textarea', full: true, placeholder: 'Relief sought, background, anything the team should know' })}
        <div class="row full"><span class="grow"></span><a class="btn ghost" href="#/cases">Cancel</a><button class="btn primary" id="m-save" type="submit">Save case</button></div>
      </form></div></div>`;
    }

    const saved = (c) => { toast(`Case saved: <span class="mono">${esc(c.no)}</span>`, 'ok'); go('/cases/' + c.id); };

    function draw() {
      if (st.path === 'manual') { body.innerHTML = manualForm(); wireCommon(body); return; }
      body.innerHTML = stepsHtml() + [null, stepCourt, stepSearch, stepResults, stepReview][st.step]();
      wireCommon(body);
      const tl = body.querySelector('[data-tabs]');
      tl && tl.addEventListener('tabchange', e => { st.by = e.detail; body.querySelectorAll('#ac-sf [data-panel] input').forEach(i => { i.required = false; }); const p = body.querySelector(`#ac-sf [data-panel="${st.by}"] input`); if (p) p.required = true; });
      tl && tl.dispatchEvent(new CustomEvent('tabchange', { detail: st.by }));
    }

    root.addEventListener('segchange', e => { st.path = e.detail; draw(); });
    body.addEventListener('click', e => {
      const t = e.target;
      const cb = t.closest('[data-court]');
      if (cb) { st.court = cb.dataset.court; draw(); return; }
      if (t.closest('#ac-next1')) { st.step = 2; draw(); return; }
      if (t.closest('#ac-back1')) { st.step = 1; draw(); return; }
      if (t.closest('#ac-back2')) { st.step = 2; draw(); return; }
      if (t.closest('#ac-back3')) { st.step = 3; draw(); return; }
      const pk = t.closest('[data-pick]');
      if (pk) { st.pick = st.results[+pk.dataset.pick]; st.step = 4; draw(); return; }
      if (t.closest('#r-newclient')) FORMS.client(null, () => { draw(); toast('Client added. Select them in the list.', 'info'); });
    });
    body.addEventListener('change', e => {
      const id = e.target.id;
      if (id === 'ec-district') { st.ec = { district: e.target.value, complex: '', estab: '' }; draw(); }
      if (id === 'ec-complex') { st.ec.complex = e.target.value; st.ec.estab = ''; draw(); }
      if (id === 'ec-estab') { st.ec.estab = e.target.value; draw(); }
    });
    body.addEventListener('submit', e => {
      e.preventDefault();
      const f = e.target; const v = (id) => (f.querySelector('#' + id) || {}).value || '';
      if (f.id === 'ac-sf') {
        const cnrField = f.querySelector('#s-cnr').closest('.field');
        if (!validateForm(f)) return;
        if (st.by === 'cnr' && !/^[A-Z]{4}\d{12}$/i.test(v('s-cnr'))) { cnrField.classList.add('invalid'); f.querySelector('#s-cnr').focus(); return; }
        if (st.by === 'party' && v('s-party').trim().length < 3) { f.querySelector('#s-party').closest('.field').classList.add('invalid'); return; }
        st.search = { type: v('s-type'), no: v('s-no'), year: v('s-year'), cnr: v('s-cnr'), party: v('s-party').trim(), adv: v('s-adv'), fir: v('s-fir') };
        busy(f.querySelector('#ac-search'), () => { st.results = fabricate(); st.step = 3; draw(); }, 1100);
      }
      if (f.id === 'ac-rf') {
        if (!validateForm(f)) return;
        const r = st.pick; const ct = D.courts.find(c => c.id === r.court);
        busy(f.querySelector('#r-save'), () => saved(createCase({
          no: r.no, type: r.type, court: r.court, title: r.parties, client: v('r-client'), adv: v('r-adv'), fee: v('r-fee'), cnr: r.cnr, filed: r.filed,
          status: r.status === 'Disposed' ? 'Closed' : 'Active', stage: r.status === 'Disposed' ? 'Disposed' : 'Admission',
          hall: ct.level === 'High Court' ? 'Court Hall 12' : ct.level === 'Supreme Court' ? 'Court No. 5' : 'Court No. VI',
          judge: ct.level === 'High Court' ? 'Hon\'ble Mr. Justice N. Seshasayee' : ct.level === 'Supreme Court' ? 'Hon\'ble Justice B. V. Nagarathna' : 'Thiru. S. Ravichandran, VI Asst. Judge',
          item: 24, nh: r.status === 'Disposed' ? null : 14, desc: `Imported from court records on ${fdate(new Date())}.`,
        })));
      }
      if (f.id === 'ac-mf') {
        let ok = validateForm(f);
        const tf = f.querySelector('#m-title');
        if (tf.value && !/\svs\.?\s/i.test(tf.value)) { tf.closest('.field').classList.add('invalid'); ok = false; }
        const cf = f.querySelector('#m-cnr');
        if (cf.value && !/^[A-Z]{4}\d{12}$/i.test(cf.value)) { cf.closest('.field').classList.add('invalid'); ok = false; }
        if (!ok) return;
        const status = v('m-status');
        busy(f.querySelector('#m-save'), () => saved(createCase({
          no: v('m-no').trim(), type: v('m-type'), court: v('m-court'), hall: v('m-hall').trim(), title: v('m-title').trim(), cnr: v('m-cnr').toUpperCase(),
          client: v('m-client'), adv: v('m-adv'), fee: v('m-fee'), opp: v('m-opp').trim(), desc: v('m-desc').trim(), status,
          stage: status === 'Closed' ? 'Disposed' : v('m-stage'), nh: status === 'Closed' ? null : 14,
        })));
      }
    });
    draw();
  },
});

/* ==========================================================================
   /cases/:id : Case detail
   File-cover header, tabbed working area, sticky rail. All actions mutate D
   and re-render through router(); the open tab is remembered across redraws.
   ========================================================================== */
let caseTab = { id: null, tab: 'overview' };

const caseDocs = (c) => D.documents.filter(d => d.caseId === c.id && d.status !== 'Archived');
const caseOrders = (c) => caseDocs(c).filter(d => d.cat === 'Court Order' || d.cat === 'Judgment');
const caseTasks = (c) => D.tasks.filter(t => t.caseId === c.id && t.status !== 'Canceled');
const caseUpcoming = (c) => D.events.filter(e => e.caseId === c.id && e.at >= TODAY).sort((a, b) => a.at - b.at);
const caseParties = (c) => D.parties(c).concat(c.extraParties || []);
const caseNotes = (c) => c.notes || (c.notes = [{ id: 1, by: advName(c.adv), at: day(-3, 18, 20), text: `Client confirmed availability for the next hearing. Carry originals of the documents relied upon.` }]);
const caseActs = (c) => c.acts || (c.acts = c.type.includes('Appeal') && !c.type.includes('Criminal') ? ['CPC Sec. 96', 'CPC Order XLI'] : c.type.includes('Arbitration') ? ['Arbitration Act Sec. 34'] : c.type.includes('Calendar') ? ['NI Act Sec. 138'] : c.type.includes('Criminal') ? ['BNSS Sec. 528'] : c.type.includes('Writ') ? ['Constitution Art. 226'] : c.type.includes('Rent') ? ['TN Landlords and Tenants Act Sec. 21'] : ['CPC Order VII Rule 1']);
const ACT_SHORT = { 1: 'CPC', 2: 'BNS', 3: 'BNSS', 4: 'Arbitration Act', 5: 'NI Act', 6: 'TN Landlords and Tenants Act', 7: 'Consumer Protection Act', 8: 'TN Court-fees Act', 9: 'BSA', 10: 'Hindu Marriage Act' };
function relatedCases(c) {
  c.relations = c.relations || {};
  return D.cases.filter(o => o.id !== c.id && (o.client === c.client || o.party.some(p => c.party.includes(p)))).map(o => {
    let rel = c.relations[o.id];
    if (!rel) rel = (c.desc.includes(o.no) || o.desc.includes(c.no)) ? (o.filed > c.filed ? 'Appeal' : 'Arising From') : o.title === c.title ? 'Connected' : o.party.some(p => c.party.includes(p)) ? 'Same Parties' : 'Connected';
    return { o, rel };
  });
}
function caseTimeline(c) {
  const items = [{ at: c.filed, title: 'Case filed', sub: `${c.no} in ${c.courtName}`, key: true }];
  D.hearingHistory(c.id).forEach(h => items.push({ at: h.date, title: `Hearing: ${h.purpose}`, sub: h.outcome }));
  caseUpcoming(c).forEach(e => items.push({ at: e.at, title: `${e.type} scheduled`, sub: e.type === 'Hearing' ? `${e.hall}, ${e.purpose || ''}` : e.title, key: e.type === 'Hearing' }));
  caseDocs(c).forEach(d => items.push({ at: d.date, title: `Document added: ${d.name}`, sub: `${d.cat}, by ${d.by}`, key: d.cat === 'Court Order' || d.cat === 'Judgment' }));
  D.invoices.filter(i => i.caseId === c.id).forEach(i => items.push({ at: i.date, title: `Invoice ${i.no} raised`, sub: inr(i.total) }));
  D.payments.filter(p => p.caseId === c.id).forEach(p => items.push({ at: p.date, title: `Payment received`, sub: `${inr(p.amount)} by ${p.mode}` }));
  return items.sort((a, b) => b.at - a.at);
}

page('/cases/:id', {
  title: (p) => { const c = caseById(p.id); return c ? c.no : 'Case not found'; },
  crumbs: [['Cases', '/cases']], perm: 'CASE_VIEW', skeleton: 'detail',
  render({ id }) {
    const c = caseById(id);
    if (!c) return emptyState({ icon: 'case', title: 'This case isn\'t in your workspace', text: 'It may have been deleted, or the link is wrong. Search the register to find it.', action: '<a class="btn primary" href="#/cases">Back to cases</a>' });
    if (caseTab.id !== c.id) caseTab = { id: c.id, tab: 'overview' };
    const cl = clientById(c.client); const adv = advById(c.adv);
    const docs = caseDocs(c); const orders = caseOrders(c); const tasks = caseTasks(c); const openTasks = tasks.filter(t => t.status !== 'Completed');
    const upcoming = caseUpcoming(c); const hist = D.hearingHistory(c.id);
    const invs = D.invoices.filter(i => i.caseId === c.id); const pays = D.payments.filter(p => p.caseId === c.id); const exps = D.expenses.filter(x => x.caseId === c.id);
    const related = relatedCases(c); const parties = caseParties(c); const notes = caseNotes(c); const acts = caseActs(c);
    const n = (x) => x ? ` <span class="badge-n">${x}</span>` : '';
    const tab = (k, l, cnt) => `<button data-tab="${k}" aria-selected="${caseTab.tab === k}">${l}${n(cnt)}</button>`;
    const pct = c.fee ? Math.min(100, Math.round(c.paid / c.fee * 100)) : 0;
    const juniors = [...new Set(D.advocates.filter(a => a.reportsTo === c.adv).map(a => a.id).concat(tasks.map(t => t.assignee)))].filter(x => x !== c.adv).map(advById).filter(Boolean);
    const docRow = (d) => `<tr><td><button class="link" style="background:none;border:0;padding:0;text-align:left" data-doc="${d.id}">${I(docIcon(d.ext), 'sm')} ${esc(d.name)}</button></td><td class="hide-sm">${esc(d.cat)}</td><td class="hide-sm mono xs">v${d.version}</td><td class="hide-sm">${fdate(d.date)}</td>
      <td><label class="switch"><input type="checkbox" data-share="${d.id}" ${d.shared ? 'checked' : ''} aria-label="Share ${esc(d.name)} with client"><span class="xs hide-sm">${d.shared ? 'Shared' : 'Private'}</span></label></td></tr>`;
    const docTable = (list, empty) => list.length ? `<div class="table-wrap"><table class="t"><thead><tr><th scope="col">Name</th><th scope="col" class="hide-sm">Category</th><th scope="col" class="hide-sm">Version</th><th scope="col" class="hide-sm">Added</th><th scope="col">Client can see</th></tr></thead><tbody>${list.map(docRow).join('')}</tbody></table></div>` : emptyState(empty);
    const taskRow = (t) => `<div class="cs-task ${t.status === 'Completed' ? 'done' : ''}"><input type="checkbox" id="tk${t.id}" data-task="${t.id}" ${t.status === 'Completed' ? 'checked' : ''}><label for="tk${t.id}" class="grow"><div class="ttl small">${esc(t.title)}</div><div class="cs-sub">${esc(advName(t.assignee))}, due ${rel(t.due)}</div></label>${t.review ? chip(t.review) : ''}${chip(t.priority)}</div>`;
    const next = c.next; const nd = next ? daysFrom(next) : null;
    const countdown = nd == null ? '' : nd === 0 ? (next > new Date() ? `Today, in ${Math.max(1, Math.round((next - new Date()) / 36e5))} h` : 'Today, in session') : nd === 1 ? 'Tomorrow' : `In ${nd} days`;

    return `<div class="cs-root"><header class="docket">
      <div class="row wrap" style="gap:var(--s3)"><span class="no">${esc(c.no)}</span><span class="faint xs">CNR</span><span class="mono xs">${esc(c.cnr || 'Not available')}</span>${c.cnr ? `<button class="btn ghost sm icon" data-act="copy" aria-label="Copy CNR">${I('copy', 'sm')}</button>` : ''}</div>
      <h1>${esc(c.party[0])}<span class="vs">vs</span>${esc(c.party[1])}</h1>
      <div class="meta-line">
        <span>${I('gavel', 'sm')}${esc(c.courtName)}, ${esc(c.hall)}</span>
        <span>${I('user', 'sm')}${esc(c.judge)}</span>
        <span>${I('file', 'sm')}${esc(c.type)}</span>
        <span>${I('calendar', 'sm')}Filed ${fdate(c.filed)}</span>
        <span>${I('shield', 'sm')}${esc(advName(c.adv))}</span>
      </div>
      <div class="row wrap" style="margin-top:var(--s4);gap:6px">${chip(c.status)}<span class="faint xs" style="margin:0 4px">${esc(c.stage)}</span>
        ${c.tags.map(t => `<span class="tag ${['High Priority', 'Urgent'].includes(t) ? 'hot' : ''}">${esc(t)}<button data-rmtag="${esc(t)}" aria-label="Remove tag ${esc(t)}">${I('x', 'sm')}</button></span>`).join('')}
        <button class="filter-chip" style="height:22px" data-pop data-act="addtag">${I('plus', 'sm')}Add tag</button>
      </div>
      <div class="row wrap" style="margin-top:var(--s5);gap:var(--s2)">
        <button class="btn primary" data-act="hearing">${I('calendar', 'sm')}Add hearing</button>
        <button class="btn" data-act="draft">${I('pen', 'sm')}Draft for this case</button>
        <button class="btn" data-act="invoice">${I('receipt', 'sm')}Raise invoice</button>
        <button class="btn ghost icon" data-pop data-act="more" aria-label="More actions" aria-haspopup="menu">${I('more')}</button>
      </div>
    </header>

    <div class="split" style="margin-top:var(--s6)">
      <div data-tab-scope style="min-width:0">
        <div class="tabs" data-tabs id="case-tabs">
          ${tab('overview', 'Overview')}${tab('parties', 'Parties', parties.length)}${tab('hearings', 'Hearings', upcoming.length + hist.length)}${tab('orders', 'Orders', orders.length)}${tab('docs', 'Documents', docs.length)}${tab('tasks', 'Tasks', openTasks.length)}${tab('billing', 'Billing', invs.length)}${tab('notes', 'Notes', notes.length)}${tab('related', 'Related cases', related.length)}${tab('acts', 'Acts', acts.length)}${tab('timeline', 'Timeline')}
        </div>

        <div data-panel="overview" class="stack" style="gap:var(--s5)">
          <div class="panel"><div class="panel-head"><h3>About this case</h3></div><div class="panel-body"><p>${esc(c.desc) || '<span class="faint">No description yet.</span>'}</p>
            <dl class="kv" style="margin-top:var(--s4)"><dt>Opposing counsel</dt><dd>${esc(c.opp)}</dd><dt>Bench</dt><dd>${esc(c.bench)}</dd><dt>Court level</dt><dd>${esc(c.level)}</dd></dl></div></div>
          <div class="panel"><div class="panel-head"><h3>Next hearing</h3><button class="btn ghost sm" data-goto="hearings">All hearings</button></div><div class="panel-body flush">
            ${next ? `<div class="slips"><div class="slip ${nd === 0 ? 'now' : ''}"><div class="item"><b>${c.item || '—'}</b><span>Item</span></div><div class="what"><div class="no">${esc(c.no)}</div><div class="ttl">${esc(c.stage)}</div><div class="where">${esc(c.hall)}, ${esc(c.judge)}</div></div><div class="when"><b>${ftime(next)}</b><span class="${nd === 0 ? 'cs-today' : 'faint'}">${rel(next)}</span></div></div></div>`
              : `<p class="faint small" style="padding:0 var(--s5) var(--s4)">No hearing is listed. ${c.status === 'Closed' ? 'This case is closed.' : 'Add one when the court gives a date.'}</p>`}
          </div></div>
          <div class="grid g-2">
            <div class="panel"><div class="panel-head"><h3>Last hearings</h3></div><div class="panel-body"><div class="timeline">${hist.slice(-3).reverse().map((h, i) => `<div class="tl-item ${i === 0 ? 'key' : ''}"><div class="small">${esc(h.outcome)}</div><div class="when">${fdate(h.date)}, ${esc(h.purpose)}</div></div>`).join('')}</div></div></div>
            <div class="panel"><div class="panel-head"><h3>Open tasks</h3><button class="btn ghost sm" data-act="task">${I('plus', 'sm')}Add</button></div><div class="panel-body flush">${openTasks.length ? openTasks.slice(0, 4).map(taskRow).join('') : '<p class="faint small" style="padding:0 var(--s5) var(--s4)">Nothing open on this case.</p>'}</div></div>
          </div>
          <div class="panel"><div class="panel-head"><h3>Recent documents</h3><button class="btn ghost sm" data-goto="docs">All documents</button></div><div class="panel-body flush"><div class="list">${docs.slice(0, 4).map(d => `<button class="list-item" style="background:none;border-left:0;border-right:0;border-bottom:0;width:100%;text-align:left;font:inherit;color:inherit;cursor:pointer" data-doc="${d.id}">${I(docIcon(d.ext), 'sm')}<span class="grow ellipsis small">${esc(d.name)}</span><span class="faint xs">${fdateShort(d.date)}</span></button>`).join('') || '<p class="faint small" style="padding:0 var(--s5) var(--s4)">No documents yet.</p>'}</div></div></div>
        </div>

        <div data-panel="parties" class="stack" style="gap:var(--s4)">
          <div class="table-wrap"><table class="t"><thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col" class="hide-sm">Counsel</th><th scope="col"><span class="sr-only">Side</span></th></tr></thead><tbody>
            ${parties.map((p, i) => `<tr><td>${esc(p.name)}</td><td>${esc(p.role)}</td><td class="hide-sm">${esc(p.counsel || '—')}</td><td class="right">${p.ours ? chip('Our client', 'info') : ''}${i >= 2 ? `<button class="btn ghost sm icon" data-rmparty="${i - 2}" aria-label="Remove ${esc(p.name)}">${I('trash', 'sm')}</button>` : ''}</td></tr>`).join('')}
          </tbody></table></div>
          <div class="panel"><div class="panel-head"><h3>Add a party</h3></div><div class="panel-body"><form id="party-f" class="form-grid" novalidate>
            ${field({ id: 'pf-name', label: 'Name', required: true, err: 'Enter the party\'s name.' })}
            ${field({ id: 'pf-role', label: 'Role', options: PARTY_ROLES, value: 'Respondent' })}
            ${field({ id: 'pf-counsel', label: 'Counsel', placeholder: 'Optional' })}
            <div class="row" style="align-self:end"><button class="btn primary" type="submit">Add party</button></div>
          </form></div></div>
        </div>

        <div data-panel="hearings" class="stack" style="gap:var(--s5)">
          <div class="panel"><div class="panel-head"><h3>Upcoming</h3><button class="btn sm" data-act="hearing">${I('plus', 'sm')}Add hearing</button></div><div class="panel-body flush">
            ${upcoming.length ? `<div class="list">${upcoming.map(e => `<div class="list-item"><div class="stamp ${daysFrom(e.at) === 0 ? 'today' : ''}"><span>${fdate(e.at, { month: 'short' })}</span><b>${new Date(e.at).getDate()}</b></div><div class="grow"><div class="small" style="font-weight:500">${esc(e.type === 'Hearing' ? (e.purpose || 'Hearing') : e.title)}</div><div class="cs-sub">${esc(e.type)}, ${ftime(e.at)}${e.hall ? ', ' + esc(e.hall) : ''}</div></div><span class="${daysFrom(e.at) === 0 ? 'cs-today small' : 'faint small'}">${rel(e.at)}</span></div>`).join('')}</div>` : '<p class="faint small" style="padding:0 var(--s5) var(--s4)">Nothing scheduled.</p>'}
          </div></div>
          <div><div class="section-title" style="margin-top:0"><h2>Court hearing history</h2><span class="faint xs">From court records</span></div>
          <div class="table-wrap"><table class="t"><thead><tr><th scope="col">Date</th><th scope="col" class="hide-sm">Cause list item</th><th scope="col" class="hide-sm">Judge</th><th scope="col">Purpose</th><th scope="col">Outcome</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>
            ${hist.slice().reverse().map(h => `<tr><td class="nowrap">${fdate(h.date)}</td><td class="mono hide-sm">${h.item}</td><td class="hide-sm small">${esc(h.judge)}</td><td>${esc(h.purpose)}</td><td class="small">${esc(h.outcome)}</td><td class="right"><button class="btn ghost sm" data-alert="${esc(fdate(h.date))}">${I('send', 'sm')}<span class="hide-sm">Send alert to client</span></button></td></tr>`).join('')}
          </tbody></table></div></div>
        </div>

        <div data-panel="orders" class="stack" style="gap:var(--s3)">
          <div class="row"><p class="muted small grow">Orders and judgments passed in this case.</p><button class="btn sm" data-act="uploadorder">${I('upload', 'sm')}Upload order</button></div>
          ${docTable(orders, { icon: 'gavel', title: 'No orders yet', text: 'Upload interim orders and judgments as the court passes them.' })}
        </div>

        <div data-panel="docs" class="stack" style="gap:var(--s3)">
          <div class="row"><p class="muted small grow">Shared documents appear on the client's portal.</p><button class="btn sm" data-act="upload">${I('upload', 'sm')}Upload</button></div>
          ${docTable(docs, { icon: 'folder', title: 'No documents yet', text: 'Upload the plaint, affidavits and evidence for this case.' })}
        </div>

        <div data-panel="tasks" class="stack" style="gap:var(--s3)">
          <div class="row"><p class="muted small grow">${openTasks.length} open, ${tasks.length - openTasks.length} done.</p><button class="btn sm" data-act="task">${I('plus', 'sm')}Add task</button></div>
          <div class="panel"><div class="panel-body flush" style="padding-bottom:var(--s2)">${tasks.length ? tasks.map(taskRow).join('') : emptyState({ icon: 'tasks', title: 'No tasks', text: 'Assign research, drafting or filing work to the team.' })}</div></div>
        </div>

        <div data-panel="billing" class="stack" style="gap:var(--s5)">
          <div class="figures"><div class="figure"><div class="lbl">Fee agreed</div><div class="val">${inrShort(c.fee)}</div></div><div class="figure"><div class="lbl">Paid</div><div class="val">${inrShort(c.paid)}</div></div><div class="figure"><div class="lbl">Outstanding</div><div class="val">${inrShort(outstanding(c))}</div></div></div>
          <div class="row wrap"><button class="btn" data-act="invoice">${I('receipt', 'sm')}Raise invoice</button><button class="btn" data-act="payment">${I('rupee', 'sm')}Record payment</button><button class="btn" data-act="expense">${I('wallet', 'sm')}Add expense</button></div>
          <div><h3 style="font-size:var(--t-md);margin-bottom:var(--s2)">Invoices</h3>${invs.length ? `<div class="table-wrap"><table class="t"><thead><tr><th scope="col">Invoice</th><th scope="col" class="hide-sm">Date</th><th scope="col" class="hide-sm">Due</th><th scope="col" class="right">Total</th><th scope="col">Status</th></tr></thead><tbody>${invs.map(i => `<tr class="clickable" data-href="/invoices?id=${i.id}"><td class="mono small">${esc(i.no)}</td><td class="hide-sm">${fdate(i.date)}</td><td class="hide-sm">${fdate(i.due)}</td><td class="mono right">${inr(i.total)}</td><td>${chip(i.status)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="faint small">No invoices raised yet.</p>'}</div>
          <div><h3 style="font-size:var(--t-md);margin-bottom:var(--s2)">Payments</h3>${pays.length ? `<div class="table-wrap"><table class="t"><thead><tr><th scope="col">Date</th><th scope="col">Mode</th><th scope="col" class="hide-sm">Reference</th><th scope="col" class="right">Amount</th></tr></thead><tbody>${pays.map(p => `<tr><td>${fdate(p.date)}</td><td>${esc(p.mode)}</td><td class="mono xs hide-sm">${esc(p.ref)}</td><td class="mono right">${inr(p.amount)}</td></tr>`).join('')}<tr><td colspan="3" class="right"><b>Total received</b></td><td class="mono right"><b>${inr(pays.reduce((s, p) => s + p.amount, 0))}</b></td></tr></tbody></table></div>` : '<p class="faint small">No payments recorded.</p>'}</div>
          <div><h3 style="font-size:var(--t-md);margin-bottom:var(--s2)">Expenses</h3>${exps.length ? `<div class="table-wrap"><table class="t"><thead><tr><th scope="col">Date</th><th scope="col">For</th><th scope="col" class="hide-sm">Category</th><th scope="col" class="right">Amount</th></tr></thead><tbody>${exps.map(x => `<tr><td>${fdate(x.date)}</td><td>${esc(x.title)}</td><td class="hide-sm">${esc(x.cat)}</td><td class="mono right">${inr(x.amount)}</td></tr>`).join('')}<tr><td colspan="3" class="right"><b>Total spent</b></td><td class="mono right"><b>${inr(exps.reduce((s, x) => s + x.amount, 0))}</b></td></tr></tbody></table></div>` : '<p class="faint small">No expenses logged.</p>'}</div>
        </div>

        <div data-panel="notes" class="stack" style="gap:var(--s4)">
          <form id="note-f" class="panel" novalidate><div class="panel-body stack" style="gap:var(--s3)">
            ${field({ id: 'note-text', label: 'Add a note', type: 'textarea', rows: 3, required: true, placeholder: 'Only your team can see notes', err: 'Write something first.' })}
            <div class="row"><span class="grow"></span><button class="btn primary sm" type="submit">Add note</button></div></div></form>
          <div class="panel"><div class="panel-body" style="padding-block:var(--s2)">${notes.length ? notes.map(nt => `<div class="cs-note"><div class="row">${avatar(nt.by, 'sm')}<b class="small">${esc(nt.by)}</b><span class="faint xs">${ago(nt.at)}</span><span class="grow"></span><button class="btn ghost sm icon" data-rmnote="${nt.id}" aria-label="Delete note">${I('trash', 'sm')}</button></div><p class="small" style="margin-top:6px;white-space:pre-wrap">${esc(nt.text)}</p></div>`).join('') : '<p class="faint small" style="padding:var(--s3) 0">No notes yet.</p>'}</div></div>
        </div>

        <div data-panel="related" class="stack" style="gap:var(--s3)">
          <p class="muted small">Cases for the same client or between the same parties. Change the relation to keep the file tidy.</p>
          ${related.length ? `<div class="table-wrap"><table class="t"><thead><tr><th scope="col">Case</th><th scope="col" class="hide-sm">Court</th><th scope="col">Relation</th><th scope="col">Status</th></tr></thead><tbody>${related.map(({ o, rel: r }) => `<tr><td><a class="link mono small" href="#/cases/${o.id}">${esc(o.no)}</a><div class="cs-sub">${esc(o.title)}</div></td><td class="hide-sm small">${esc(o.courtName)}</td><td><button class="tag" style="cursor:pointer" data-pop data-rel="${o.id}" aria-label="Change relation, now ${esc(r)}">${esc(r)} ${I('chevronDown', 'sm')}</button></td><td>${chip(o.status)}</td></tr>`).join('')}</tbody></table></div>` : emptyState({ icon: 'link', title: 'No related cases', text: 'Appeals and connected matters for this client will show here.' })}
        </div>

        <div data-panel="acts" class="stack" style="gap:var(--s3)">
          <p class="muted small">Provisions this case is argued under. Linked acts open in the library.</p>
          <div class="row wrap" style="gap:6px">${acts.map((a, i) => `<span class="tag">${I('book', 'sm')}${esc(a)}<button data-rmact="${i}" aria-label="Unlink ${esc(a)}">${I('x', 'sm')}</button></span>`).join('')}
            <button class="filter-chip" data-pop data-act="linkact">${I('plus', 'sm')}Link act</button></div>
        </div>

        <div data-panel="timeline"><div class="timeline">${caseTimeline(c).map(it => `<div class="tl-item ${it.key ? 'key' : ''}"><div class="small"><b>${esc(it.title)}</b></div><div class="small muted">${esc(it.sub)}</div><div class="when">${fdate(it.at)}</div></div>`).join('')}</div></div>
      </div>

      <aside class="rail stack" style="gap:var(--s4)" aria-label="Case summary">
        <div class="panel"><div class="panel-head"><h3>Next hearing</h3>${nd === 0 ? chip('Today', 'tape') : ''}</div><div class="panel-body">
          ${next ? `<div class="cs-big-date">${fdate(next, { day: 'numeric', month: 'long' })}</div>
            <div class="muted small" style="margin:4px 0 var(--s3)">${fdate(next, { weekday: 'long' })}, ${ftime(next)}. <span class="${nd === 0 ? 'cs-today' : ''}">${countdown}</span></div>
            <dl class="kv"><dt>Hall</dt><dd>${esc(c.hall)}</dd><dt>Item no.</dt><dd class="mono">${c.item || '—'}</dd><dt>Purpose</dt><dd>${esc(c.stage)}</dd></dl>
            <div class="row wrap" style="margin-top:var(--s4)"><button class="btn sm" data-act="ics">${I('calendar', 'sm')}Add to calendar</button><button class="btn sm" data-act="remind">${I('send', 'sm')}Send client reminder</button></div>`
            : `<p class="faint small">Not listed. ${c.status === 'Closed' ? 'The case is closed.' : ''}</p>`}
        </div></div>
        <div class="panel"><div class="panel-head"><h3>Fees</h3><button class="btn ghost sm" data-goto="billing">Billing</button></div><div class="panel-body">
          <div class="row between small"><span class="muted">Paid</span><span class="mono">${inr(c.paid)} of ${inr(c.fee)}</span></div>
          <div class="meter" style="margin:8px 0" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Fee paid"><i style="width:${pct}%;background:${pct >= 100 ? 'var(--ok)' : 'var(--ink)'}"></i></div>
          <div class="row between small"><span class="muted">Outstanding</span><b class="mono">${inr(outstanding(c))}</b></div>
        </div></div>
        <div class="panel"><div class="panel-head"><h3>Client</h3></div><div class="panel-body">
          <div class="row">${avatar(cl.name)}<div class="grow"><a class="link" href="#/clients/${cl.id}"><b>${esc(cl.name)}</b></a><div class="cs-sub">${esc(cl.kind)}, ${esc(cl.city)}</div></div></div>
          <div class="stack small" style="gap:6px;margin-top:var(--s3)"><span class="row">${I('phone', 'sm')}<span class="mono">${esc(cl.phone)}</span></span><span class="row">${I('mail', 'sm')}<span class="ellipsis">${esc(cl.email)}</span></span></div>
          <div style="margin-top:var(--s3)">${cl.portal ? chip('Portal access on', 'ok') : chip('No portal access', '')}</div>
        </div></div>
        <div class="panel"><div class="panel-head"><h3>Team</h3><button class="btn ghost sm" data-act="transfer">Transfer</button></div><div class="panel-body flush"><div class="list">
          ${adv ? `<div class="list-item">${avatar(adv.name, 'sm')}<div class="grow"><div class="small"><b>${esc(adv.name)}</b></div><div class="cs-sub">Handling advocate</div></div></div>` : ''}
          ${juniors.map(j => `<div class="list-item">${avatar(j.name, 'sm')}<div class="grow"><div class="small">${esc(j.name)}</div><div class="cs-sub">${esc(j.role)}</div></div></div>`).join('')}
        </div></div></div>
      </aside>
    </div></div>`;
  },
  mount(page, { id }) {
    const c = caseById(id); if (!c) return;
    const root = page.querySelector('.cs-root');
    const redraw = () => router();
    const tl = root.querySelector('#case-tabs');
    tl.addEventListener('tabchange', e => { caseTab.tab = e.detail; });
    const showTab = (k) => { const b = tl.querySelector(`[data-tab="${k}"]`); b && b.click(); root.querySelector('#case-tabs').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };

    const more = (btn) => popMenu(btn, [
      { label: 'Refresh court data', icon: 'refresh', onClick: () => { btn.classList.add('loading'); setTimeout(() => { btn.classList.remove('loading'); toast('Court record refreshed'); }, 900); } },
      { label: 'Transfer case…', icon: 'swap', onClick: transfer },
      { label: 'Mark disposed', icon: 'check', onClick: () => confirmDialog({ title: 'Mark this case disposed?', text: 'The case is closed and removed from hearing reminders. Billing stays open.', confirm: 'Mark disposed', onConfirm: () => { c.status = 'Closed'; c.stage = 'Disposed'; c.next = null; refreshNav(); redraw(); toast('Case marked disposed'); } }) },
      { label: 'Archive', icon: 'archive', onClick: () => confirmDialog({ title: 'Archive this case?', text: `<b class="mono">${esc(c.no)}</b> moves to archived cases. You can restore it from the register.`, confirm: 'Archive case', onConfirm: () => { c.status = 'Closed'; c.next = null; refreshNav(); redraw(); toast('Case archived'); } }) },
      '-',
      { label: 'Delete permanently', icon: 'trash', danger: true, onClick: () => confirmDialog({ title: 'Delete this case permanently?', danger: true, confirm: 'Delete case', typeToConfirm: c.no, text: 'This removes the case, its hearings and its notes. Documents and invoices stay in their registers. This cannot be undone.', onConfirm: () => { D.cases.splice(D.cases.indexOf(c), 1); D.events = D.events.filter(e => e.caseId !== c.id); refreshNav(); go('/cases'); toast(`${esc(c.no)} deleted`); } }) },
    ], { width: 240 });

    function transfer() {
      modal({
        title: 'Transfer case', sub: `<span class="mono">${esc(c.no)}</span>`, size: 'narrow',
        body: `<form id="tr-f" class="stack" novalidate>${field({ id: 'tr-adv', label: 'New handling advocate', options: D.advocates.filter(a => a.role.includes('Advocate') && a.id !== c.adv).map(a => [a.id, a.name]), placeholder: 'Select an advocate', required: true, err: 'Choose who takes over.' })}
          ${field({ id: 'tr-note', label: 'Handover note', type: 'textarea', placeholder: 'Optional' })}<label class="check"><input type="checkbox" checked> Notify both advocates</label></form>`,
        foot: '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="tr-save">Transfer case</button>',
        onMount(el, close) {
          el.querySelector('#tr-save').onclick = (e) => {
            if (!validateForm(el.querySelector('#tr-f'))) return;
            busy(e.currentTarget, () => { c.adv = +el.querySelector('#tr-adv').value; close(); redraw(); toast(`Case transferred to ${esc(advName(c.adv))}`); });
          };
        },
      });
    }

    root.addEventListener('click', e => {
      const t = e.target;
      const act = t.closest('[data-act]');
      if (act) {
        const a = act.dataset.act;
        if (a === 'copy') { try { navigator.clipboard.writeText(c.cnr); } catch { /* clipboard blocked */ } toast(`CNR <span class="mono">${esc(c.cnr)}</span> copied`); }
        if (a === 'hearing') FORMS.event({ caseId: c.id, onSave: redraw });
        if (a === 'draft') go('/drafting/new?caseId=' + c.id);
        if (a === 'invoice') FORMS.invoice({ caseId: c.id, onSave: redraw });
        if (a === 'payment') FORMS.payment({ caseId: c.id, onSave: redraw });
        if (a === 'expense') FORMS.expense({ caseId: c.id, onSave: redraw });
        if (a === 'upload') FORMS.upload({ caseId: c.id, onSave: redraw });
        if (a === 'uploadorder') FORMS.upload({ caseId: c.id, cat: 'Court Order', onSave: redraw });
        if (a === 'task') FORMS.task({ caseId: c.id, onSave: redraw });
        if (a === 'more') more(act);
        if (a === 'transfer') transfer();
        if (a === 'ics') toast(`Hearing on ${fdate(c.next)} added to your calendar`);
        if (a === 'remind') toast(`Hearing reminder emailed to ${esc(clientById(c.client).email)}`);
        if (a === 'addtag') {
          const avail = CASE_TAGS.filter(x => !c.tags.includes(x));
          if (!avail.length) { toast('All tags are already on this case', 'info'); return; }
          popMenu(act, avail.map(x => ({ label: x, icon: 'tag', onClick: () => { c.tags.push(x); redraw(); toast(`Tagged ${esc(x)}`); } })), { align: 'left', width: 220 });
        }
        if (a === 'linkact') {
          popMenu(act, D.acts.map(x => ({ label: esc(x.title), onClick: () => {
            const sec = x.id === 1 ? 'Sec. 151' : 'Sec. 1';
            const label = `${ACT_SHORT[x.id]} ${sec}`;
            if (!c.acts.includes(label)) c.acts.push(label);
            redraw(); toast(`Linked ${esc(x.title)}`);
          } })), { align: 'left', width: 320 });
        }
        return;
      }
      const rmt = t.closest('[data-rmtag]');
      if (rmt) { const x = rmt.dataset.rmtag; c.tags = c.tags.filter(y => y !== x); redraw(); toast(`Removed tag ${esc(x)}`, 'ok', {}); return; }
      const gt = t.closest('[data-goto]'); if (gt) { showTab(gt.dataset.goto); return; }
      const dc = t.closest('[data-doc]'); if (dc) { previewDoc(D.documents.find(d => d.id === +dc.dataset.doc)); return; }
      const al = t.closest('[data-alert]'); if (al) { toast(`Hearing outcome of ${esc(al.dataset.alert)} sent to ${esc(clientById(c.client).name)}`); return; }
      const rp = t.closest('[data-rmparty]'); if (rp) { const p = c.extraParties.splice(+rp.dataset.rmparty, 1)[0]; redraw(); toast(`Removed ${esc(p.name)}`); return; }
      const rn = t.closest('[data-rmnote]'); if (rn) { c.notes = c.notes.filter(x => x.id !== +rn.dataset.rmnote); redraw(); toast('Note deleted'); return; }
      const ra = t.closest('[data-rmact]'); if (ra) { const x = c.acts.splice(+ra.dataset.rmact, 1)[0]; redraw(); toast(`Unlinked ${esc(x)}`); return; }
      const rl = t.closest('[data-rel]');
      if (rl) { popMenu(rl, RELATIONS.map(r => ({ label: r, onClick: () => { c.relations[+rl.dataset.rel] = r; redraw(); toast(`Marked as ${r}`); } })), { align: 'left', width: 200 }); return; }
      const hr = t.closest('tr[data-href]'); if (hr) go(hr.dataset.href);
    });

    root.addEventListener('change', e => {
      const sh = e.target.closest('[data-share]');
      if (sh) { const d = D.documents.find(x => x.id === +sh.dataset.share); d.shared = sh.checked; redraw(); toast(d.shared ? `${esc(d.name)} shared with the client` : `${esc(d.name)} is now private`); return; }
      const tk = e.target.closest('[data-task]');
      if (tk) { const task = D.tasks.find(x => x.id === +tk.dataset.task); task.status = tk.checked ? 'Completed' : 'In Progress'; refreshNav(); redraw(); toast(tk.checked ? 'Task completed' : 'Task reopened'); }
    });

    root.addEventListener('submit', e => {
      e.preventDefault(); const f = e.target;
      if (f.id === 'party-f') {
        if (!validateForm(f)) return;
        (c.extraParties = c.extraParties || []).push({ name: f.querySelector('#pf-name').value.trim(), role: f.querySelector('#pf-role').value, counsel: f.querySelector('#pf-counsel').value.trim() || '—', ours: false });
        redraw(); toast('Party added');
      }
      if (f.id === 'note-f') {
        if (!validateForm(f)) return;
        c.notes.unshift({ id: Math.max(0, ...c.notes.map(x => x.id)) + 1, by: D.me.name, at: new Date(), text: f.querySelector('#note-text').value.trim() });
        redraw(); toast('Note added');
      }
    });
  },
});
