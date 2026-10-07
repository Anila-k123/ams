/* ==========================================================================
   PAGES 4: Library (Acts, Law codes, Dictionary) and Drafting
   (Drafts, New draft wizard, Editor, Templates, Playbooks, Translate).
   Wrapped in an IIFE so helper names never collide with other page files.
   ========================================================================== */
(() => {

/* Small additions for this module only. Every colour is a token, except
   inside .paper-sheet, which is intentionally paper-white in both themes. */
document.head.insertAdjacentHTML('beforeend', `<style>
.pp-spin{display:inline-block;width:12px;height:12px;border-radius:50%;border:2px solid var(--line-strong);border-top-color:var(--ink-2);animation:spin .7s linear infinite;vertical-align:-2px}
.pp-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pp-card{display:block;color:inherit;text-decoration:none;transition:border-color var(--d-fast),box-shadow var(--d-fast)}
a.pp-card:hover{border-color:var(--line-strong);box-shadow:var(--e-2)}
.pp-card h3{font:500 var(--t-lg)/1.35 var(--f-display)}
.pp-acc{border-top:1px solid var(--line)}
.pp-acc:first-child{border-top:0}
.pp-acc>summary{list-style:none;cursor:pointer;display:flex;gap:10px;align-items:baseline;padding:12px 0}
.pp-acc>summary::-webkit-details-marker{display:none}
.pp-acc>summary .chev{transition:transform var(--d-fast);align-self:center}
.pp-acc[open]>summary .chev{transform:rotate(90deg)}
.pp-acc .acc-body{padding:0 0 14px 26px;color:var(--ink-2);font-size:var(--t-sm);line-height:1.65}
.pp-big{font:400 var(--t-2xl) var(--f-display);height:56px;padding-left:44px!important}
.pp-big-wrap .i{left:14px!important;width:20px;height:20px}
.cite-bar{width:56px;height:6px}
.wz-steps{display:flex;gap:6px 18px;flex-wrap:wrap;list-style:none;padding:0;margin:0 0 var(--s5)}
.wz-steps li{display:flex;align-items:center;gap:8px;color:var(--ink-3);font-size:var(--t-sm)}
.wz-steps .n{width:24px;height:24px;border-radius:50%;border:1px solid var(--line-strong);display:grid;place-items:center;font:500 12px var(--f-mono)}
.wz-steps li[aria-current="step"]{color:var(--ink);font-weight:500}
.wz-steps li[aria-current="step"] .n{background:var(--ink);border-color:var(--ink);color:var(--ink-inverse)}
.wz-steps li.done .n{background:var(--ok-soft);border-color:transparent;color:var(--ok)}
.pp-opt{display:flex;flex-direction:column;align-items:flex-start;gap:8px;text-align:left;padding:var(--s6);border:1px solid var(--line);border-radius:var(--r-lg);background:var(--surface);color:var(--ink);cursor:pointer;transition:border-color var(--d-fast),box-shadow var(--d-fast)}
.pp-opt:hover{border-color:var(--ink);box-shadow:var(--e-2)}
.pp-opt h3{font:500 var(--t-xl) var(--f-display)}
.ed-top{display:flex;align-items:center;gap:var(--s2);flex-wrap:wrap;margin-bottom:var(--s3)}
.ed-top h1{font-size:var(--t-xl)}
.ed-tools{display:flex;gap:2px;align-items:center;flex-wrap:wrap;padding:6px 10px;border-bottom:1px solid var(--line);background:var(--surface-2);position:sticky;top:0;z-index:2}
.ed-tools .sep{width:1px;height:20px;background:var(--line);margin:0 6px}
.ed-mid{background:var(--surface-3);overflow:auto;max-height:78vh}
.ed-side{max-height:78vh}
.ed-sec{padding:var(--s4)}
.ed-sec+.ed-sec{border-top:1px solid var(--line)}
.ed-sec h3{font-size:var(--t-sm);font-weight:600;margin-bottom:10px}
.paper-sheet [data-para]{margin-bottom:12px;text-align:justify;transition:background 1s}
.paper-sheet [contenteditable="true"]:focus,.paper-sheet[contenteditable="true"]:focus{outline:none}
.paper-sheet .ph.filled{background:none;border-bottom:1px solid #9AA3AE;font-family:inherit;font-size:inherit;padding:0}
.paper-sheet.preview .ph{background:none;border-bottom:0;font-family:inherit;font-size:inherit;padding:0}
.paper-sheet.preview .cite{display:none}
.paper-sheet.preview .risk{text-decoration:none}
.paper-sheet .flash{background:#FFF3C4}
.paper-sheet mark.find-hit{background:#FFE08A;color:inherit;padding:0}
.pp-chat{display:flex;flex-direction:column;gap:10px}
.pp-msg{padding:10px 12px;border-radius:var(--r-md);font-size:var(--t-sm);line-height:1.55;max-width:94%}
.pp-msg.me{align-self:flex-end;background:var(--ink);color:var(--ink-inverse)}
.pp-msg.ai{background:var(--surface-2);border:1px solid var(--line)}
.pp-del{color:var(--bad);background:var(--bad-soft);text-decoration:line-through;padding:0 2px;border-radius:2px}
.pp-add{color:var(--ok);background:var(--ok-soft);padding:0 2px;border-radius:2px}
.pp-pill{height:28px;padding:0 10px;border-radius:var(--r-pill);border:1px solid var(--line-strong);background:var(--surface);color:var(--ink-2);font-size:var(--t-xs)}
.pp-pill:hover{border-color:var(--ink);color:var(--ink)}
.pp-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s4)}
.pp-two .paper-sheet{margin:0;width:100%;padding:36px 38px;font-size:14px}
@media (max-width:760px){.pp-two{grid-template-columns:1fr}.ed-mid,.ed-side{max-height:none}}
</style>`);

/* ---------- shared bits ---------- */
const isTN = (a) => a.juris === 'Tamil Nadu';
const jurChip = (a) => chip(a.juris, isTN(a) ? 'tape' : 'info');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const nextId = (arr) => Math.max(0, ...arr.map(x => x.id)) + 1;

/* ==========================================================================
   1. ACTS: search the bare-act library
   ========================================================================== */
const ACT_FIELDS = {
  'Short title': 'Search by short title, like Arbitration',
  'Long title': 'Search the long title, like consolidate and amend',
  Department: 'Search by ministry or department',
  'Section title': 'Search section headings, like res judicata',
  'Act number': 'Enter an act number, like 26',
  'Act year': 'Enter a year like 2023, or a range like 2010-2015',
};
const genericChapters = () => [
  { ch: 'Chapter I: Preliminary', items: [['1', 'Short title, extent and commencement'], ['2', 'Definitions']] },
  { ch: 'Chapter II: Substantive provisions', items: [['3', 'Application of the Act'], ['4', 'Powers of the appropriate authority'], ['5', 'Procedure to be followed']] },
  { ch: 'Chapter III: Miscellaneous', items: [['6', 'Power to make rules'], ['7', 'Repeal and savings']] },
];
const chaptersFor = (a) => a.id === 1 ? D.actSections : genericChapters();
const CPC_TEXT = {
  9: 'The Courts shall (subject to the provisions herein contained) have jurisdiction to try all suits of a civil nature excepting suits of which their cognizance is either expressly or impliedly barred.',
  10: 'No Court shall proceed with the trial of any suit in which the matter in issue is also directly and substantially in issue in a previously instituted suit between the same parties, or between parties under whom they or any of them claim litigating under the same title, where such suit is pending in the same or any other Court in India having jurisdiction to grant the relief claimed.',
  11: 'No Court shall try any suit or issue in which the matter directly and substantially in issue has been directly and substantially in issue in a former suit between the same parties, or between parties under whom they or any of them claim, litigating under the same title, in a Court competent to try such subsequent suit, and has been heard and finally decided by such Court.',
  20: 'Subject to the limitations aforesaid, every suit shall be instituted in a Court within the local limits of whose jurisdiction (a) the defendant actually and voluntarily resides, or carries on business, or personally works for gain; or (b) any of the defendants so resides, where there are more than one; or (c) the cause of action, wholly or in part, arises.',
  96: 'Save where otherwise expressly provided in the body of this Code or by any other law for the time being in force, an appeal shall lie from every decree passed by any Court exercising original jurisdiction to the Court authorised to hear appeals from the decisions of such Court.',
  100: 'Save as otherwise expressly provided, an appeal shall lie to the High Court from every decree passed in appeal by any Court subordinate to the High Court, if the High Court is satisfied that the case involves a substantial question of law.',
  104: 'An appeal shall lie from the orders listed in this section, and save as otherwise expressly provided in the body of this Code or by any law for the time being in force, from no other orders.',
  113: 'Subject to such conditions and limitations as may be prescribed, any Court may state a case and refer the same for the opinion of the High Court, and the High Court may make such order thereon as it thinks fit.',
  114: 'Any person considering himself aggrieved by a decree or order from which an appeal is allowed but no appeal has been preferred, or from which no appeal is allowed, may apply for a review of judgment to the Court which passed the decree or made the order.',
  115: 'The High Court may call for the record of any case decided by any Court subordinate to it in which no appeal lies, if such subordinate Court appears to have exercised a jurisdiction not vested in it by law, or failed to exercise a jurisdiction so vested, or acted illegally or with material irregularity.',
};
const sectionText = (a, no, title) => CPC_TEXT[no] && a.id === 1 ? CPC_TEXT[no]
  : `${title}. This section of ${a.title.replace(/^The /, 'the ')} sets out the rule on ${title.toLowerCase()}, subject to the other provisions of this Act and any rules made under it.`;

const ENACTED = { 1: '1908-03-21', 2: '2023-12-25', 3: '2023-12-25', 4: '1996-08-16', 5: '1881-12-09', 6: '2017-11-22', 7: '2019-08-09', 8: '1955-12-31', 9: '2023-12-25', 10: '1955-05-18' };
const LINKED = { 1: [2, 16, 19, 25], 2: [23], 3: [9, 14], 4: [5, 21], 5: [10], 6: [22, 1], 7: [13], 8: [1], 9: [], 10: [18] };

function actMatches(a, f, q) {
  if (!q) return true;
  const s = q.toLowerCase();
  if (f === 'Short title') return a.title.toLowerCase().includes(s);
  if (f === 'Long title') return a.desc.toLowerCase().includes(s);
  if (f === 'Department') return (a.ministry + ' ' + a.dept).toLowerCase().includes(s);
  if (f === 'Section title') return chaptersFor(a).some(c => c.items.some(([, t]) => t.toLowerCase().includes(s)));
  if (f === 'Act number') return String(a.no) === q.trim();
  if (f === 'Act year') { const [x, y] = q.split('-').map(Number); return a.year >= x && a.year <= (y || x); }
  return true;
}

page('/acts', {
  title: 'Acts', perm: 'CASE_VIEW', skeleton: 'table',
  render: () => `
    <div class="page-head"><div><h1>Acts</h1><p>Central and Tamil Nadu bare acts with sections, amendments and the cases you have linked to them.</p></div></div>
    <div class="toolbar">
      <div class="input-icon" style="width:min(420px,100%)">${I('search', 'sm')}<input class="input" id="act-q" type="search" aria-label="Search acts" placeholder="${ACT_FIELDS['Short title']}"></div>
      <div class="seg" data-seg id="act-j" role="group" aria-label="Jurisdiction"><button data-v="All" aria-pressed="true">All</button><button data-v="Central" aria-pressed="false">Central</button><button data-v="Tamil Nadu" aria-pressed="false">Tamil Nadu</button></div>
    </div>
    <div class="row wrap" id="act-f" role="group" aria-label="Search in" style="margin-bottom:8px">${Object.keys(ACT_FIELDS).map((f, i) => `<button class="filter-chip" data-f="${f}" aria-pressed="${i === 0}">${f}</button>`).join('')}</div>
    <div class="field" id="act-field" style="margin-bottom:12px"><span class="err" role="alert">${I('warn', 'sm')}Enter a 4-digit year like 2023, or a range like 2010-2015.</span></div>
    <div class="faint small" id="act-count" style="margin-bottom:10px"></div>
    <div class="stack" id="act-list"></div>`,
  mount(root) {
    const st = { q: '', j: 'All', f: 'Short title' };
    const inp = root.querySelector('#act-q'); const fld = root.querySelector('#act-field');
    const draw = () => {
      let bad = false;
      if (st.f === 'Act year' && st.q) {
        const m = st.q.trim().match(/^(\d{4})(?:-(\d{4}))?$/);
        bad = !m || (m[2] && +m[2] < +m[1]);
      }
      fld.classList.toggle('invalid', bad); inp.setAttribute('aria-invalid', bad);
      const list = root.querySelector('#act-list');
      if (bad) { list.innerHTML = ''; root.querySelector('#act-count').textContent = ''; return; }
      const rows = D.acts.filter(a => (st.j === 'All' || a.juris === st.j) && actMatches(a, st.f, st.q.trim()));
      root.querySelector('#act-count').textContent = `${rows.length} ${rows.length === 1 ? 'act' : 'acts'}`;
      list.innerHTML = rows.length ? rows.map(a => `<a class="panel pp-card" href="#/acts/${a.id}"><div class="panel-body" style="padding:16px 20px">
          <div class="row wrap" style="gap:10px;margin-bottom:6px">${jurChip(a)}<span class="mono faint small">Act ${a.no} of ${a.year}</span></div>
          <h3>${esc(a.title)}</h3>
          <p class="muted small" style="margin-top:4px">${esc(a.desc)}</p>
          <div class="faint xs" style="margin-top:8px">${esc(a.ministry)}${a.dept !== a.ministry ? ', ' + esc(a.dept) : ''}</div></div></a>`).join('')
        : `<div class="panel">${emptyState({ icon: 'book', title: 'No acts match', text: 'Try a shorter word such as "arbitration" or "tenants". To search by year, choose Act year and enter 2023 or 2010-2020.', action: '<button class="btn sm" id="act-reset">Clear search</button>' })}</div>`;
      const r = root.querySelector('#act-reset'); if (r) r.onclick = () => { inp.value = ''; st.q = ''; draw(); inp.focus(); };
    };
    inp.addEventListener('input', debounce(() => { st.q = inp.value; draw(); }, 250));
    root.querySelector('#act-j').addEventListener('segchange', e => { st.j = e.detail; draw(); });
    root.querySelector('#act-f').addEventListener('click', e => {
      const b = e.target.closest('[data-f]'); if (!b) return;
      root.querySelectorAll('#act-f [data-f]').forEach(x => x.setAttribute('aria-pressed', x === b));
      st.f = b.dataset.f; inp.placeholder = ACT_FIELDS[st.f]; inp.setAttribute('aria-label', 'Search acts by ' + st.f.toLowerCase());
      inp.inputMode = ['Act number', 'Act year'].includes(st.f) ? 'numeric' : 'text';
      draw(); inp.focus();
    });
    draw();
  },
});

/* ==========================================================================
   2. ACT DETAIL: sections, act papers, linked cases
   ========================================================================== */
page('/acts/:id', {
  title: (p) => { const a = D.acts.find(x => x.id === +p.id); return a ? a.title.replace(/^The /, '') : 'Act not found'; },
  crumbs: [['Acts', '/acts']], perm: 'CASE_VIEW', skeleton: 'detail',
  render(p) {
    const a = D.acts.find(x => x.id === +p.id);
    if (!a) return emptyState({ icon: 'book', title: 'This act is not in the library', text: 'It may have been removed, or the link is wrong.', action: '<a class="btn" href="#/acts">Back to acts</a>' });
    const chs = chaptersFor(a);
    const summary = `${a.desc} It applies ${isTN(a) ? 'throughout the State of Tamil Nadu' : 'to the whole of India'} and has been amended from time to time. The text shown here is the consolidated version as on ${fdate(TODAY)}, with amendments incorporated in the relevant sections and notes on omitted provisions.`;
    return `
    <div class="panel" style="margin-bottom:20px"><div class="panel-body" style="padding:24px">
      <div class="row wrap" style="gap:10px">${jurChip(a)}<span class="mono faint small">Act ${a.no} of ${a.year}</span></div>
      <div class="row between wrap" style="align-items:flex-start;gap:16px;margin-top:8px">
        <h1 style="font-size:var(--t-2xl);max-width:30ch">${esc(a.title)}</h1>
        <div class="row wrap"><button class="btn" id="act-pdf">${I('file', 'sm')}View PDF</button><button class="btn primary" id="act-link">${I('link', 'sm')}Link to a case</button></div>
      </div>
      <p class="muted pp-clamp" id="act-sum" style="margin-top:10px;max-width:75ch">${esc(summary)}</p>
      <button class="link small" id="act-more" aria-expanded="false" style="background:none;border:0;padding:0;margin-top:4px">Show more</button>
      <dl class="kv" style="margin-top:16px"><dt>Ministry</dt><dd>${esc(a.ministry)}</dd><dt>Department</dt><dd>${esc(a.dept)}</dd><dt>Enactment date</dt><dd>${fdate(ENACTED[a.id] || a.year + '-01-01')}</dd><dt>Sections</dt><dd class="num">${a.sections}</dd></dl>
    </div></div>
    <div data-tab-scope>
      <div class="tabs" data-tabs><button data-tab="sec">Sections</button><button data-tab="papers">Act papers</button><button data-tab="cases">Cases linked <span class="faint" id="lc-n">${(LINKED[a.id] || []).length}</span></button></div>
      <div class="tab-panel" data-panel="sec"><div class="split left-rail">
        <div class="panel" style="padding:6px 0" role="list" aria-label="Chapters">${chs.map((c, i) => `<button class="list-item ${i === 0 ? 'sel' : ''}" data-ch="${i}" aria-current="${i === 0}"><span class="grow small">${esc(c.ch)}</span><span class="faint xs num">${c.items.length}</span></button>`).join('')}</div>
        <div class="panel"><div class="panel-body" id="sec-body"></div></div>
      </div></div>
      <div class="tab-panel" data-panel="papers" hidden><div class="table-wrap"><table class="t"><thead><tr><th scope="col">Type</th><th scope="col">Title</th><th scope="col">Date</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>
        ${[['Gazette', `Gazette of India, Extraordinary, Part II: ${a.title}`, ENACTED[a.id] || a.year + '-01-01'], ['Amendment', `${a.title.replace(/, \d{4}$/, '')} (Amendment) Act, ${Math.max(a.year + 3, 2019)}`, `${Math.max(a.year + 3, 2019)}-08-14`], ['Rules', `${isTN(a) ? 'Tamil Nadu ' : ''}${a.title.replace(/^The /, '').replace(/ Act.*| Code.*| Sanhita.*| Adhiniyam.*/, '')} Rules, ${Math.max(a.year + 1, 2020)}`, `${Math.max(a.year + 1, 2020)}-03-02`]].map(([t, n, d]) => `<tr><td>${chip(t, t === 'Gazette' ? 'info' : t === 'Amendment' ? 'warn' : '')}</td><td>${esc(n)}</td><td class="num">${fdate(d)}</td><td class="right"><button class="btn ghost sm" data-paper="${esc(n)}">${I('download', 'sm')}PDF</button></td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="tab-panel" data-panel="cases" hidden><div class="panel" id="lc-list"></div></div>
    </div>`;
  },
  mount(root, p) {
    const a = D.acts.find(x => x.id === +p.id); if (!a) return;
    const chs = chaptersFor(a);
    const drawSec = (i) => {
      const c = chs[i];
      root.querySelector('#sec-body').innerHTML = `<h3 class="serif" style="font-size:var(--t-lg);font-weight:500;margin-bottom:6px">${esc(c.ch)}</h3>` + c.items.map(([no, t], j) => `<details class="pp-acc" ${j === 0 ? 'open' : ''}><summary>${I('chevron', 'sm chev')}<span class="mono small">Sec. ${esc(no)}</span><span class="small" style="font-weight:500">${esc(t)}</span></summary><div class="acc-body">${esc(sectionText(a, no, t))}</div></details>`).join('');
    };
    root.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => {
      root.querySelectorAll('[data-ch]').forEach(x => { x.classList.toggle('sel', x === b); x.setAttribute('aria-current', x === b); });
      drawSec(+b.dataset.ch);
    });
    drawSec(0);
    const more = root.querySelector('#act-more');
    more.onclick = () => { const open = more.getAttribute('aria-expanded') !== 'true'; root.querySelector('#act-sum').classList.toggle('pp-clamp', !open); more.setAttribute('aria-expanded', open); more.textContent = open ? 'Show less' : 'Show more'; };
    root.querySelector('#act-pdf').onclick = () => toast(`Opening the PDF of ${esc(a.title)}`, 'info');
    root.querySelectorAll('[data-paper]').forEach(b => b.onclick = () => toast(`Download started: ${esc(b.dataset.paper)}`));
    const ids = LINKED[a.id] = LINKED[a.id] || [];
    const drawCases = () => {
      root.querySelector('#lc-n').textContent = ids.length;
      root.querySelector('#lc-list').innerHTML = ids.length ? ids.map(id => { const c = caseById(id); return `<div class="list-item">${I('case', 'sm')}<div class="grow"><a class="link mono" href="#/cases/${c.id}">${esc(c.no)}</a><div class="faint xs">${esc(c.title)}, ${esc(c.courtName)}</div></div>${chip(c.status)}<button class="btn ghost sm" data-unlink="${c.id}" aria-label="Unlink ${esc(c.no)}">${I('x', 'sm')}Unlink</button></div>`; }).join('')
        : emptyState({ icon: 'link', title: 'No cases linked yet', text: 'Link this act to a case so it shows up in the case file and the drafting assistant.' });
    };
    root.querySelector('#lc-list').addEventListener('click', e => {
      const b = e.target.closest('[data-unlink]'); if (!b) return; const c = caseById(b.dataset.unlink);
      confirmDialog({ title: 'Unlink this case?', text: `${esc(c.no)} will no longer list ${esc(a.title)}. You can link it again later.`, confirm: 'Unlink', danger: true, onConfirm() { ids.splice(ids.indexOf(c.id), 1); drawCases(); toast(`Unlinked ${esc(c.no)}`); } });
    });
    drawCases();
    root.querySelector('#act-link').onclick = () => modal({
      title: 'Link to a case', sub: esc(a.title), size: 'narrow',
      body: `<form novalidate id="lk">${field({ id: 'lk-case', label: 'Case', options: caseOptions().filter(([id]) => !ids.includes(id)), placeholder: 'Select a case', required: true, err: 'Choose the case to link.' })}</form>`,
      foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="lk-save">Link act</button>`,
      onMount(el, close) {
        el.querySelector('#lk-save').onclick = (e) => {
          if (!validateForm(el.querySelector('#lk'))) return;
          busy(e.currentTarget, () => { const c = caseById(el.querySelector('#lk-case').value); ids.push(c.id); close(); drawCases(); toast(`${esc(a.title)} linked to ${esc(c.no)}`, 'ok', { action: { label: 'Open case', href: '#/cases/' + c.id } }); });
        };
      },
    });
  },
});

/* ==========================================================================
   3. LAW CODES: old code to new code (IPC/BNS, CrPC/BNSS, IEA/BSA)
   ========================================================================== */
const CODE_TABS = [['IPC', 'BNS', 'Indian Penal Code', 'Bharatiya Nyaya Sanhita'], ['CrPC', 'BNSS', 'Code of Criminal Procedure', 'Bharatiya Nagarik Suraksha Sanhita'], ['IEA', 'BSA', 'Indian Evidence Act', 'Bharatiya Sakshya Adhiniyam']];
page('/law-codes', {
  title: 'Law codes', perm: 'CASE_VIEW',
  render: () => `
    <div class="page-head"><div><h1>Law codes</h1><p>Find the new section for an old one, or trace a new section back. The new criminal codes apply to offences from 1 July 2024.</p></div></div>
    <div class="tabs" role="tablist" id="lc-tabs">${CODE_TABS.map(([f, t], i) => `<button role="tab" data-code="${f}" aria-selected="${i === 0}">${f} to ${t}</button>`).join('')}</div>
    <div class="toolbar">
      <div class="input-icon">${I('search', 'sm')}<input class="input" id="lc-q" type="search" aria-label="Search sections"></div>
      <div class="seg" data-seg id="lc-dir" role="group" aria-label="Search direction"><button data-v="old" aria-pressed="true">Search old code</button><button data-v="new" aria-pressed="false">Search new code</button></div>
    </div>
    <div class="faint small" id="lc-count" style="margin-bottom:10px" aria-live="polite"></div>
    <div class="split wide-rail" id="lc-body"></div>`,
  mount(root) {
    const st = { code: 'IPC', q: '', dir: 'old', sel: null };
    const q = root.querySelector('#lc-q');
    const draw = () => {
      const tab = CODE_TABS.find(t => t[0] === st.code);
      q.placeholder = st.dir === 'old' ? `${tab[0]} section or keyword, like 420` : `${tab[1]} section or keyword, like 318`;
      const all = D.lawCodes.filter(x => x.from === st.code);
      const s = st.q.trim().toLowerCase().replace(/^(sec\.?|section)\s*/, '');
      const rows = all.filter(x => !s || (st.dir === 'old' ? x.old : x.nw).toLowerCase().includes(s) || x.desc.toLowerCase().includes(s));
      if (!rows.find(x => x.id === st.sel)) st.sel = rows[0] ? rows[0].id : null;
      root.querySelector('#lc-count').textContent = `${rows.length} of ${all.length} sections in ${tab[0]} to ${tab[1]}`;
      const sel = rows.find(x => x.id === st.sel);
      root.querySelector('#lc-body').innerHTML = rows.length ? `
        <div class="panel" style="padding:6px 0" role="listbox" aria-label="Mappings">${rows.map(x => `<button class="list-item ${x.id === st.sel ? 'sel' : ''}" role="option" aria-selected="${x.id === st.sel}" data-id="${x.id}">
          <span class="mono" style="min-width:84px">${x.from} ${esc(x.old)}</span>${I('swap', 'sm faint')}<span class="mono" style="min-width:96px">${x.nw === '—' ? '<span class="faint">None</span>' : x.to + ' ' + esc(x.nw)}</span><span class="grow ellipsis faint xs hide-sm">${esc(x.desc)}</span>${chip(x.kind)}</button>`).join('')}</div>
        <div class="panel"><div class="panel-body" style="padding:22px">
          <div class="row" style="gap:8px;margin-bottom:12px">${chip(sel.kind)}</div>
          <div class="pp-two" style="gap:12px">
            <div class="panel tinted"><div class="panel-body" style="padding:14px 16px"><div class="faint xs">${esc(tab[2])}</div><div class="mono" style="font-size:var(--t-xl);margin-top:4px">${sel.from} ${esc(sel.old)}</div></div></div>
            <div class="panel tinted"><div class="panel-body" style="padding:14px 16px"><div class="faint xs">${esc(tab[3])}</div><div class="mono" style="font-size:var(--t-xl);margin-top:4px">${sel.nw === '—' ? '<span class="faint">No section</span>' : sel.to + ' ' + esc(sel.nw)}</div></div></div>
          </div>
          <p style="margin-top:16px;line-height:1.65">${esc(sel.desc)}</p>
          ${sel.kind === 'Repealed' ? `<div class="callout warn" style="margin-top:14px">${I('alert', 'sm')}<div>There is no corresponding provision in the ${esc(tab[1])}. For offences committed before 1 July 2024, the ${esc(tab[0])} continues to apply to pending proceedings.</div></div>` : ''}
          <div class="row wrap" style="margin-top:18px"><button class="btn sm" id="lc-copy">${I('copy', 'sm')}Copy citation</button></div>
        </div></div>`
        : `<div class="panel" style="grid-column:1/-1">${emptyState({ icon: 'swap', title: 'No section found', text: `Nothing in ${tab[0]} to ${tab[1]} matches "${esc(st.q)}". Check the section number, or switch between old and new code.`, action: '<button class="btn sm" id="lc-clear">Clear search</button>' })}</div>`;
      const c = root.querySelector('#lc-copy'); if (c) c.onclick = () => toast(`Copied: Sec. ${esc(sel.old)} ${sel.from} (now Sec. ${esc(sel.nw)} ${sel.to})`);
      const cl = root.querySelector('#lc-clear'); if (cl) cl.onclick = () => { q.value = ''; st.q = ''; draw(); q.focus(); };
    };
    root.querySelector('#lc-tabs').addEventListener('click', e => {
      const b = e.target.closest('[data-code]'); if (!b) return;
      root.querySelectorAll('[data-code]').forEach(x => x.setAttribute('aria-selected', x === b));
      st.code = b.dataset.code; st.sel = null; draw();
    });
    root.querySelector('#lc-body').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) { st.sel = +b.dataset.id; draw(); } });
    root.querySelector('#lc-dir').addEventListener('segchange', e => { st.dir = e.detail; draw(); });
    q.addEventListener('input', debounce(() => { st.q = q.value; draw(); }, 200));
    draw();
  },
});

/* ==========================================================================
   4. LEGAL DICTIONARY
   ========================================================================== */
page('/dictionary', {
  title: 'Legal dictionary', perm: 'CASE_VIEW',
  render: () => `
    <div class="page-head"><div><h1>Legal dictionary</h1><p>11,000+ legal terms with plain definitions, statutory references and Hindi equivalents.</p></div></div>
    <div class="input-icon pp-big-wrap" style="max-width:720px;margin-bottom:6px">${I('search')}<input class="input pp-big" id="dc-q" type="search" autofocus aria-label="Search legal terms" placeholder="Look up a term, like mesne profits"></div>
    <div class="faint small" id="dc-hint" style="margin-bottom:18px">Type at least 2 letters. Browse common terms below.</div>
    <div class="split wide-rail" id="dc-body" style="grid-template-columns:300px minmax(0,1fr)"></div>`,
  mount(root) {
    const st = { q: '', sel: D.dictionary[0].id, lang: 'en' };
    const q = root.querySelector('#dc-q');
    const draw = () => {
      const s = st.q.trim().toLowerCase();
      const short = s.length === 1;
      root.querySelector('#dc-hint').textContent = short ? 'Keep typing: search starts at 2 letters.' : s ? '' : 'Type at least 2 letters. Browse common terms below.';
      const rows = s.length >= 2 ? D.dictionary.filter(d => d.term.toLowerCase().includes(s) || d.def.toLowerCase().includes(s)) : D.dictionary;
      if (!rows.find(d => d.id === st.sel)) { st.sel = rows[0] ? rows[0].id : null; st.lang = 'en'; }
      const d = rows.find(x => x.id === st.sel);
      root.querySelector('#dc-body').innerHTML = rows.length ? `
        <div class="panel" style="padding:6px 0" role="listbox" aria-label="Terms">${rows.map(x => `<button class="list-item ${x.id === st.sel ? 'sel' : ''}" role="option" aria-selected="${x.id === st.sel}" data-id="${x.id}"><span class="grow">${esc(x.term)}</span>${x.hi ? `<span class="faint xs">${esc(x.hi)}</span>` : ''}</button>`).join('')}</div>
        <div class="panel"><div class="panel-body" style="padding:26px 28px">
          <div class="row between wrap" style="gap:12px"><h2 class="serif" style="font-size:var(--t-3xl);font-weight:500">${esc(st.lang === 'hi' && d.hi ? d.hi : d.term)}</h2>
          ${d.hi ? `<div class="seg" data-seg id="dc-lang" role="group" aria-label="Language"><button data-v="en" aria-pressed="${st.lang === 'en'}">English</button><button data-v="hi" lang="hi" aria-pressed="${st.lang === 'hi'}">हिंदी</button></div>` : ''}</div>
          ${st.lang === 'hi' && d.hi ? `<p class="faint small" style="margin-top:4px">Hindi equivalent of <b>${esc(d.term)}</b></p>` : ''}
          <p style="margin-top:14px;font-size:var(--t-lg);line-height:1.7;max-width:62ch">${esc(d.def)}</p>
          <div class="row wrap" style="margin-top:20px"><button class="btn sm" id="dc-copy">${I('copy', 'sm')}Copy definition</button></div>
        </div></div>`
        : `<div class="panel" style="grid-column:1/-1">${emptyState({ icon: 'dict', title: `No term matches "${esc(st.q)}"`, text: 'Check the spelling, or try the Latin form, like "res judicata" or "ex parte".' })}</div>`;
      wireSegs(root);
      const lg = root.querySelector('#dc-lang'); if (lg) lg.addEventListener('segchange', e => { st.lang = e.detail; draw(); });
      const cp = root.querySelector('#dc-copy'); if (cp) cp.onclick = () => { try { navigator.clipboard && navigator.clipboard.writeText(d.term + ': ' + d.def); } catch { /* clipboard blocked */ } toast(`Copied the definition of ${esc(d.term)}`); };
    };
    root.querySelector('#dc-body').addEventListener('click', e => { const b = e.target.closest('[data-id]'); if (b) { st.sel = +b.dataset.id; st.lang = 'en'; draw(); } });
    q.addEventListener('input', debounce(() => { st.q = q.value; draw(); }, 150));
    draw();
    setTimeout(() => q.focus(), 40);
  },
});

/* ==========================================================================
   5. DRAFTS list
   ========================================================================== */
const draftTitle = (d) => d.template && d.template !== '—' ? d.template : 'Draft from facts';
page('/drafting', {
  title: 'Drafts', perm: 'DRAFT_VIEW', skeleton: 'table',
  render: () => `
    <div class="page-head"><div><h1>Drafts</h1><p>Drafts generated from your case documents and templates. Every citation links back to its source.</p></div>
      <div class="actions"><a class="btn" href="#/drafting/templates">${I('template', 'sm')}Templates</a><a class="btn primary" href="#/drafting/new">${I('plus', 'sm')}New draft</a></div></div>
    <div id="dr-t"></div>`,
  mount(root) {
    let tbl;
    const cols = [
      { key: 'id', label: 'Draft #', sort: true, render: d => `<span class="mono">#${d.id}</span>` },
      { key: 'template', label: 'Template', sort: true, render: d => esc(d.template === '—' ? 'No template' : d.template) },
      { key: 'caseId', label: 'Case', render: d => { const c = caseById(d.caseId); return `<a class="link mono" href="#/cases/${c.id}">${esc(c.no)}</a>`; } },
      { key: 'docs', label: 'Reference docs', cls: 'num', hideSm: true },
      { key: 'created', label: 'Created', sort: true, hideSm: true, render: d => fdt(d.created) },
      { key: 'cited', label: 'Citations', hideSm: true, render: d => d.status !== 'Ready' || !d.cited[1] ? '<span class="faint">—</span>' : `<div class="row"><span class="small">${d.cited[0]} of ${d.cited[1]} verified</span><span class="bar-track cite-bar" aria-hidden="true"><i style="width:${d.cited[0] / d.cited[1] * 100}%;background:var(${d.cited[0] === d.cited[1] ? '--ok' : '--warn'})"></i></span></div>` },
      { key: 'status', label: 'Status', sort: true, render: d => d.status === 'Generating' ? `<span class="chip warn plain"><span class="pp-spin" aria-hidden="true"></span>Generating</span>` : chip(d.status) },
      { key: 'act', label: '<span class="sr-only">Actions</span>', cls: 'right', render: d => `<div class="row" style="justify-content:flex-end">${d.status === 'Ready' ? `<a class="btn sm" href="#/drafting/${d.id}">Open</a>` : ''}${d.status === 'Failed' ? `<button class="btn sm" data-redraft="${d.id}">${I('refresh', 'sm')}Re-draft</button>` : ''}<button class="btn ghost sm icon" data-del="${d.id}" aria-label="Delete draft ${d.id}">${I('trash', 'sm')}</button></div>` },
    ];
    tbl = DataTable(root.querySelector('#dr-t'), {
      columns: cols, rowsFn: () => D.drafts, initialSort: { key: 'id', dir: 'desc' },
      search: { placeholder: 'Search drafts by template or case', keys: ['template', d => caseById(d.caseId).no, d => '#' + d.id] },
      filters: [{ key: 'status', label: 'Status', options: ['Ready', 'Generating', 'Failed'] }],
      onRow: d => d.status === 'Ready' ? go('/drafting/' + d.id) : toast(d.status === 'Failed' ? `Draft #${d.id} failed. Use Re-draft to try again.` : `Draft #${d.id} is still generating`, 'info'),
      empty: { icon: 'pen', title: 'No drafts yet', text: 'Start from a case\'s documents or type the facts directly.', action: '<a class="btn primary sm" href="#/drafting/new">New draft</a>' },
    });
    const finish = (d, ms) => setTimeout(() => {
      d.status = 'Ready'; d.cited = [7, 8]; tbl.refresh();
      toast(`Draft #${d.id} is ready`, 'ok', { action: { label: 'Open', href: '#/drafting/' + d.id } });
    }, ms);
    D.drafts.filter(d => d.status === 'Generating').forEach(d => finish(d, 4000));
    root.querySelector('#dr-t').addEventListener('click', e => {
      const r = e.target.closest('[data-redraft]'); const x = e.target.closest('[data-del]');
      if (r) { const d = D.drafts.find(y => y.id === +r.dataset.redraft); d.status = 'Generating'; tbl.refresh(); toast(`Re-drafting #${d.id}`, 'info'); finish(d, 4000); }
      if (x) {
        const d = D.drafts.find(y => y.id === +x.dataset.del);
        confirmDialog({ title: `Delete draft #${d.id}?`, text: `${esc(draftTitle(d))} for ${esc(caseById(d.caseId).no)} will be deleted. Documents saved to the case are kept.`, confirm: 'Delete draft', danger: true, onConfirm() { D.drafts.splice(D.drafts.indexOf(d), 1); tbl.refresh(); toast(`Draft #${d.id} deleted`); } });
      }
    });
  },
});

/* ==========================================================================
   6. NEW DRAFT: chooser then stepped wizard
   ========================================================================== */
const TPL_FIELDS = {
  Plaint: [['Plaintiff', 0], ['Defendant', 1], ['Property address'], ['Monthly rent (₹)'], ['Arrears (₹)']],
  'Appeal memorandum': [['Appellant', 0], ['Respondent', 1], ['Lower court decree'], ['Date of decree']],
  Notice: [['Drawer of cheque', 1], ['Payee', 0], ['Cheque number'], ['Cheque amount (₹)']],
  Vakalatnama: [['Client', 0], ['Court'], ['Case number']],
  none: [['Party 1', 0], ['Party 2', 1], ['Subject matter']],
};
page('/drafting/new', {
  title: 'New draft', crumbs: [['Drafts', '/drafting']], perm: 'DRAFT_VIEW',
  render: () => `<div class="page-head"><div><h1>New draft</h1><p>PactPro drafts from your documents and cites the source for every fact it uses.</p></div></div><div id="wz"></div>`,
  mount(root) {
    const qs = query();
    const tplPre = D.templates.find(t => t.id === +qs.get('template') && t.status === 'Ready');
    const st = { mode: null, step: 0, caseId: +qs.get('caseId') || '', docs: new Set(), tpl: tplPre ? tplPre.id : '', facts: {}, prompt: '', bns: true, agreement: 'Lease deed', parties: [{ name: '', role: 'Lessor', address: '' }, { name: '', role: 'Lessee', address: '' }] };
    if (tplPre) st.mode = 'ref';
    const box = root.querySelector('#wz');
    const STEPS = { ref: ['Documents', 'Template', 'Facts and instructions', 'Review'], scratch: ['Setup', 'Key terms', 'Review'] };
    const tplObj = () => D.templates.find(t => t.id === +st.tpl);
    const fieldsFor = () => TPL_FIELDS[tplObj() ? tplObj().type : 'none'] || TPL_FIELDS.none;
    const caseSel = () => field({ id: 'w-case', label: 'Case', options: D.cases.map(c => [c.id, `${c.no}, ${c.title}`]), value: st.caseId, placeholder: 'Select a case', required: true, err: 'Choose the case this draft is for.' });

    const draw = () => {
      if (!st.mode) {
        box.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));max-width:860px">
          <button class="pp-opt" data-mode="ref">${I('folder', 'lg')}<h3>Start from reference documents</h3><span class="muted small">Pick the plaint, agreement or orders already in the case file. Facts are pulled from them and cited.</span></button>
          <button class="pp-opt" data-mode="scratch">${I('pen', 'lg')}<h3>Type the facts directly</h3><span class="muted small">Set up the parties and key terms yourself. Good for agreements and fresh matters with no papers yet.</span></button></div>`;
        return;
      }
      const steps = STEPS[st.mode]; const name = steps[st.step];
      let body = '';
      if (name === 'Documents') {
        const docs = st.caseId ? D.documents.filter(d => d.caseId === +st.caseId) : [];
        body = `<div class="form-grid">${caseSel()}</div>
          <div style="margin-top:18px"><div class="label" style="margin-bottom:8px">Reference documents</div>
          ${!st.caseId ? '<p class="faint small">Choose a case to see its documents.</p>' : docs.length ? `<div class="panel" style="padding:4px 0">${docs.map(d => `<label class="list-item check" style="cursor:pointer"><input type="checkbox" data-doc="${d.id}" ${st.docs.has(d.id) ? 'checked' : ''}>${I(docIcon(d.ext), 'sm')}<span class="grow">${esc(d.name)}</span><span class="faint xs hide-sm">${esc(d.cat)}, ${sizeFmt(d.kb)}</span></label>`).join('')}</div>` : emptyState({ icon: 'folder', title: 'This case has no documents', text: 'Upload documents to the case, or go back and type the facts directly.' })}
          <div class="callout bad" id="w-docerr" hidden style="margin-top:10px">${I('warn', 'sm')}<div>Pick at least one document to draft from.</div></div></div>`;
      } else if (name === 'Template') {
        body = `<div class="stack" role="radiogroup" aria-label="Template" style="gap:8px;max-width:720px">
          ${[{ id: '', name: 'No template', type: 'PactPro picks a structure from the documents', fields: '' }, ...D.templates.filter(t => t.status === 'Ready')].map(t => `<label class="panel row" style="padding:14px 16px;cursor:pointer;gap:12px"><input type="radio" name="w-tpl" value="${t.id}" ${String(st.tpl) === String(t.id) ? 'checked' : ''} style="accent-color:var(--ink)"><span class="grow"><b class="small">${esc(t.name)}</b><span class="faint xs" style="display:block">${esc(t.type)}${t.lang ? ', ' + esc(t.lang) : ''}</span></span>${t.fields ? `<span class="faint xs">${t.fields} fields</span>` : ''}</label>`).join('')}</div>`;
      } else if (name === 'Facts and instructions') {
        const c = caseById(st.caseId);
        body = `<form class="form-grid" novalidate id="w-form">
          ${fieldsFor().map(([l, pi], i) => field({ id: 'w-f' + i, label: l, value: st.facts[l] ?? (pi != null && c ? c.party[pi] : ''), required: i < 2, err: `Enter the ${l.toLowerCase()}.`, type: /₹/.test(l) ? 'number' : 'text' })).join('')}
          ${field({ id: 'w-prompt', label: 'Instructions for the draft', type: 'textarea', rows: 4, full: true, value: st.prompt, placeholder: 'For example: claim mesne profits from the date of the quit notice; keep the prayer short.' })}
          <label class="check full"><input type="checkbox" id="w-bns" ${st.bns ? 'checked' : ''}> Use BNS/BNSS section numbers</label></form>`;
      } else if (name === 'Setup') {
        body = `<form class="form-grid" novalidate id="w-form">${caseSel()}
          ${field({ id: 'w-agr', label: 'Agreement type', options: ['Lease deed', 'Sale agreement', 'Joint development agreement', 'Settlement deed', 'Power of attorney', 'Employment agreement'], value: st.agreement, required: true })}
          ${field({ id: 'w-tpl2', label: 'Template', options: D.templates.filter(t => t.status === 'Ready').map(t => [t.id, t.name]), value: st.tpl, placeholder: 'No template', full: true })}</form>`;
      } else if (name === 'Key terms') {
        body = `<form novalidate id="w-form"><div class="stack" id="w-parties">${st.parties.map((p, i) => `<div class="panel"><div class="panel-body" style="padding:14px 16px">
            <div class="row between" style="margin-bottom:10px"><b class="small">Party ${i + 1}</b><button type="button" class="btn ghost sm" data-rmp="${i}" ${st.parties.length <= 2 ? 'disabled' : ''} aria-label="Remove party ${i + 1}">${I('trash', 'sm')}Remove</button></div>
            <div class="form-grid">${field({ id: 'w-pn' + i, label: 'Name', value: p.name, required: true, err: 'Enter the party\'s name.' })}${field({ id: 'w-pr' + i, label: 'Role', options: ['Lessor', 'Lessee', 'Vendor', 'Purchaser', 'Developer', 'Land owner', 'Witness'], value: p.role })}${field({ id: 'w-pa' + i, label: 'Address', value: p.address, full: true })}</div></div></div>`).join('')}</div>
          <button type="button" class="btn ghost sm" id="w-addp" style="margin-top:10px">${I('plus', 'sm')}Add party</button></form>`;
      } else if (name === 'Review') {
        const c = caseById(st.caseId);
        const kv = st.mode === 'ref'
          ? [['Case', c ? `<span class="mono">${esc(c.no)}</span>` : '—'], ['Reference documents', [...st.docs].map(id => esc(D.documents.find(d => d.id === id).name)).join('<br>')], ['Template', esc(tplObj() ? tplObj().name : 'No template')], ...Object.entries(st.facts).filter(([, v]) => v).map(([k, v]) => [esc(k), esc(v)]), ['Instructions', esc(st.prompt || 'None')], ['Section numbers', st.bns ? 'BNS/BNSS' : 'IPC/CrPC']]
          : [['Case', c ? `<span class="mono">${esc(c.no)}</span>` : '—'], ['Agreement type', esc(st.agreement)], ['Template', esc(tplObj() ? tplObj().name : 'No template')], ...st.parties.map((p, i) => [`Party ${i + 1}`, `${esc(p.name)}, ${esc(p.role)}${p.address ? '<br><span class="faint xs">' + esc(p.address) + '</span>' : ''}`])];
        body = `<div class="panel tinted" style="max-width:720px"><div class="panel-body"><dl class="kv">${kv.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></div></div>
          <p class="faint small" style="margin-top:12px">Drafting takes about a minute for a plaint. You can leave this page; we will notify you.</p>`;
      }
      box.innerHTML = `<ol class="wz-steps">${steps.map((s, i) => `<li class="${i < st.step ? 'done' : ''}" ${i === st.step ? 'aria-current="step"' : ''}><span class="n">${i < st.step ? I('check', 'sm') : i + 1}</span>${s}</li>`).join('')}</ol>
        <div class="panel"><div class="panel-body" style="padding:24px"><h2 style="font-size:var(--t-xl);margin-bottom:16px">${name}</h2>${body}</div>
        <div class="row between" style="padding:14px 24px;border-top:1px solid var(--line)"><button class="btn ghost" id="w-back">${st.step === 0 ? 'Change starting point' : 'Back'}</button>
          <button class="btn primary" id="w-next">${name === 'Review' ? I('sparkle', 'sm') + 'Generate draft' : 'Continue'}</button></div></div>`;
      wireBody();
    };
    const collect = () => {
      const v = (id) => { const e = box.querySelector('#' + id); return e ? e.value.trim() : undefined; };
      if (box.querySelector('#w-case')) st.caseId = v('w-case');
      const r = box.querySelector('input[name="w-tpl"]:checked'); if (r) st.tpl = r.value;
      if (box.querySelector('#w-f0')) { fieldsFor().forEach(([l], i) => st.facts[l] = v('w-f' + i)); st.prompt = v('w-prompt'); st.bns = box.querySelector('#w-bns').checked; }
      if (box.querySelector('#w-agr')) { st.agreement = v('w-agr'); st.tpl = v('w-tpl2'); }
      st.parties.forEach((p, i) => { if (box.querySelector('#w-pn' + i)) { p.name = v('w-pn' + i); p.role = v('w-pr' + i); p.address = v('w-pa' + i); } });
    };
    const wireBody = () => {
      const cs = box.querySelector('#w-case');
      if (cs && STEPS[st.mode][st.step] === 'Documents') cs.onchange = () => { collect(); st.docs.clear(); st.facts = {}; draw(); };
      box.querySelectorAll('[data-doc]').forEach(c => c.onchange = () => { c.checked ? st.docs.add(+c.dataset.doc) : st.docs.delete(+c.dataset.doc); box.querySelector('#w-docerr').hidden = true; });
      box.querySelectorAll('input[name="w-tpl"]').forEach(r => r.onchange = () => { st.tpl = r.value; st.facts = {}; });
      const add = box.querySelector('#w-addp'); if (add) add.onclick = () => { collect(); st.parties.push({ name: '', role: 'Witness', address: '' }); draw(); box.querySelector('#w-pn' + (st.parties.length - 1)).focus(); };
      box.querySelectorAll('[data-rmp]').forEach(b => b.onclick = () => { collect(); st.parties.splice(+b.dataset.rmp, 1); draw(); });
      box.querySelector('#w-back').onclick = () => { collect(); if (st.step === 0) { st.mode = null; } else st.step--; draw(); };
      box.querySelector('#w-next').onclick = (e) => {
        const name = STEPS[st.mode][st.step];
        const form = box.querySelector('#w-form') || box.querySelector('.panel-body');
        if (!validateForm(form)) return;
        collect();
        if (name === 'Documents' && !st.docs.size) { box.querySelector('#w-docerr').hidden = false; return; }
        if (name !== 'Review') { st.step++; draw(); window.scrollTo(0, 0); return; }
        busy(e.currentTarget, () => {
          const t = tplObj(); const id = nextId(D.drafts);
          D.drafts.unshift({ id, template: t ? t.name : (st.mode === 'scratch' ? st.agreement : '—'), caseId: +st.caseId, docs: st.docs.size, created: new Date(), cited: st.mode === 'ref' ? [9, 10] : [0, 0], status: 'Ready' });
          go('/drafting/' + id); toast(`Draft #${id} generated. Fill the highlighted fields, then save it to the case.`, 'ok');
        }, 1200);
      };
    };
    box.addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) { st.mode = b.dataset.mode; st.step = 0; draw(); } });
    draw();
  },
});

/* ==========================================================================
   7. DRAFT EDITOR: placeholders, paper, Ask Lisa and Review
   ========================================================================== */
const PH = [['p_age', 'Plaintiff age'], ['survey', 'Survey number'], ['notice_date', 'Date of quit notice']];
const ph = (k) => `<span class="ph" data-k="${k}" contenteditable="false">${PH.find(p => p[0] === k)[1]}</span>`;
const cite = (n) => `<sup class="cite" data-cite="${n}" tabindex="0" role="button" aria-label="Source ${n}">[${n}]</sup>`;
function plaintHtml(c) {
  const court = c.court === 'ccc' ? `IN THE COURT OF THE ${esc(c.hall.replace(/^Court No\. /, '').toUpperCase())} ASSISTANT JUDGE, CITY CIVIL COURT AT CHENNAI` : `IN THE ${esc(c.courtName.toUpperCase())}`;
  const [pl, df] = c.party;
  return `<h2>${court}</h2>
  <p style="text-align:center"><b>${esc(c.no)}</b></p>
  <p style="text-align:center;margin:16px 0">${esc(pl)}<br><i>…Plaintiff</i><br>vs<br>${esc(df)}<br><i>…Defendant</i></p>
  <p style="text-align:center;margin-bottom:16px"><b>PLAINT FILED UNDER ORDER VII RULE 1 OF THE CODE OF CIVIL PROCEDURE, 1908</b></p>
  <p data-para="1">1. The plaintiff, ${esc(pl)}, aged about ${ph('p_age')} years, is residing at No. 7, Kamarajar Salai, Mylapore, Chennai 600004. The address for service of summons and notices on the plaintiff is that of his counsel, M/s. ${esc(D.firm.name)}, ${esc(D.firm.address)}.</p>
  <p data-para="2">2. The defendant, ${esc(df)}, is residing at the suit schedule property and may be served with summons and notices at that address.</p>
  <p data-para="3">3. The plaintiff is the absolute owner of the residential portion described in the schedule hereunder, bearing Survey No. ${ph('survey')}, Mylapore Village. The plaintiff let out the schedule property to the defendant under a rental agreement dated 01.04.2019 on a monthly rent of Rs. 15,000/-.${cite(1)}</p>
  <p data-para="4">4. The defendant was regular in paying rent till March 2024. Thereafter the defendant has committed default in payment of rent from April 2024 onwards and the arrears as on the date of the plaint comes to Rs. 3,15,000/-.${cite(2)}</p>
  <p data-para="5">5. The plaintiff caused a quit notice dated ${ph('notice_date')} to be issued to the defendant terminating the tenancy with effect from the expiry of the month of tenancy. The defendant received the notice but has neither vacated the premises nor sent any reply.${cite(3)}</p>
  <p data-para="6">6. <span class="risk" title="No reference document supports this figure">The plaintiff is also entitled to mesne profits at the rate of Rs. 25,000/- per month from the date of termination of the tenancy, being the prevailing market rent in the locality.</span></p>
  <p data-para="7">7. The cause of action for the suit arose at Chennai on 01.04.2019 when the tenancy was created, in April 2024 when the defendant committed default, and on the expiry of the notice period, all within the jurisdiction of this Hon'ble Court.${cite(4)}</p>
  <p data-para="8">8. The suit is valued under Sec. 30 of the Tamil Nadu Court-fees and Suits Valuation Act, 1955 at Rs. 1,80,000/- for the relief of possession and at Rs. 3,15,000/- for arrears of rent, and the court fee payable thereon is paid.</p>
  <p data-para="9">9. The plaintiff has not filed any other suit or proceeding in respect of the same cause of action either before this Hon'ble Court or before any other Court.</p>
  <p data-para="10"><b>PRAYER</b><br>The plaintiff therefore prays that this Hon'ble Court may be pleased to pass a judgment and decree (a) directing the defendant to quit and deliver vacant possession of the schedule property; (b) directing the defendant to pay arrears of rent of Rs. 3,15,000/-; (c) directing an enquiry into mesne profits under Order XX Rule 12 CPC; and (d) awarding costs of the suit.</p>
  <p data-para="11" style="margin-top:24px">Chennai<br>Date: ${fdate(TODAY, { day: '2-digit', month: '2-digit', year: 'numeric' })}</p>
  <p style="text-align:right">Counsel for the plaintiff &emsp;&emsp; Plaintiff</p>
  <p data-para="12" style="margin-top:20px"><b>VERIFICATION</b><br>I, ${esc(pl)}, the plaintiff above named, do hereby verify that the facts stated in paragraphs 1 to 9 above are true to my knowledge, belief and information, and I have not suppressed any material fact. Verified at Chennai on this day.</p>`;
}
const PROPOSALS = {
  'More formal': { pid: 4, old: 'The defendant was regular in paying rent till March 2024.', nw: 'The defendant was regular in the payment of rent until March 2024.', say: 'Here is a more formal version of the opening of paragraph 4.' },
  'More concise': { pid: 9, old: 'The plaintiff has not filed any other suit or proceeding in respect of the same cause of action either before this Hon\'ble Court or before any other Court.', nw: 'No other suit or proceeding on the same cause of action has been filed in any Court.', say: 'Paragraph 9 can be shorter without losing anything.' },
  'Fix grammar': { pid: 4, old: 'the arrears as on the date of the plaint comes to', nw: 'the arrears as on the date of the plaint amount to', say: 'One grammar fix in paragraph 4: "arrears" is plural.' },
  other: { pid: 7, old: 'when the tenancy was created', nw: 'when the tenancy commenced', say: 'I suggest one change in paragraph 7 to match the wording of the rental agreement.' },
};
const FINDINGS = [
  ['Issue', 'bad', 'Arrears of Rs. 3,15,000 do not match Rs. 15,000 a month for April 2024 onwards. Check the rent or the period.', 4],
  ['Check', 'warn', 'Mesne profits of Rs. 25,000 a month in paragraph 6 have no supporting document.', 6],
  ['Note', 'info', 'The quit notice date is still a placeholder.', 5],
];
const RISKS = [
  ['High', 'Mesne profits claimed at Rs. 25,000 a month with no valuation evidence.', 'Attach a rental valuation report, or claim at the contract rent and seek an enquiry.'],
  ['Medium', 'No interest is claimed on the arrears of rent.', 'Add a prayer for interest at 12% a year under Sec. 34 CPC.'],
  ['Low', 'The security deposit is not mentioned.', 'State the deposit amount and offer adjustment against arrears.'],
];

page('/drafting/:id', {
  title: (p) => 'Draft #' + p.id, crumbs: [['Drafts', '/drafting']], perm: 'DRAFT_VIEW',
  render(p) {
    const d = D.drafts.find(x => x.id === +p.id);
    if (!d) return emptyState({ icon: 'pen', title: 'This draft does not exist', text: 'It may have been deleted. Open another draft or start a new one.', action: '<a class="btn" href="#/drafting">Back to drafts</a> <a class="btn primary" href="#/drafting/new">New draft</a>' });
    if (d.status !== 'Ready') return emptyState({ icon: 'pen', title: d.status === 'Failed' ? `Draft #${d.id} failed` : `Draft #${d.id} is still generating`, text: d.status === 'Failed' ? 'Re-draft it from the drafts list.' : 'It will open here when ready.', action: '<a class="btn" href="#/drafting">Back to drafts</a>' });
    const c = caseById(d.caseId);
    const refs = D.documents.filter(x => x.caseId === c.id).slice(0, 4);
    return `
    <div class="ed-top">
      <a class="btn ghost sm" href="#/drafting">${I('chevronLeft', 'sm')}Drafts</a>
      <div class="grow" style="min-width:200px"><h1 class="serif">${esc(draftTitle(d))}</h1><div class="faint xs"><span class="mono">#${d.id}</span>, <a class="link mono" href="#/cases/${c.id}">${esc(c.no)}</a></div></div>
      <span id="ed-fill"></span>${chip('Saved v2', '')}
      <div class="seg" data-seg id="ed-mode" role="group" aria-label="Mode"><button data-v="edit" aria-pressed="true">${I('edit', 'sm')}Edit</button><button data-v="preview" aria-pressed="false">${I('eye', 'sm')}Preview</button></div>
      <button class="btn sm" data-pop id="ed-dl" aria-haspopup="menu">${I('download', 'sm')}Download</button>
      <button class="btn sm" id="ed-redraft">${I('refresh', 'sm')}Re-draft</button>
      <button class="btn primary sm" id="ed-save">${I('folder', 'sm')}Save to case</button>
    </div>
    <div class="editor-shell">
      <aside class="ed-pane ed-side" aria-label="Placeholders and references">
        <div class="ed-sec"><h3>Placeholders</h3><div class="stack" style="gap:10px">${PH.map(([k, l]) => `<div class="field"><label for="ph-${k}" class="row" style="gap:6px">${l}<span data-okk="${k}" hidden style="color:var(--ok)">${I('check', 'sm')}<span class="sr-only">filled</span></span></label><input class="input" id="ph-${k}" data-ph="${k}" placeholder="${k === 'notice_date' ? '10.01.2025' : k === 'p_age' ? '58' : '124/3B'}"></div>`).join('')}</div></div>
        <div class="ed-sec"><h3>Reference documents</h3>${refs.length ? refs.map((x, i) => `<div class="row" style="gap:6px;padding:6px 0"><span class="mono faint xs" style="width:22px">[${i + 1}]</span><button class="link small grow ellipsis" style="background:none;border:0;padding:0;text-align:left" data-ref="${x.id}">${esc(x.name)}</button><button class="btn ghost sm icon" data-pop data-refmenu="${x.id}" aria-label="More for ${esc(x.name)}">${I('more', 'sm')}</button></div>`).join('') : '<p class="faint small">No reference documents.</p>'}</div>
      </aside>
      <div class="ed-mid">
        <div class="ed-tools" role="toolbar" aria-label="Formatting">
          <button class="btn ghost sm icon" data-cmd="bold" aria-label="Bold"><b>B</b></button><button class="btn ghost sm icon" data-cmd="italic" aria-label="Italic"><i class="serif">I</i></button><button class="btn ghost sm icon" data-cmd="underline" aria-label="Underline"><u>U</u></button>
          <span class="sep"></span><button class="btn ghost sm icon" data-cmd="undo" aria-label="Undo">${I('restore', 'sm')}</button><button class="btn ghost sm icon" data-cmd="redo" aria-label="Redo">${I('refresh', 'sm')}</button>
          <span class="sep"></span><div class="input-icon" style="width:180px">${I('search', 'sm')}<input class="input" id="ed-find" type="search" placeholder="Find" aria-label="Find in document" style="height:28px"></div><span class="faint xs" id="ed-findn" aria-live="polite"></span>
        </div>
        <article class="paper-sheet" id="sheet" contenteditable="true" spellcheck="true" aria-label="Draft document">${plaintHtml(c)}</article>
      </div>
      <aside class="ed-pane ed-side" data-tab-scope aria-label="Assistant">
        <div class="tabs" data-tabs style="padding:0 12px;margin-bottom:0"><button data-tab="lisa">${I('chat', 'sm')}Ask Lisa</button><button data-tab="review">${I('shield', 'sm')}Review</button></div>
        <div class="tab-panel ed-sec" data-panel="lisa">
          <div class="pp-chat" id="chat" aria-live="polite"><div class="pp-msg ai">I drafted this plaint from ${refs.length} documents in ${esc(c.no)}. Ask me to change tone, tighten a paragraph or check a fact.</div></div>
          <div class="row wrap" style="margin:14px 0 10px;gap:6px">${['More formal', 'More concise', 'Fix grammar'].map(x => `<button class="pp-pill" data-preset="${x}">${x}</button>`).join('')}</div>
          <form id="chat-f" class="row" style="gap:6px"><label class="sr-only" for="chat-in">Message Lisa</label><input class="input grow" id="chat-in" placeholder="Ask Lisa to change the draft" autocomplete="off"><button class="btn primary icon" aria-label="Send">${I('send', 'sm')}</button></form>
        </div>
        <div class="tab-panel" data-panel="review" hidden>
          <div class="ed-sec"><h3>Consistency</h3><div class="stack" style="gap:10px">${FINDINGS.map(([s, t, txt, pid]) => `<div class="panel tinted"><div class="panel-body" style="padding:10px 12px">${chip(s, t)}<p class="small" style="margin:6px 0">${esc(txt)}</p><button class="link xs" style="background:none;border:0;padding:0" data-goto="${pid}">Go to clause</button></div></div>`).join('')}</div></div>
          <div class="ed-sec"><h3>Playbook risk</h3><div class="row" style="gap:6px"><label class="sr-only" for="pb-sel">Playbook</label><select class="input grow" id="pb-sel">${D.playbooks.filter(p => p.status === 'Ready').map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><button class="btn sm" id="pb-run">Run</button></div><div id="pb-out" style="margin-top:12px"></div></div>
        </div>
      </aside>
    </div>`;
  },
  mount(root, p) {
    const d = D.drafts.find(x => x.id === +p.id); if (!d || d.status !== 'Ready') return;
    const c = caseById(d.caseId);
    const sheet = root.querySelector('#sheet');
    const refs = D.documents.filter(x => x.caseId === c.id).slice(0, 4);
    const para = (n) => sheet.querySelector(`[data-para="${n}"]`);
    const flash = (el) => { if (!el) return; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1400); };

    /* placeholders: inputs drive every matching span live */
    const updFill = () => {
      const left = PH.filter(([k]) => !root.querySelector('#ph-' + k).value.trim()).length;
      root.querySelector('#ed-fill').innerHTML = left ? chip(`${left} to fill`, 'warn') : chip('All filled', 'ok');
    };
    root.querySelectorAll('[data-ph]').forEach(inp => inp.addEventListener('input', () => {
      const k = inp.dataset.ph; const v = inp.value.trim();
      sheet.querySelectorAll(`.ph[data-k="${k}"]`).forEach(s => { s.textContent = v || PH.find(x => x[0] === k)[1]; s.classList.toggle('filled', !!v); });
      root.querySelector(`[data-okk="${k}"]`).hidden = !v; updFill();
    }));
    updFill();

    /* references */
    root.querySelectorAll('[data-ref]').forEach(b => b.onclick = () => previewDoc(D.documents.find(x => x.id === +b.dataset.ref)));
    root.querySelectorAll('[data-refmenu]').forEach(b => b.onclick = () => { const doc = D.documents.find(x => x.id === +b.dataset.refmenu); popMenu(b, [{ label: 'Preview', icon: 'eye', onClick: () => previewDoc(doc) }, { label: 'Translate', icon: 'translate', onClick: () => go('/drafting/translate/' + doc.id) }]); });
    const openCite = (n) => { const doc = refs[n - 1]; if (doc) { toast(`Source [${n}]: ${esc(doc.name)}`, 'info'); previewDoc(doc); } else toast(`Source [${n}]: Sec. 20, Code of Civil Procedure, 1908`, 'info', { action: { label: 'Open act', href: '#/acts/1' } }); };
    sheet.addEventListener('click', e => { const s = e.target.closest('.cite'); if (s) openCite(+s.dataset.cite); });
    sheet.addEventListener('keydown', e => { const s = e.target.closest && e.target.closest('.cite'); if (s && e.key === 'Enter') { e.preventDefault(); openCite(+s.dataset.cite); } });

    /* toolbar: execCommand is deprecated but still the simplest way to drive a contenteditable demo */
    root.querySelectorAll('[data-cmd]').forEach(b => { b.addEventListener('mousedown', e => e.preventDefault()); b.onclick = () => { sheet.focus(); document.execCommand(b.dataset.cmd); }; });
    const clearMarks = () => { sheet.querySelectorAll('mark.find-hit').forEach(m => m.replaceWith(document.createTextNode(m.textContent))); sheet.normalize(); };
    const find = debounce(() => {
      clearMarks();
      const s = root.querySelector('#ed-find').value.trim(); const out = root.querySelector('#ed-findn');
      if (s.length < 2) { out.textContent = ''; return; }
      const re = new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const w = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT); const nodes = []; while (w.nextNode()) nodes.push(w.currentNode);
      let n = 0;
      nodes.forEach(t => {
        if (!re.test(t.data)) return; re.lastIndex = 0;
        const frag = document.createDocumentFragment(); let last = 0;
        t.data.replace(re, (m, i) => { frag.append(t.data.slice(last, i)); const mk = document.createElement('mark'); mk.className = 'find-hit'; mk.textContent = m; frag.append(mk); last = i + m.length; n++; return m; });
        frag.append(t.data.slice(last)); t.replaceWith(frag);
      });
      out.textContent = n ? `${n} found` : 'No matches';
      const first = sheet.querySelector('mark.find-hit'); first && first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 200);
    root.querySelector('#ed-find').addEventListener('input', find);

    /* top bar */
    root.querySelector('#ed-mode').addEventListener('segchange', e => {
      const prev = e.detail === 'preview';
      sheet.setAttribute('contenteditable', !prev); sheet.classList.toggle('preview', prev);
      root.querySelectorAll('[data-cmd]').forEach(b => b.disabled = prev);
    });
    root.querySelector('#ed-dl').onclick = (e) => popMenu(e.currentTarget, ['PDF', 'Word', 'Word on letterhead'].map(f => ({ label: f, icon: 'file', onClick: () => toast(`Downloading draft #${d.id} as ${f}`) })), { width: 210 });
    root.querySelector('#ed-redraft').onclick = () => confirmDialog({ title: 'Re-draft from the documents?', text: 'PactPro will write a fresh draft. Your edits stay in version 2 and you can go back to it.', confirm: 'Re-draft', onConfirm() { d.status = 'Generating'; go('/drafting'); toast(`Re-drafting #${d.id}`, 'info'); } });
    root.querySelector('#ed-save').onclick = (e) => {
      const left = PH.filter(([k]) => !root.querySelector('#ph-' + k).value.trim()).length;
      busy(e.currentTarget, () => {
        D.documents.unshift({ id: nextId(D.documents), name: `${draftTitle(d)} (draft ${d.id}).docx`, cat: 'Draft', caseId: c.id, client: c.client, ext: 'docx', kb: 96, version: 1, shared: false, date: new Date(), by: D.me.name, status: 'Active' });
        toast(`Saved to ${esc(c.no)}${left ? `. ${left} placeholder${left > 1 ? 's are' : ' is'} still empty.` : ''}`, left ? 'warn' : 'ok', { action: { label: 'Open case', href: '#/cases/' + c.id } });
      });
    };

    /* Ask Lisa */
    const chat = root.querySelector('#chat');
    const ask = (text, key) => {
      chat.insertAdjacentHTML('beforeend', `<div class="pp-msg me">${esc(text)}</div>`);
      const pend = document.createElement('div'); pend.className = 'pp-msg ai faint'; pend.innerHTML = '<span class="pp-spin" aria-hidden="true"></span> Lisa is reading the draft'; chat.append(pend);
      chat.lastElementChild.scrollIntoView({ block: 'nearest' });
      setTimeout(() => {
        const pr = PROPOSALS[key] || PROPOSALS.other; const pid = uid('pr');
        pend.className = 'pp-msg ai';
        pend.innerHTML = `<div>${esc(pr.say)}</div><div class="faint xs" style="margin:8px 0 4px">Paragraph ${pr.pid}</div><div style="line-height:1.6"><span class="pp-del">${esc(pr.old)}</span> <span class="pp-add">${esc(pr.nw)}</span></div>
          <div class="row" style="margin-top:10px" id="${pid}"><button class="btn primary sm" data-acc>${I('check', 'sm')}Accept</button><button class="btn ghost sm" data-rej>Reject</button></div>`;
        const bar = pend.querySelector('#' + pid);
        bar.querySelector('[data-acc]').onclick = () => {
          const el = para(pr.pid);
          if (!el || !el.innerHTML.includes(esc(pr.old).replace(/&#39;/g, '\''))) { toast('That paragraph has changed since Lisa read it. Ask again.', 'warn'); return; }
          el.innerHTML = el.innerHTML.replace(esc(pr.old).replace(/&#39;/g, '\''), esc(pr.nw).replace(/&#39;/g, '\''));
          bar.innerHTML = `<span class="chip ok">Accepted</span>`; flash(el); toast(`Paragraph ${pr.pid} updated`);
        };
        bar.querySelector('[data-rej]').onclick = () => { bar.innerHTML = '<span class="chip">Rejected</span>'; };
        pend.scrollIntoView({ block: 'nearest' });
      }, 900);
    };
    root.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => ask(b.dataset.preset, b.dataset.preset));
    root.querySelector('#chat-f').addEventListener('submit', e => { e.preventDefault(); const i = root.querySelector('#chat-in'); const v = i.value.trim(); if (!v) { i.focus(); return; } i.value = ''; ask(v, 'other'); });

    /* Review */
    root.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => flash(para(b.dataset.goto)));
    root.querySelector('#pb-run').onclick = (e) => busy(e.currentTarget, () => {
      const pb = D.playbooks.find(x => x.id === +root.querySelector('#pb-sel').value);
      const out = root.querySelector('#pb-out');
      out.innerHTML = `<div class="row between" style="margin-bottom:8px"><span class="small">Checked against <b>${esc(pb.name)}</b></span>${chip('Negotiate', 'warn')}</div>
        <div class="table-wrap"><table class="t"><thead><tr><th scope="col">Severity</th><th scope="col">Issue and suggestion</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${RISKS.map(([s, iss, sug], i) => `<tr data-risk="${i}"><td>${chip(s)}</td><td><div class="small">${esc(iss)}</div><div class="faint xs" style="margin-top:4px">${esc(sug)}</div></td><td><div class="stack" style="gap:4px"><button class="btn sm" data-racc>Accept</button><button class="btn ghost sm" data-rdis>Dismiss</button></div></td></tr>`).join('')}</tbody></table></div>`;
      out.querySelectorAll('[data-risk]').forEach(tr => {
        tr.querySelector('[data-racc]').onclick = () => { tr.lastElementChild.innerHTML = chip('Accepted', 'ok'); toast('Suggestion added to the review notes'); };
        tr.querySelector('[data-rdis]').onclick = () => { tr.remove(); toast('Dismissed', 'info'); };
      });
    }, 1100);
  },
});

/* ==========================================================================
   8. TEMPLATES
   ========================================================================== */
const samplePaper = (t) => `<div class="paper-sheet" style="margin:0 auto;width:100%;padding:36px 40px;font-size:13.5px">
  <h2>${esc(t.name.toUpperCase())}</h2>
  <p>This ${esc(t.type.toLowerCase())} is made between <span class="ph">Party 1</span>, residing at <span class="ph">Address</span>, and <span class="ph">Party 2</span>, in respect of <span class="ph">Subject matter</span>.</p>
  <p style="margin-top:10px">1. The parties agree to the terms set out below, which shall be read with the schedule annexed hereto.</p>
  <p style="margin-top:10px">2. Dated at Chennai on <span class="ph">Date</span>.</p></div>`;
page('/drafting/templates', {
  title: 'Templates', crumbs: [['Drafts', '/drafting']], perm: 'DRAFT_VIEW', skeleton: 'cards',
  render: () => `
    <div class="page-head"><div><h1>Templates</h1><p>Your firm's own formats. Upload a PDF or Word file and PactPro finds the fields to fill.</p></div>
      <div class="actions"><button class="btn primary" id="tp-up">${I('upload', 'sm')}Upload template</button></div></div>
    <div class="toolbar"><div class="input-icon">${I('search', 'sm')}<input class="input" id="tp-q" type="search" placeholder="Search templates" aria-label="Search templates"></div></div>
    <div class="doc-grid" id="tp-grid" style="grid-template-columns:repeat(auto-fill,minmax(250px,1fr))"></div>`,
  mount(root) {
    let q = '';
    const grid = root.querySelector('#tp-grid');
    const draw = () => {
      const rows = D.templates.filter(t => !q || (t.name + ' ' + t.type).toLowerCase().includes(q));
      grid.innerHTML = rows.length ? rows.map(t => `<div class="panel"><div class="panel-body" style="display:flex;flex-direction:column;gap:8px;height:100%">
          <div class="row between">${t.status === 'Processing' ? `<span class="chip warn plain"><span class="pp-spin" aria-hidden="true"></span>Processing</span>` : chip(t.status)}<span class="faint xs">${esc(t.lang)}</span></div>
          <h3 class="serif" style="font-size:var(--t-lg);font-weight:500">${esc(t.name)}</h3>
          <div class="faint xs">${esc(t.type)}${t.status === 'Ready' ? `, ${t.fields} fields` : ''}</div>
          ${t.status === 'Failed' ? `<div class="callout bad">${I('warn', 'sm')}<div>${esc(t.reason || 'The file is a scanned image with no text layer. Upload a Word file or a text PDF.')}</div></div>` : ''}
          <span class="grow"></span>
          <div class="row wrap" style="gap:6px">
            ${t.status === 'Ready' ? `<button class="btn primary sm" data-use="${t.id}">Use template</button><button class="btn sm" data-view="${t.id}">View</button>` : ''}
            ${t.status === 'Failed' ? `<button class="btn sm" data-retry="${t.id}">${I('refresh', 'sm')}Retry</button>` : ''}
            <span class="grow"></span><button class="btn ghost sm icon" data-del="${t.id}" aria-label="Delete ${esc(t.name)}">${I('trash', 'sm')}</button></div>
        </div></div>`).join('')
        : `<div style="grid-column:1/-1" class="panel">${emptyState({ icon: 'template', title: q ? 'No templates match' : 'No templates yet', text: q ? 'Try another word.' : 'Upload your first template.' })}</div>`;
    };
    const process = (t) => setTimeout(() => { t.status = 'Ready'; t.fields = t.fields || 12; if (currentPath() === '/drafting/templates') draw(); toast(`${esc(t.name)} is ready to use`, 'ok'); }, 3000);
    grid.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const t = D.templates.find(x => x.id === +(b.dataset.use || b.dataset.view || b.dataset.retry || b.dataset.del));
      if (b.dataset.use) go('/drafting/new?template=' + t.id);
      if (b.dataset.view) drawer({ title: esc(t.name), sub: `${esc(t.type)}, ${esc(t.lang)}, ${t.fields} fields`, wide: true, body: samplePaper(t), foot: `<button class="btn ghost" data-close>Close</button><button class="btn primary" onclick="go('/drafting/new?template=${t.id}')" data-close>Use template</button>` });
      if (b.dataset.retry) { t.status = 'Processing'; draw(); process(t); }
      if (b.dataset.del) confirmDialog({ title: 'Delete this template?', text: `${esc(t.name)} will be removed. Drafts already made from it are kept.`, confirm: 'Delete template', danger: true, onConfirm() { D.templates.splice(D.templates.indexOf(t), 1); draw(); toast('Template deleted'); } });
    });
    root.querySelector('#tp-q').addEventListener('input', debounce(e => { q = e.target.value.trim().toLowerCase(); draw(); }, 200));
    root.querySelector('#tp-up').onclick = () => modal({
      title: 'Upload template', sub: 'PDF or Word, up to 10 MB.',
      body: `<form class="form-grid" novalidate id="tu">
        ${field({ id: 'tu-name', label: 'Template name', required: true, full: true, placeholder: 'Rental agreement, residential', err: 'Name the template.' })}
        ${field({ id: 'tu-type', label: 'Agreement type', options: ['Agreement', 'Plaint', 'Notice', 'Affidavit', 'Vakalatnama', 'Appeal memorandum'], required: true })}
        ${field({ id: 'tu-lang', label: 'Language', options: ['English', 'Tamil'] })}
        <div class="field full"><label for="tu-file">File <span class="req" aria-hidden="true">*</span></label><input type="file" id="tu-file" class="input" accept=".pdf,.docx" required style="padding-top:6px"><span class="err" role="alert">${I('warn', 'sm')}Choose a PDF or Word (.docx) file.</span></div></form>`,
      foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="tu-save">Upload</button>`,
      onMount(el, close) {
        el.querySelector('#tu-save').onclick = (e) => {
          const f = el.querySelector('#tu-file'); const ok = validateForm(el.querySelector('#tu'));
          const badExt = f.value && !/\.(pdf|docx)$/i.test(f.value);
          if (badExt) { f.closest('.field').classList.add('invalid'); f.setAttribute('aria-invalid', true); }
          if (!ok || badExt) return;
          busy(e.currentTarget, () => {
            const t = { id: nextId(D.templates), name: el.querySelector('#tu-name').value.trim(), type: el.querySelector('#tu-type').value, lang: el.querySelector('#tu-lang').value, status: 'Processing', fields: 0 };
            D.templates.unshift(t); close(); draw(); toast(`Uploading ${esc(t.name)}. Finding fields`, 'info'); process(t);
          });
        };
      },
    });
    draw();
  },
});

/* ==========================================================================
   9. PLAYBOOKS: the firm's negotiating positions per clause
   ========================================================================== */
function openPlaybook(pb, redraw) {
  drawer({
    title: esc(pb.name), sub: `${esc(pb.category)}, built from ${pb.sources} documents`, wide: true,
    body: pb.clauses.length ? pb.clauses.map((c, i) => `<details class="pp-acc" ${i === 0 ? 'open' : ''} data-cl="${i}"><summary>${I('chevron', 'sm chev')}<b>${esc(c.type)}</b><span class="faint xs" style="margin-left:auto">${c.red.length} red line${c.red.length === 1 ? '' : 's'}</span></summary>
        <div class="stack" style="padding:0 0 18px 26px;gap:14px">
          ${field({ id: `pb-s${i}`, label: 'Standard position', type: 'textarea', rows: 2, value: c.standard })}
          <div><div class="label" style="margin-bottom:6px">Red lines</div><div class="stack" style="gap:6px" data-reds="${i}">${c.red.map((r, j) => `<div class="row"><span class="grow small" style="padding:6px 10px;border:1px solid var(--line);border-left:3px solid var(--tape);border-radius:var(--r-sm)">${esc(r)}</span><button type="button" class="btn ghost sm icon" data-rmred="${i}:${j}" aria-label="Remove red line">${I('x', 'sm')}</button></div>`).join('')}</div>
            <div class="row" style="margin-top:6px"><label class="sr-only" for="pb-nr${i}">New red line</label><input class="input grow" id="pb-nr${i}" placeholder="Add a red line"><button type="button" class="btn sm" data-addred="${i}">${I('plus', 'sm')}Add</button></div></div>
          ${field({ id: `pb-f${i}`, label: 'Fallback positions', type: 'textarea', rows: 2, value: c.fallback.join('\n'), hint: 'One per line, in order of preference.' })}
          ${field({ id: `pb-n${i}`, label: 'Notes', type: 'textarea', rows: 2, value: c.notes || '', placeholder: 'When to escalate, who approves' })}
        </div></details>`).join('')
      : emptyState({ icon: 'shield', title: 'Still reading the source documents', text: 'Clauses appear here when processing finishes.' }),
    foot: `<button class="btn ghost" data-close>Close</button>${pb.clauses.length ? '<button class="btn primary" id="pb-save">Save playbook</button>' : ''}`,
    onMount(el, close) {
      const reread = () => pb.clauses.forEach((c, i) => { c.standard = el.querySelector('#pb-s' + i).value.trim(); c.fallback = el.querySelector('#pb-f' + i).value.split('\n').map(s => s.trim()).filter(Boolean); c.notes = el.querySelector('#pb-n' + i).value.trim(); });
      const drawReds = (i) => { el.querySelector(`[data-reds="${i}"]`).innerHTML = pb.clauses[i].red.map((r, j) => `<div class="row"><span class="grow small" style="padding:6px 10px;border:1px solid var(--line);border-left:3px solid var(--tape);border-radius:var(--r-sm)">${esc(r)}</span><button type="button" class="btn ghost sm icon" data-rmred="${i}:${j}" aria-label="Remove red line">${I('x', 'sm')}</button></div>`).join(''); };
      el.addEventListener('click', e => {
        const rm = e.target.closest('[data-rmred]'); const ad = e.target.closest('[data-addred]');
        if (rm) { const [i, j] = rm.dataset.rmred.split(':').map(Number); pb.clauses[i].red.splice(j, 1); drawReds(i); }
        if (ad) { const i = +ad.dataset.addred; const inp = el.querySelector('#pb-nr' + i); const v = inp.value.trim(); if (!v) { inp.focus(); return; } pb.clauses[i].red.push(v); inp.value = ''; drawReds(i); inp.focus(); }
      });
      const sv = el.querySelector('#pb-save'); if (sv) sv.onclick = (e) => busy(e.currentTarget, () => { reread(); close(); redraw(); toast(`Saved ${esc(pb.name)}`); });
    },
  });
}
page('/drafting/playbooks', {
  title: 'Playbooks', crumbs: [['Drafts', '/drafting']], perm: 'DRAFT_VIEW', skeleton: 'cards',
  render: () => `
    <div class="page-head"><div><h1>Playbooks</h1><p>Your firm's standard positions, red lines and fallbacks. Drafts are checked against them in the editor.</p></div>
      <div class="actions"><button class="btn primary" id="pb-new">${I('plus', 'sm')}New playbook</button></div></div>
    <div class="doc-grid" id="pb-grid" style="grid-template-columns:repeat(auto-fill,minmax(270px,1fr))"></div>`,
  mount(root) {
    const grid = root.querySelector('#pb-grid');
    const draw = () => {
      grid.innerHTML = D.playbooks.length ? D.playbooks.map(pb => `<button class="panel pp-card" data-pb="${pb.id}" style="text-align:left;cursor:pointer;color:inherit;font:inherit"><div class="panel-body" style="display:flex;flex-direction:column;gap:8px">
          <div class="row between">${pb.status === 'Processing' ? `<span class="chip warn plain"><span class="pp-spin" aria-hidden="true"></span>Processing</span>` : chip(pb.status)}<span class="faint xs">${esc(pb.category)}</span></div>
          <h3>${esc(pb.name)}</h3>
          <div class="faint xs">${pb.status === 'Ready' ? `${pb.clauses.length} clauses, ${pb.clauses.reduce((s, c) => s + c.red.length, 0)} red lines` : `Reading ${pb.sources} source documents`}</div>
        </div></button>`).join('')
        : `<div class="panel" style="grid-column:1/-1">${emptyState({ icon: 'shield', title: 'No playbooks yet', text: 'Write one from scratch or let PactPro build it from signed agreements.' })}</div>`;
    };
    grid.addEventListener('click', e => { const b = e.target.closest('[data-pb]'); if (b) openPlaybook(D.playbooks.find(x => x.id === +b.dataset.pb), draw); });
    root.querySelector('#pb-new').onclick = () => modal({
      title: 'New playbook', sub: 'How do you want to start?',
      body: `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))" id="pbn-choose">
          <button class="pp-opt" data-how="scratch">${I('pen', 'lg')}<h3 style="font-size:var(--t-lg)">Write from scratch</h3><span class="muted small">Add clauses and positions yourself.</span></button>
          <button class="pp-opt" data-how="docs">${I('sparkle', 'lg')}<h3 style="font-size:var(--t-lg)">Generate from documents</h3><span class="muted small">Upload signed agreements; PactPro finds your usual positions.</span></button></div>
        <form class="form-grid" novalidate id="pbn-form" hidden>
          ${field({ id: 'pbn-name', label: 'Playbook name', required: true, full: true, placeholder: 'Commercial lease, tenant side', err: 'Name the playbook.' })}
          ${field({ id: 'pbn-cat', label: 'Category', options: ['Real estate', 'Construction', 'Labour', 'Commercial', 'Family'] })}
          <div class="field" id="pbn-files-f" hidden><label for="pbn-files">Source documents <span class="req" aria-hidden="true">*</span></label><input type="file" id="pbn-files" class="input" multiple accept=".pdf,.docx" style="padding-top:6px"><span class="err" role="alert">${I('warn', 'sm')}Add at least one agreement.</span></div></form>`,
      foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="pbn-save" hidden>Create playbook</button>`,
      onMount(el, close) {
        let how = '';
        el.querySelector('#pbn-choose').addEventListener('click', e => {
          const b = e.target.closest('[data-how]'); if (!b) return; how = b.dataset.how;
          el.querySelector('#pbn-choose').hidden = true; el.querySelector('#pbn-form').hidden = false; el.querySelector('#pbn-save').hidden = false;
          const ff = el.querySelector('#pbn-files-f'); ff.hidden = how !== 'docs'; el.querySelector('#pbn-files').required = how === 'docs';
          el.querySelector('#pbn-name').focus();
        });
        el.querySelector('#pbn-save').onclick = (e) => {
          if (!validateForm(el.querySelector('#pbn-form'))) return;
          busy(e.currentTarget, () => {
            const files = el.querySelector('#pbn-files').files.length;
            const pb = { id: nextId(D.playbooks), name: el.querySelector('#pbn-name').value.trim(), category: el.querySelector('#pbn-cat').value, status: how === 'docs' ? 'Processing' : 'Ready', sources: files, clauses: how === 'docs' ? [] : [{ type: 'New clause', standard: '', red: [], fallback: [] }] };
            D.playbooks.unshift(pb); close(); draw();
            if (how === 'docs') {
              toast(`Reading ${files} document${files === 1 ? '' : 's'} for ${esc(pb.name)}`, 'info');
              setTimeout(() => { pb.status = 'Ready'; pb.clauses = [{ type: 'Payment terms', standard: '30 days from invoice', red: ['Payment beyond 90 days'], fallback: ['45 days with 1.5% monthly interest on delay'] }, { type: 'Termination', standard: '3 months\' notice by either party', red: ['Termination without notice'], fallback: ['1 month\'s notice plus payment in lieu'] }]; if (currentPath() === '/drafting/playbooks') draw(); toast(`${esc(pb.name)} is ready`, 'ok'); }, 3000);
            } else { toast(`Created ${esc(pb.name)}`); openPlaybook(pb, draw); }
          });
        };
      },
    });
    draw();
  },
});

/* ==========================================================================
   10. TRANSLATE a document
   ========================================================================== */
const TRANSLATIONS = {
  Tamil: `<h2>சென்னை நகர உரிமையியல் நீதிமன்றத்தில்</h2>
    <p style="text-align:center">அசல் வழக்கு எண். 900/2025</p>
    <p style="text-align:center;margin:14px 0">கண்ணன்<br><i>…வாதி</i><br>எதிர்<br>சீதாராமன்<br><i>…பிரதிவாதி</i></p>
    <p>1. வாதி, கீழ்க்கண்ட அட்டவணையில் விவரிக்கப்பட்டுள்ள சொத்தின் முழு உரிமையாளர் ஆவார். அந்தச் சொத்து 01.04.2019 தேதியிட்ட வாடகை ஒப்பந்தத்தின் கீழ் மாதம் ரூ. 15,000/- வாடகைக்கு பிரதிவாதிக்கு விடப்பட்டது.</p>
    <p style="margin-top:10px">2. பிரதிவாதி ஏப்ரல் 2024 முதல் வாடகை செலுத்தத் தவறியுள்ளார். நிலுவைத் தொகை ரூ. 3,15,000/- ஆகும்.</p>`,
  Hindi: `<h2>चेन्नई नगर सिविल न्यायालय में</h2><p>1. वादी नीचे दी गई अनुसूची में वर्णित संपत्ति का पूर्ण स्वामी है, जिसे 01.04.2019 के किराया अनुबंध के अंतर्गत प्रतिवादी को किराये पर दिया गया था।</p>`,
  Malayalam: `<h2>ചെന്നൈ സിറ്റി സിവിൽ കോടതിയിൽ</h2><p>1. താഴെ പട്ടികയിൽ വിവരിച്ചിരിക്കുന്ന വസ്തുവിന്റെ പൂർണ്ണ ഉടമയാണ് വാദി.</p>`,
  Telugu: `<h2>చెన్నై నగర సివిల్ న్యాయస్థానంలో</h2><p>1. క్రింది షెడ్యూల్‌లో వివరించిన ఆస్తికి వాది సంపూర్ణ యజమాని.</p>`,
  Kannada: `<h2>ಚೆನ್ನೈ ನಗರ ಸಿವಿಲ್ ನ್ಯಾಯಾಲಯದಲ್ಲಿ</h2><p>1. ಕೆಳಗಿನ ಅನುಸೂಚಿಯಲ್ಲಿ ವಿವರಿಸಿದ ಆಸ್ತಿಯ ಸಂಪೂರ್ಣ ಮಾಲೀಕರು ವಾದಿ.</p>`,
};
const LANG_CODE = { Tamil: 'ta', Hindi: 'hi', Malayalam: 'ml', Telugu: 'te', Kannada: 'kn' };
page('/drafting/translate/:docId', {
  title: 'Translate', crumbs: [['Drafts', '/drafting']], perm: 'DRAFT_VIEW',
  render(p) {
    const d = D.documents.find(x => x.id === +p.docId);
    if (!d) return emptyState({ icon: 'translate', title: 'Document not found', text: 'Pick a document from a case or the documents list to translate it.', action: '<a class="btn" href="#/documents">Open documents</a>' });
    const c = caseById(d.caseId);
    return `<div class="page-head"><div><h1>Translate</h1><p><span class="mono">${esc(c.no)}</span>, ${esc(d.name)}</p></div>
      <div class="actions"><label class="sr-only" for="tr-lang">Target language</label><select class="input" id="tr-lang" style="width:auto">${Object.keys(TRANSLATIONS).map(l => `<option>${l}</option>`).join('')}</select><button class="btn primary" id="tr-go">${I('translate', 'sm')}Translate</button></div></div>
      <div class="pp-two">
        <section><div class="label" style="margin-bottom:8px">Original, English</div><div class="paper-sheet">
          <h2>IN THE ${esc(c.courtName.toUpperCase())}</h2><p style="text-align:center">${esc(c.no)}</p>
          <p style="text-align:center;margin:14px 0">${esc(c.party[0])}<br><i>…Plaintiff</i><br>vs<br>${esc(c.party[1])}<br><i>…Defendant</i></p>
          <p>1. ${esc(c.desc)}</p><p style="margin-top:10px">2. The facts set out in this document are true to the knowledge of the deponent, and the documents relied on are filed along with it.</p></div></section>
        <section><div class="row between" style="margin-bottom:8px"><span class="label" id="tr-lbl">Translation</span><button class="btn sm" id="tr-dl" disabled>${I('download', 'sm')}Download PDF</button></div><div id="tr-out" class="panel" style="min-height:320px">${emptyState({ icon: 'translate', title: 'No translation yet', text: 'Choose a language and select Translate. Legal terms keep their standard equivalents.' })}</div></section>
      </div>`;
  },
  mount(root, p) {
    const d = D.documents.find(x => x.id === +p.docId); if (!d) return;
    let done = '';
    root.querySelector('#tr-go').onclick = (e) => {
      const l = root.querySelector('#tr-lang').value;
      busy(e.currentTarget, () => {
        const out = root.querySelector('#tr-out');
        out.className = ''; out.innerHTML = `<div class="paper-sheet" lang="${LANG_CODE[l]}">${TRANSLATIONS[l]}<p style="margin-top:14px;color:#6b6b6b;font-size:12px">[Machine translation of page 1. Have it checked before filing.]</p></div>`;
        root.querySelector('#tr-lbl').textContent = 'Translation, ' + l; root.querySelector('#tr-dl').disabled = false; done = l;
        toast(`Translated into ${l}`);
      }, 1200);
    };
    root.querySelector('#tr-dl').onclick = () => toast(`Downloading ${esc(d.name.replace(/\.\w+$/, ''))} (${done}).pdf`);
  },
});

})();
