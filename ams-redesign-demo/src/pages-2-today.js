/* ==========================================================================
   PAGES 2: Today, Hearings & events, Daily causelist, Display board, Appeal alert.
   Each page renders into its own wrapper element and wires events on that
   wrapper (not on #content, which persists across routes and would stack
   listeners). Redraws go through router(), which repaints the current path
   without a skeleton; page state lives in module-level objects so it survives.
   ========================================================================== */

document.head.insertAdjacentHTML('beforeend', `<style>
  .pp-hero { margin-bottom: var(--s6); }
  .pp-hero h1 { font-size: var(--t-3xl); }
  .pp-hero .date { color: var(--ink-3); font-size: var(--t-sm); margin-bottom: 6px; }
  .pp-hero p.sum { color: var(--ink-2); margin-top: 8px; font-size: var(--t-md); max-width: 62ch; }
  .pp-sec { display: flex; align-items: baseline; justify-content: space-between; gap: var(--s3); margin: var(--s6) 0 var(--s3); }
  .pp-sec:first-child { margin-top: 0; }
  .pp-sec h2 { font-size: var(--t-xl); }
  .pp-sec .sub { color: var(--ink-3); font-size: var(--t-xs); }
  .pp-slip-acts { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
  .slip.done { opacity: .62; }
  .pp-figs .figure:nth-child(2n) { border-right: 0; }
  .pp-figs .figure:nth-child(-n+2) { border-bottom: 1px solid var(--line); }
  .pp-figs .figure .val { font-size: var(--t-2xl); }
  .pp-agenda-day { display: flex; gap: var(--s4); padding: 12px var(--s5); border-top: 1px solid var(--line); }
  .pp-agenda-day:first-child { border-top: 0; }
  .pp-agenda-day ul { list-style: none; margin: 0; padding: 0; flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
  .pp-agenda-day li { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; gap: 10px; align-items: baseline; font-size: var(--t-sm); }
  .pp-agenda-day .t { font-family: var(--f-mono); color: var(--ink-2); font-size: var(--t-xs); }
  .pp-att { display: flex; gap: var(--s3); align-items: flex-start; padding: 12px var(--s5); border-top: 1px solid var(--line); }
  .pp-att:first-child { border-top: 0; }
  .pp-att .ic { width: 30px; height: 30px; flex: none; border-radius: 50%; display: grid; place-items: center; background: var(--surface-3); color: var(--ink-2); }
  .pp-att .ic.hot { background: var(--tape-soft); color: var(--tape-ink); }
  .pp-att .acts { display: flex; gap: 4px; flex-wrap: wrap; justify-content: flex-end; }
  .pp-act { display: flex; gap: 10px; padding: 8px 0; border-top: 1px solid var(--line); font-size: var(--t-sm); }
  .pp-act:first-child { border-top: 0; }
  .pp-cal-tool { display: flex; flex-wrap: wrap; gap: var(--s2); align-items: center; margin-bottom: var(--s4); }
  .pp-cal-tool h2 { font-size: var(--t-2xl); margin: 0 var(--s3); min-width: 9ch; }
  .pp-cal-day { cursor: copy; }
  .pp-more { border: 0; background: none; padding: 0 6px; font-size: 11px; color: var(--ink-2); text-align: left; text-decoration: underline; cursor: pointer; }
  .pp-week-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--surface); }
  .pp-week-wrap .week { min-width: 680px; }
  .week .whd { border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 6px 8px; font-size: var(--t-xs); color: var(--ink-2); background: var(--surface-2); }
  .week .whd b { display: block; font: 500 var(--t-lg) var(--f-display); color: var(--ink); }
  .week .whd.today b { color: var(--tape); }
  .week .wev { text-align: left; color: var(--ink); }
  .pp-board-row.over td { color: var(--ink-3); }
  .pp-now-item { font: 500 var(--t-xl) var(--f-mono); }
  .pp-yours-hot { color: var(--tape-ink); font-weight: 600; }
  .pp-live { display: inline-flex; align-items: center; gap: 6px; font-size: var(--t-sm); color: var(--ink-2); }
  .pp-live i { width: 8px; height: 8px; border-radius: 50%; background: var(--tape); animation: ppPulse 1.6s ease-in-out infinite; }
  @keyframes ppPulse { 50% { opacity: .3; } }
  @media (prefers-reduced-motion: reduce) { .pp-live i { animation: none; } }
  .pp-acc { border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--surface); margin-bottom: var(--s3); overflow: hidden; }
  .pp-acc > summary { list-style: none; cursor: pointer; display: flex; align-items: center; gap: var(--s3); padding: 14px var(--s5); }
  .pp-acc > summary::-webkit-details-marker { display: none; }
  .pp-acc > summary .chev { transition: transform var(--d-fast); color: var(--ink-3); }
  .pp-acc[open] > summary .chev { transform: rotate(90deg); }
  .pp-acc > summary h3 { font: 500 var(--t-lg) var(--f-display); }
  .pp-acc .table-wrap { border: 0; border-top: 1px solid var(--line); border-radius: 0; }
  .pp-cl-item { font: 500 26px/1 var(--f-display); width: 48px; text-align: center; }
  .pp-score { display: flex; align-items: center; gap: 8px; }
  .pp-score .bar-track { width: 60px; height: 6px; }
  @media (max-width: 640px) {
    .pp-agenda-day li { grid-template-columns: 52px minmax(0, 1fr); }
    .pp-agenda-day li > :last-child { grid-column: 2; }
    .pp-att { flex-wrap: wrap; }
    .pp-att .acts { width: 100%; justify-content: flex-start; padding-left: 42px; }
    .pp-cal-tool h2 { width: 100%; margin: 4px 0; order: -1; }
  }
</style>`);

/* ---------- shared helpers for this file ---------- */
const P2 = {
  TYPE_CLS: { Hearing: 'hearing', 'Client Meeting': 'meeting', 'Payment Due': 'payment', 'Document Filing': 'filing' },
  TYPE_TONE: { Hearing: '', 'Client Meeting': 'info', 'Payment Due': 'warn', 'Document Filing': 'ok' },
  TYPES: ['Hearing', 'Client Meeting', 'Payment Due', 'Document Filing'],
  sameDay: (a, b) => a && b && new Date(a).toDateString() === new Date(b).toDateString(),
  ymd: (d) => { d = new Date(d); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
  parseYmd: (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); },
  noon: (d) => { const x = new Date(d); x.setHours(12, 0, 0, 0); return x; },
  stamp: (d) => `<div class="stamp ${daysFrom(d) === 0 ? 'today' : ''}" aria-hidden="true"><span>${fdate(d, { weekday: 'short' })}</span><b>${new Date(d).getDate()}</b></div>`,
  longDate: (d) => fdate(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
  // Listed until the scheduled time, in progress for the next hour, then done.
  hearingState: (at) => { const now = Date.now(); const t = +new Date(at); return now < t ? 'Listed' : now < t + 36e5 ? 'In progress' : 'Done'; },
};
P2.STATE_TONE = { Listed: '', 'In progress': 'tape', Done: 'ok' };

/* Outcome modal shared by Today and Causelist */
function p2MarkOutcome(c) {
  modal({
    title: 'Mark outcome', sub: `<span class="mono">${esc(c.no)}</span>`, size: 'narrow',
    body: `<form class="stack" novalidate id="oc-f">
      ${field({ id: 'oc-text', label: 'What happened today?', type: 'textarea', required: true, placeholder: 'PW1 cross-examined in part; adjourned at request of respondent', err: 'Write a line about the outcome.' })}
      ${field({ id: 'oc-next', label: 'Next hearing date', type: 'date', value: P2.ymd(day(14)), attrs: `min="${P2.ymd(day(1))}"`, hint: 'Leave empty if the matter is reserved or disposed.' })}
      <label class="check"><input type="checkbox" id="oc-alert" checked> Send the client an update</label>
    </form>`,
    foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="oc-save">Save outcome</button>`,
    onMount(el, close) {
      el.querySelector('#oc-save').onclick = (e) => {
        if (!validateForm(el.querySelector('#oc-f'))) return;
        busy(e.currentTarget, () => {
          const nv = el.querySelector('#oc-next').value;
          c.outcomeToday = el.querySelector('#oc-text').value.trim();
          // Keep today's slip on the Today page (marked Done) after the date moves on.
          if (c.next && daysFrom(c.next) === 0) c.heardAt = c.next;
          if (nv) {
            const at = P2.parseYmd(nv); at.setHours(c.h || 10, c.m || 30);
            c.next = at; c.nh = daysFrom(at);
            D.events.push({ id: Math.max(...D.events.map(x => x.id)) + 1, type: 'Hearing', title: c.no, caseId: c.id, at, purpose: c.stage, court: c.courtName, hall: c.hall, judge: c.judge });
          } else { c.next = null; c.nh = null; }
          const cl = clientById(c.client);
          close(); router();
          toast(`Outcome saved for <span class="mono">${esc(c.no)}</span>${nv ? `. Next hearing ${fdate(c.next)}` : ''}${el.querySelector('#oc-alert').checked && cl ? `. ${esc(cl.name)} will get an update` : ''}.`, 'ok');
        });
      };
    },
  });
}
function p2ClientAlert(c) {
  const cl = clientById(c.client);
  if (!cl) return toast('This case has no client to alert.', 'warn');
  toast(`Hearing alert sent to ${esc(cl.name)} by email and SMS.`, 'ok');
}

/* ==========================================================================
   1. TODAY: the practice's morning slip. Hearings first, then the week,
      then what needs a decision; figures and charts sit in the rail.
   ========================================================================== */
page('/', {
  title: 'Today', skeleton: 'dashboard',
  render() {
    const hr = new Date().getHours();
    const greet = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    const at = (c) => (c.heardAt && daysFrom(c.heardAt) === 0) ? c.heardAt : c.next;
    const today = D.cases.filter(c => at(c) && daysFrom(at(c)) === 0).sort((a, b) => at(a) - at(b));
    const stOf = (c) => c.heardAt && daysFrom(c.heardAt) === 0 ? 'Done' : P2.hearingState(c.next);
    const courts = new Set(today.map(c => c.courtName)).size;
    const review = D.tasks.filter(t => t.status === 'To review');
    const overdue = D.invoices.filter(i => i.status === 'Overdue');
    const newAppeals = D.appeals.filter(a => a.status === 'New');
    const nowIdx = today.findIndex(c => stOf(c) !== 'Done');

    const summary = (today.length
      ? `${today.length} matter${today.length > 1 ? 's' : ''} listed today across ${courts} court${courts > 1 ? 's' : ''}.`
      : 'Nothing of yours is listed today.') + ' ' +
      (review.length ? `${review.length} task${review.length > 1 ? 's' : ''} await${review.length > 1 ? '' : 's'} your review.` : 'No tasks are waiting for review.');

    const slips = today.length ? today.map((c, i) => {
      const st = stOf(c);
      return `<article class="slip ${i === nowIdx ? 'now' : ''} ${st === 'Done' ? 'done' : ''}" aria-label="Item ${c.item}, ${esc(c.no)}">
        <div class="item"><b>${c.item}</b><span>Item</span></div>
        <div class="what">
          <a class="no" href="#/cases/${c.id}">${esc(c.no)}</a>
          <div class="ttl">${esc(c.title)}</div>
          <div class="where meta-line" style="font-size:var(--t-xs);color:var(--ink-3);gap:2px 14px"><span>${esc(c.courtName)}</span><span>${esc(c.hall)}</span><span>${esc(c.judge)}</span></div>
          <div class="pp-slip-acts">
            <a class="btn sm" href="#/cases/${c.id}">${I('case', 'sm')}Open case</a>
            <button class="btn sm ghost" data-act="alert" data-id="${c.id}">${I('send', 'sm')}Send client alert</button>
            <button class="btn sm ghost" data-act="outcome" data-id="${c.id}">${I('edit', 'sm')}Mark outcome</button>
          </div>
        </div>
        <div class="when"><b>${ftime(at(c))}</b>${chip(st, P2.STATE_TONE[st])}${i === nowIdx ? '<div class="xs" style="color:var(--tape-ink);margin-top:4px">Up next</div>' : ''}</div>
      </article>`;
    }).join('') : emptyState({ icon: 'gavel', title: 'No hearings today', text: 'Use the time for drafting. Your next listing is on the calendar.', action: '<a class="btn sm" href="#/hearings">Open calendar</a>' });

    // This week: days 1..6
    const week = [];
    for (let o = 1; o <= 6; o++) {
      const evs = D.events.filter(e => daysFrom(e.at) === o).sort((a, b) => a.at - b.at);
      if (evs.length) week.push([day(o), evs]);
    }
    const weekHtml = week.length ? week.map(([d, evs]) => `<div class="pp-agenda-day">${P2.stamp(d)}<ul>${evs.map(e => {
      const c = caseById(e.caseId);
      return `<li><span class="t">${ftime(e.at)}</span><span class="ellipsis"><a class="${e.type === 'Hearing' ? 'mono' : ''}" href="#/cases/${e.caseId}">${esc(e.title)}</a>${e.type === 'Hearing' && c ? ` <span class="faint">${esc(c.party[0])}</span>` : ''}</span>${chip(e.type, P2.TYPE_TONE[e.type])}</li>`;
    }).join('')}</ul></div>`).join('') : `<div class="panel-body muted small">Nothing else is scheduled this week.</div>`;

    const att = [
      ...review.map(t => {
        const who = advById(t.assignee); const c = caseById(t.caseId);
        return `<div class="pp-att"><span class="ic hot">${I('tasks', 'sm')}</span><div class="grow"><div class="small"><b>${esc(t.title)}</b></div><div class="meta-line xs" style="font-size:var(--t-xs);color:var(--ink-3);margin-top:2px"><span>From ${esc(who ? who.name : 'team')}</span>${c ? `<span class="mono">${esc(c.no)}</span>` : ''}${t.hours ? `<span>${t.hours} h logged</span>` : ''}</div></div>
          <div class="acts"><button class="btn sm primary" data-act="approve" data-id="${t.id}">${I('check', 'sm')}Approve</button><button class="btn sm" data-act="changes" data-id="${t.id}">Request changes</button></div></div>`;
      }),
      ...overdue.map(i => {
        const cl = clientById(i.client);
        return `<div class="pp-att"><span class="ic">${I('receipt', 'sm')}</span><div class="grow"><div class="small"><b>${esc(cl.name)}</b> owes <span class="mono">${inr(i.total)}</span></div><div class="meta-line" style="font-size:var(--t-xs);color:var(--ink-3);margin-top:2px"><span class="mono">${esc(i.no)}</span><span style="color:var(--bad)">${-daysFrom(i.due)} days overdue</span></div></div>
          <div class="acts"><button class="btn sm" data-act="remind" data-id="${i.id}">${I('mail', 'sm')}Send reminder</button></div></div>`;
      }),
      ...newAppeals.map(a => {
        const c = caseById(a.source);
        return `<div class="pp-att"><span class="ic hot">${I('alert', 'sm')}</span><div class="grow"><div class="small"><b>Possible appeal</b> against <span class="mono">${esc(c.no)}</span></div><div class="meta-line" style="font-size:var(--t-xs);color:var(--ink-3);margin-top:2px"><span class="mono">${esc(a.appealNo)}</span><span>${esc(a.forum)}</span></div></div>
          <div class="acts"><a class="btn sm" href="#/appeals">Review</a></div></div>`;
      }),
    ].join('') || `<div class="panel-body">${emptyState({ icon: 'ok', title: 'Nothing needs you right now', text: 'Reviews, overdue invoices and appeal alerts will show up here.' })}</div>`;

    // Rail figures
    const active = D.cases.filter(c => c.status !== 'Closed').length;
    const next30 = D.events.filter(e => e.type === 'Hearing' && daysFrom(e.at) >= 0 && daysFrom(e.at) <= 30).length;
    const outstanding = D.invoices.filter(i => ['Unpaid', 'Overdue'].includes(i.status)).reduce((s, i) => s + i.total, 0);
    const mStart = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
    // Rolling 30 days so the figure isn't empty on the first of the month.
    const collected = D.payments.filter(p => daysFrom(p.date) >= -30).reduce((s, p) => s + p.amount, 0);

    const st = ['Active', 'Pending', 'Closed'].map((s, i) => ({ label: s, value: D.cases.filter(c => c.status === s).length, color: ['var(--ink)', 'var(--warn)', 'var(--mute)'][i] }));
    const load = {};
    D.cases.filter(c => c.status !== 'Closed').forEach(c => { load[c.courtName] = (load[c.courtName] || 0) + 1; });
    const loadRows = Object.entries(load).sort((a, b) => b[1] - a[1]);
    const maxLoad = Math.max(...loadRows.map(r => r[1]), 1);

    // Billing: last 6 months, real data for recent months layered on a fixed history.
    const months = Array.from({ length: 6 }, (_, i) => new Date(TODAY.getFullYear(), TODAY.getMonth() - 5 + i, 1));
    const hist = { billed: [420000, 515000, 380000, 610000, 470000, 0], coll: [390000, 440000, 410000, 520000, 455000, 0] };
    const inMonth = (d, m) => d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth();
    const billed = months.map((m, i) => hist.billed[i] * (i < 4 ? 1 : .4) + D.invoices.filter(x => inMonth(x.date, m)).reduce((s, x) => s + x.total, 0));
    const coll = months.map((m, i) => hist.coll[i] * (i < 4 ? 1 : .4) + D.payments.filter(p => inMonth(p.date, m)).reduce((s, p) => s + p.amount, 0));

    return `<div id="pg-today">
      <header class="pp-hero">
        <div class="date">${P2.longDate(TODAY)}</div>
        <h1>${greet}, ${esc(D.me.name.split(' ')[0])}</h1>
        <p class="sum">${summary}</p>
      </header>
      <div class="split">
        <div>
          <div class="pp-sec"><h2>In court today</h2><a class="link small" href="#/causelist">Full causelist</a></div>
          <div class="panel"><div class="slips">${slips}</div></div>

          <div class="pp-sec"><h2>This week</h2><a class="link small" href="#/hearings">Calendar</a></div>
          <div class="panel">${weekHtml}</div>

          <div class="pp-sec"><h2>Needs your attention</h2><span class="sub">${review.length + overdue.length + newAppeals.length} items</span></div>
          <div class="panel">${att}</div>
        </div>
        <aside class="stack rail" style="gap:var(--s4)" aria-label="Practice summary">
          <div class="figures pp-figs">
            <a class="figure" href="#/cases"><div class="lbl">Active matters</div><div class="val">${active}</div></a>
            <a class="figure" href="#/hearings"><div class="lbl">Hearings, next 30 days</div><div class="val">${next30}</div></a>
            <a class="figure" href="#/invoices"><div class="lbl">Fees outstanding</div><div class="val">${inrShort(outstanding)}</div></a>
            <a class="figure" href="#/payments"><div class="lbl">Collected, last 30 days</div><div class="val">${inrShort(collected)}</div></a>
          </div>
          <section class="panel"><div class="panel-head"><h3>Cases by status</h3></div><div class="panel-body row" style="gap:var(--s4);align-items:center">
            ${donut({ parts: st, size: 120, label: String(D.cases.length), sub: 'cases' })}
            <div class="stack" style="gap:6px">${st.map(s => `<div class="legend"><span><i style="background:${s.color}"></i>${s.label} <b class="num" style="color:var(--ink)">${s.value}</b></span></div>`).join('')}</div>
          </div></section>
          <section class="panel"><div class="panel-head"><h3>Court load</h3><span class="sub">Open matters</span></div><div class="panel-body">
            ${loadRows.map(([n, v]) => `<div class="bar-row" style="grid-template-columns:minmax(0,1.3fr) 1fr 24px"><span class="ellipsis" title="${esc(n)}">${esc(n)}</span><div class="bar-track"><i style="width:${v / maxLoad * 100}%;background:var(--ink)"></i></div><span class="num right">${v}</span></div>`).join('')}
          </div></section>
          <section class="panel"><div class="panel-head"><h3>Billing snapshot</h3><span class="sub">Last 6 months</span></div><div class="panel-body">
            ${barChart({ labels: months.map(m => fdate(m, { month: 'short' })), series: [{ name: 'Billed', data: billed, color: 'var(--line-strong)' }, { name: 'Collected', data: coll, color: 'var(--ink)' }], height: 200, money: true })}
            ${legend([{ label: 'Billed', color: 'var(--line-strong)' }, { label: 'Collected', color: 'var(--ink)' }])}
          </div></section>
          <section class="panel"><div class="panel-head"><h3>Recent activity</h3>${can('AUDIT_VIEW') ? '<a class="link xs" href="#/activity">All</a>' : ''}</div><div class="panel-body">
            ${D.activity.slice(0, 8).map(a => `<div class="pp-act">${avatar(a.user === 'unknown' ? '?' : a.user, 'sm')}<div class="grow"><div>${esc(a.title)}</div><div class="faint xs">${esc(a.user)}, ${ago(a.at)}</div></div></div>`).join('')}
          </div></section>
          <section class="panel"><div class="panel-head"><h3>Quick actions</h3></div><div class="panel-body flush"><div class="list">
            ${[['event', 'calendar', 'Add hearing or event'], ['task', 'tasks', 'Assign a task'], ['invoice', 'receipt', 'Generate invoice'], ['payment', 'rupee', 'Record payment'], ['upload', 'upload', 'Upload documents'], ['client', 'users', 'Add client']]
              .map(([f, ic, l]) => `<button class="list-item" data-form="${f}">${I(ic, 'sm')}<span class="small">${l}</span></button>`).join('')}
          </div></div></section>
        </aside>
      </div>
    </div>`;
  },
  mount(root) {
    const pg = root.querySelector('#pg-today');
    pg.addEventListener('click', (e) => {
      const f = e.target.closest('[data-form]');
      if (f) { const k = f.dataset.form; return k === 'client' ? FORMS.client(null, router) : FORMS[k]({ onSave: router }); }
      const b = e.target.closest('[data-act]'); if (!b) return;
      const id = +b.dataset.id;
      if (b.dataset.act === 'alert') p2ClientAlert(caseById(id));
      if (b.dataset.act === 'outcome') p2MarkOutcome(caseById(id));
      if (b.dataset.act === 'approve' || b.dataset.act === 'changes') {
        const t = D.tasks.find(x => x.id === id);
        if (b.dataset.act === 'approve') { t.status = 'Completed'; t.review = 'Approved'; }
        else { t.status = 'In Progress'; t.review = 'Changes requested'; }
        refreshNav(); router();
        toast(b.dataset.act === 'approve' ? `Approved: ${esc(t.title)}` : `Changes requested. ${esc(advById(t.assignee).name)} has been notified.`, b.dataset.act === 'approve' ? 'ok' : 'info');
      }
      if (b.dataset.act === 'remind') {
        const i = D.invoices.find(x => x.id === id);
        busy(b, () => toast(`Reminder for <span class="mono">${esc(i.no)}</span> sent to ${esc(clientById(i.client).name)}`, 'ok'));
      }
    });
  },
});

/* ==========================================================================
   2. HEARINGS & EVENTS: month, week and agenda views over D.events.
   ========================================================================== */
const P2Cal = {
  cursor: new Date(TODAY.getFullYear(), TODAY.getMonth(), 1),
  weekStart: (() => { const d = new Date(TODAY); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; })(),
  view: 'month',
  types: new Set(P2.TYPES),
};
function p2Events() { return D.events.filter(e => P2Cal.types.has(e.type)).sort((a, b) => a.at - b.at); }
function p2EventDrawer(ev) {
  const c = caseById(ev.caseId);
  drawer({
    title: esc(ev.title), sub: `${esc(ev.type)}, ${P2.longDate(ev.at)}, ${ftime(ev.at)}`,
    body: `<div class="row wrap" style="margin-bottom:var(--s4)">${chip(ev.type, P2.TYPE_TONE[ev.type])}${daysFrom(ev.at) < 0 ? chip('Past', '') : daysFrom(ev.at) === 0 ? chip('Today', 'tape') : ''}</div>
      <dl class="kv">
        <dt>Case</dt><dd>${c ? `<a class="link mono" href="#/cases/${c.id}">${esc(c.no)}</a><div class="faint xs">${esc(c.title)}</div>` : '—'}</dd>
        <dt>Court</dt><dd>${esc(ev.court || '—')}</dd>
        <dt>Hall</dt><dd>${esc(ev.hall || '—')}</dd>
        <dt>Judge</dt><dd>${esc(ev.judge || '—')}</dd>
        <dt>Purpose</dt><dd>${esc(ev.purpose || '—')}</dd>
        <dt>Notes</dt><dd>${esc(ev.notes || (c ? c.desc : '') || '—')}</dd>
      </dl>`,
    foot: `<button class="btn danger" id="ev-del">${I('trash', 'sm')}Delete</button><span class="grow"></span><button class="btn" id="ev-rem">${I('send', 'sm')}Send client reminder</button><button class="btn primary" id="ev-res">${I('calendar', 'sm')}Reschedule</button>`,
    onMount(el, close) {
      el.querySelector('#ev-rem').onclick = () => { const cl = c && clientById(c.client); toast(cl ? `Reminder sent to ${esc(cl.name)}` : 'No client on this case', cl ? 'ok' : 'warn'); };
      el.querySelector('#ev-del').onclick = () => confirmDialog({
        title: 'Delete this event?', text: `${esc(ev.title)} on ${fdate(ev.at)} will be removed from the calendar. The case record is not changed.`, confirm: 'Delete event', danger: true,
        onConfirm: () => { D.events = D.events.filter(x => x !== ev); close(); router(); toast('Event deleted', 'ok'); },
      });
      el.querySelector('#ev-res').onclick = () => modal({
        title: 'Reschedule', sub: esc(ev.title), size: 'narrow', top: true,
        body: `<form class="form-grid" novalidate id="rs-f">${field({ id: 'rs-d', label: 'New date', type: 'date', required: true, value: P2.ymd(ev.at), err: 'Pick a date.' })}${field({ id: 'rs-t', label: 'Time', type: 'time', value: String(ev.at.getHours()).padStart(2, '0') + ':' + String(ev.at.getMinutes()).padStart(2, '0') })}</form>`,
        foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="rs-save">Move event</button>`,
        onMount(m, closeM) {
          m.querySelector('#rs-save').onclick = () => {
            if (!validateForm(m.querySelector('#rs-f'))) return;
            const at = P2.parseYmd(m.querySelector('#rs-d').value); const [hh, mm] = (m.querySelector('#rs-t').value || '10:30').split(':'); at.setHours(+hh, +mm);
            // If this event is the case's next hearing, move the case date too.
            if (ev.type === 'Hearing' && c && c.next && +c.next === +ev.at) { c.next = at; c.nh = daysFrom(at); }
            ev.at = at;
            closeM(); close(); router(); toast(`Moved to ${fdate(at)}, ${ftime(at)}`, 'ok');
          };
        },
      });
    },
  });
}
page('/hearings', {
  title: 'Hearings & events', perm: 'EVENT_VIEW', skeleton: 'table',
  render() {
    const v = P2Cal.view; const evs = p2Events();
    let title, body;
    if (v === 'week') {
      const ws = P2Cal.weekStart; const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(ws); d.setDate(d.getDate() + i); return d; });
      title = `${fdate(days[0], { day: 'numeric', month: 'short' })} to ${fdate(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}`;
      let g = '<div class="whd"></div>' + days.map(d => `<div class="whd ${daysFrom(d) === 0 ? 'today' : ''}">${fdate(d, { weekday: 'short' })}<b>${d.getDate()}</b></div>`).join('');
      for (let h = 9; h < 19; h++) {
        g += `<div class="tcell">${h}:00</div>` + days.map(d => {
          const here = evs.filter(e => P2.sameDay(e.at, d) && Math.min(Math.max(e.at.getHours(), 9), 18) === h);
          return `<div class="hcell">${here.map((e, k) => `<button class="wev ${P2.TYPE_CLS[e.type]}" data-ev="${e.id}" style="top:${3 + (e.at.getHours() >= 9 && e.at.getHours() < 19 ? e.at.getMinutes() / 60 * 48 : 0)}px;${here.length > 1 ? `left:${3 + k * 50 / here.length}%;right:auto;width:${96 / here.length}%` : ''}"><b class="mono">${ftime(e.at)}</b><br>${esc(e.title)}</button>`).join('')}</div>`;
        }).join('');
      }
      body = `<div class="pp-week-wrap"><div class="week" role="grid" aria-label="Week view">${g}</div></div>`;
    } else if (v === 'agenda') {
      const cur = P2Cal.cursor; title = fdate(cur, { month: 'long', year: 'numeric' });
      const inM = evs.filter(e => e.at.getMonth() === cur.getMonth() && e.at.getFullYear() === cur.getFullYear());
      const groups = {}; inM.forEach(e => { (groups[P2.ymd(e.at)] = groups[P2.ymd(e.at)] || []).push(e); });
      body = inM.length ? `<div class="panel">${Object.entries(groups).map(([k, list]) => `<div class="pp-agenda-day">${P2.stamp(P2.parseYmd(k))}<ul>${list.map(e => `<li><span class="t">${ftime(e.at)}</span><span class="ellipsis"><button class="link" style="border:0;background:none;padding:0" data-ev="${e.id}">${esc(e.title)}</button> <span class="faint small">${esc(e.court || '')}</span></span>${chip(e.type, P2.TYPE_TONE[e.type])}</li>`).join('')}</ul></div>`).join('')}</div>`
        : `<div class="panel">${emptyState({ icon: 'calendar', title: 'Nothing scheduled this month', text: 'Change the filters or add an event.' })}</div>`;
    } else {
      const cur = P2Cal.cursor; title = fdate(cur, { month: 'long', year: 'numeric' });
      const start = new Date(cur); start.setDate(1 - ((cur.getDay() + 6) % 7));
      const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
      body = `<div class="cal"><div class="cal-head">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div>${d}</div>`).join('')}</div><div class="cal-grid">${cells.map(d => {
        const list = evs.filter(e => P2.sameDay(e.at, d)); const wk = d.getDay() === 0 || d.getDay() === 6;
        return `<div class="cal-day pp-cal-day ${d.getMonth() !== cur.getMonth() ? 'out' : ''} ${daysFrom(d) === 0 ? 'today' : ''} ${wk ? 'weekend' : ''}" data-day="${P2.ymd(d)}" title="Add an event on ${fdate(d)}">
          <span class="d" ${daysFrom(d) === 0 ? 'aria-current="date"' : ''}>${d.getDate()}</span>
          ${list.slice(0, 3).map(e => `<button class="ev ${P2.TYPE_CLS[e.type]}" data-ev="${e.id}" aria-label="${esc(e.type)}: ${esc(e.title)}, ${ftime(e.at)}">${esc(e.title)}</button>`).join('')}
          ${list.length > 3 ? `<button class="pp-more" data-more="${P2.ymd(d)}">+${list.length - 3} more</button>` : ''}
        </div>`;
      }).join('')}</div></div>`;
    }
    return `<div id="pg-cal">
      <div class="page-head"><div><h1>Hearings &amp; events</h1><p>Hearings, client meetings, payment dues and filings. Click an empty part of a day to add an event.</p></div>
        <div class="actions">${can('EVENT_CREATE') ? `<button class="btn primary" id="cal-add">${I('plus', 'sm')}Add event</button>` : ''}</div></div>
      <div class="pp-cal-tool">
        <button class="btn icon" id="cal-prev" aria-label="Previous">${I('chevronLeft', 'sm')}</button>
        <button class="btn" id="cal-today">Today</button>
        <button class="btn icon" id="cal-next" aria-label="Next">${I('chevron', 'sm')}</button>
        <h2 aria-live="polite">${title}</h2>
        <div class="seg" data-seg="view" role="group" aria-label="View">${['month', 'week', 'agenda'].map(x => `<button data-v="${x}" aria-pressed="${v === x}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}</div>
        <span class="grow"></span>
        <div class="row wrap" role="group" aria-label="Event types">${P2.TYPES.map(t => `<button class="filter-chip" data-type="${t}" aria-pressed="${P2Cal.types.has(t)}">${esc(t)}</button>`).join('')}</div>
      </div>
      ${body}
      <div style="margin-top:var(--s4)">${legend([{ label: 'Hearing', color: 'var(--ink)' }, { label: 'Client meeting', color: 'var(--info)' }, { label: 'Payment due', color: 'var(--warn)' }, { label: 'Document filing', color: 'var(--ok)' }, { label: 'Today', color: 'var(--tape)' }])}</div>
    </div>`;
  },
  mount(root) {
    const pg = root.querySelector('#pg-cal');
    const step = (n) => {
      if (P2Cal.view === 'week') P2Cal.weekStart.setDate(P2Cal.weekStart.getDate() + 7 * n);
      else P2Cal.cursor = new Date(P2Cal.cursor.getFullYear(), P2Cal.cursor.getMonth() + n, 1);
      router();
    };
    pg.querySelector('#cal-prev').onclick = () => step(-1);
    pg.querySelector('#cal-next').onclick = () => step(1);
    pg.querySelector('#cal-today').onclick = () => { P2Cal.cursor = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1); const d = new Date(TODAY); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); P2Cal.weekStart = d; router(); };
    const add = pg.querySelector('#cal-add'); if (add) add.onclick = () => FORMS.event({ onSave: router });
    pg.addEventListener('segchange', e => {
      const was = P2Cal.view; P2Cal.view = e.detail;
      // Keep week and month in step so switching views lands where you were looking.
      const monday = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
      if (e.detail === 'week' && was !== 'week') {
        const inCur = P2Cal.cursor.getMonth() === TODAY.getMonth() && P2Cal.cursor.getFullYear() === TODAY.getFullYear();
        P2Cal.weekStart = monday(inCur ? TODAY : P2Cal.cursor);
      }
      if (e.detail !== 'week' && was === 'week') P2Cal.cursor = new Date(P2Cal.weekStart.getFullYear(), P2Cal.weekStart.getMonth(), 1);
      router();
    });
    pg.addEventListener('click', e => {
      const t = e.target.closest('[data-type]');
      if (t) { const k = t.dataset.type; P2Cal.types.has(k) ? P2Cal.types.delete(k) : P2Cal.types.add(k); router(); return; }
      const evb = e.target.closest('[data-ev]');
      if (evb) { const ev = D.events.find(x => x.id === +evb.dataset.ev); if (ev) p2EventDrawer(ev); return; }
      const more = e.target.closest('[data-more]');
      if (more) {
        const d = P2.parseYmd(more.dataset.more); const list = p2Events().filter(x => P2.sameDay(x.at, d));
        modal({
          title: P2.longDate(d), size: 'narrow',
          body: `<div class="stack" style="gap:6px">${list.map(x => `<button class="ev ${P2.TYPE_CLS[x.type]}" data-id="${x.id}" style="font-size:var(--t-sm);padding:6px 8px"><span class="mono">${ftime(x.at)}</span> ${esc(x.title)}</button>`).join('')}</div>`,
          onMount(m, close) { m.addEventListener('click', ev2 => { const b = ev2.target.closest('[data-id]'); if (b) { close(); p2EventDrawer(D.events.find(x => x.id === +b.dataset.id)); } }); },
        });
        return;
      }
      const cell = e.target.closest('[data-day]');
      if (cell && can('EVENT_CREATE') && (e.target === cell || e.target.classList.contains('d'))) FORMS.event({ date: P2.noon(P2.parseYmd(cell.dataset.day)), onSave: router });
    });
  },
});

/* ==========================================================================
   3. DAILY CAUSELIST: your matters in the published lists for one date.
   ========================================================================== */
const P2CL = { date: P2.ymd(TODAY) };
page('/causelist', {
  title: 'Daily causelist', perm: 'CASE_VIEW', skeleton: 'table',
  render() {
    const sel = P2.parseYmd(P2CL.date); const off = daysFrom(sel);
    let rows;
    if (off === 0) rows = D.cases.filter(c => c.next && daysFrom(c.next) === 0).map(c => ({ c, item: c.item, stage: c.stage, judge: c.judge, at: c.next }));
    else rows = D.cases.flatMap(c => D.hearingHistory(c.id).filter(h => P2.sameDay(h.date, sel)).map(h => ({ c, item: h.item, stage: h.purpose, judge: h.judge, outcome: h.outcome })))
      .concat(D.events.filter(e => e.type === 'Hearing' && P2.sameDay(e.at, sel)).map(e => { const c = caseById(e.caseId); return { c, item: c.item || 10 + (c.id % 40), stage: e.purpose || c.stage, judge: c.judge }; }));
    // de-duplicate by case
    const seen = new Set(); rows = rows.filter(r => !seen.has(r.c.id) && seen.add(r.c.id)).sort((a, b) => a.item - b.item);
    const groups = {}; rows.forEach(r => { const k = r.c.courtName + (r.c.court === 'mhc-md' ? ', Madurai Bench' : ''); (groups[k] = groups[k] || []).push(r); });
    const dateTxt = P2.longDate(sel);
    const body = rows.length ? Object.entries(groups).map(([court, list]) => `<section class="panel" style="margin-bottom:var(--s4)">
        <div class="panel-head" style="padding-bottom:var(--s3)"><h3 class="serif" style="font-size:var(--t-lg);font-weight:500">${esc(court)} <span class="faint">(${list.length})</span></h3></div>
        <div class="table-wrap"><table class="t"><thead><tr><th scope="col">Item</th><th scope="col">Case</th><th scope="col" class="hide-sm">Court hall</th><th scope="col" class="hide-sm">Judge</th><th scope="col">Stage</th><th scope="col" class="actions"><span class="sr-only">Actions</span></th></tr></thead><tbody>
        ${list.map(r => { const cl = clientById(r.c.client); return `<tr>
          <td><div class="pp-cl-item">${r.item}</div></td>
          <td><a class="mono" href="#/cases/${r.c.id}">${esc(r.c.no)}</a><div class="cell-sub"><a href="#/cases/${r.c.id}" class="link">${esc(r.c.title)}</a></div>${r.outcome ? `<div class="cell-sub">${esc(r.outcome)}</div>` : ''}</td>
          <td class="hide-sm">${esc(r.c.hall)}</td><td class="hide-sm small">${esc(r.judge)}</td><td>${chip(r.stage, 'plain')}</td>
          <td class="actions">${off === 0 ? (cl ? `<button class="btn sm" data-alert="${r.c.id}">${I('send', 'sm')}Send alert to client</button>` : `<span title="No client is linked to this case"><button class="btn sm" disabled aria-describedby="na-${r.c.id}">Send alert to client</button></span><span id="na-${r.c.id}" class="sr-only">No client is linked to this case</span>`) : '<span class="faint xs">Heard</span>'}</td>
        </tr>`; }).join('')}
        </tbody></table></div></section>`).join('')
      : `<div class="panel">${emptyState({ icon: 'list', title: `Nothing of yours is listed on ${fdate(sel)}`, text: 'Try another date, or check the display board for live court status.' })}</div>`;
    return `<div id="pg-cl">
      <div class="page-head"><div><h1>Daily causelist</h1><p>Your matters in the cause lists for ${dateTxt}.</p></div></div>
      <div class="toolbar">
        <button class="btn icon" id="cl-prev" aria-label="Previous day">${I('chevronLeft', 'sm')}</button>
        <label class="sr-only" for="cl-date">Causelist date</label>
        <input type="date" class="input" id="cl-date" style="width:auto" value="${P2CL.date}" max="${P2.ymd(TODAY)}">
        <button class="btn icon" id="cl-next" aria-label="Next day" ${off >= 0 ? 'disabled' : ''}>${I('chevron', 'sm')}</button>
        ${off !== 0 ? `<button class="btn ghost" id="cl-today">Today</button>` : ''}
        <span class="grow"></span><span class="faint small">${rows.length} matter${rows.length === 1 ? '' : 's'}</span>
      </div>
      ${body}
    </div>`;
  },
  mount(root) {
    const pg = root.querySelector('#pg-cl');
    const set = (d) => { if (d > TODAY) return; P2CL.date = P2.ymd(d); router(); };
    pg.querySelector('#cl-prev').onclick = () => { const d = P2.parseYmd(P2CL.date); d.setDate(d.getDate() - 1); set(d); };
    pg.querySelector('#cl-next').onclick = () => { const d = P2.parseYmd(P2CL.date); d.setDate(d.getDate() + 1); set(d); };
    const t = pg.querySelector('#cl-today'); if (t) t.onclick = () => set(new Date(TODAY));
    pg.querySelector('#cl-date').onchange = (e) => { if (e.target.value) set(P2.parseYmd(e.target.value)); };
    pg.addEventListener('click', e => { const b = e.target.closest('[data-alert]'); if (b) p2ClientAlert(caseById(b.dataset.alert)); });
  },
});

/* ==========================================================================
   4. DISPLAY BOARD: live "now at item" per court hall, from the scraper.
   ========================================================================== */
const P2DB = {
  scope: 'mine', updated: new Date(), scError: true, closed: new Set(),
  extra: [
    { court: 'Madras High Court, Madurai Bench', rows: [
      { court: 'Court Hall 2', item: 9, yours: 18, judge: 'G. R. Swaminathan, J.', stage: 'Admission', progress: 'In progress', vc: 'Link' },
      { court: 'Court Hall 5', item: 27, yours: null, judge: 'B. Pugalendhi, J.', stage: 'Bail', progress: 'In progress', vc: 'Link' },
    ] },
    { court: 'Supreme Court of India', error: true, rows: [
      { court: 'Court No. 3', item: 8, yours: 12, judge: 'Sanjiv Khanna, J.', stage: 'Regular hearing', progress: 'In progress', vc: 'Link' },
      { court: 'Court No. 5', item: 44, yours: null, judge: 'B. V. Nagarathna, J.', stage: 'Miscellaneous', progress: 'In progress', vc: 'Link' },
    ] },
    { court: 'Family Court, Chennai', rows: [
      { court: 'I Addl. Family Court', item: 3, yours: null, judge: 'Tmt. G. Saraswathi', stage: 'Mediation', progress: 'In progress', vc: '—' },
      { court: 'II Addl. Family Court', item: 0, yours: null, judge: 'Tmt. L. Abirami', stage: 'Not sitting', progress: 'List over', vc: '—', over: true },
    ] },
  ],
};
page('/display-board', {
  title: 'Display board', perm: 'CASE_VIEW', skeleton: 'table',
  render() {
    const boards = P2DB.scope === 'mine' ? D.displayBoard : D.displayBoard.concat(P2DB.extra);
    const all = D.displayBoard.length + P2DB.extra.length;
    const table = (b) => `<div class="table-wrap"><table class="t"><thead><tr><th scope="col">Court hall</th><th scope="col">Now at item</th><th scope="col">Your item</th><th scope="col" class="hide-sm">Judge</th><th scope="col" class="hide-sm">Stage</th><th scope="col">Progress</th><th scope="col">VC</th></tr></thead><tbody>
      ${b.rows.map(r => {
        const gap = r.yours != null && !r.over ? r.yours - r.item : null; const hot = gap != null && gap >= 0 && gap <= 5;
        return `<tr class="pp-board-row ${r.over ? 'over' : ''} ${hot ? 'hl' : ''}">
          <td>${esc(r.court)}</td>
          <td><span class="pp-now-item">${r.over ? '—' : r.item}</span></td>
          <td>${r.yours == null ? '<span class="faint">—</span>' : `<span class="mono ${hot ? 'pp-yours-hot' : ''}">${r.yours}</span>${hot ? ` <span class="xs pp-yours-hot">Coming up</span>` : gap < 0 ? ' <span class="faint xs">Passed</span>' : ` <span class="faint xs">${gap} to go</span>`}`}</td>
          <td class="hide-sm small">${esc(r.judge)}</td><td class="hide-sm">${esc(r.stage)}</td>
          <td>${chip(r.progress, r.over ? '' : r.progress === 'Passed over' ? 'warn' : 'info')}</td>
          <td>${r.vc === 'Link' ? `<button class="btn sm ghost" data-vc="${esc(r.court)}">${I('external', 'sm')}Join</button>` : '<span class="faint">—</span>'}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    return `<div id="pg-db">
      <div class="page-head"><div><h1>Display board</h1><p>Where each court hall has reached in its list, so you know when to walk in.</p></div>
        <div class="actions" style="align-items:center"><span class="pp-live"><i aria-hidden="true"></i>Live, updated ${ftime(P2DB.updated)}</span><button class="btn" id="db-refresh">${I('refresh', 'sm')}Refresh</button></div></div>
      <div class="toolbar"><div class="seg" data-seg="scope" role="group" aria-label="Forums">
        <button data-v="mine" aria-pressed="${P2DB.scope === 'mine'}">My forums (${D.displayBoard.length})</button>
        <button data-v="all" aria-pressed="${P2DB.scope === 'all'}">All forums (${all})</button></div></div>
      ${boards.map((b, i) => {
        const yours = b.rows.filter(r => r.yours != null).length;
        return `<details class="pp-acc" data-acc="${esc(b.court)}" ${P2DB.closed.has(b.court) ? '' : 'open'}>
          <summary>${I('chevron', 'sm chev')}<h3 class="grow">${esc(b.court)}</h3><span class="faint small">${b.rows.length} halls${yours ? `, ${yours} with your matters` : ''}</span></summary>
          ${b.error && P2DB.scError ? `<div style="padding:0 var(--s5) var(--s4)"><div class="callout bad" role="alert">${I('warn', 'sm')}<div class="grow">Couldn't reach the Supreme Court board. Showing data from 10:42.</div><button class="btn sm" id="db-retry">Retry</button></div></div>` : ''}
          ${table(b)}
        </details>`;
      }).join('')}
    </div>`;
  },
  mount(root) {
    const pg = root.querySelector('#pg-db');
    pg.addEventListener('segchange', e => { P2DB.scope = e.detail; router(); });
    pg.querySelectorAll('details[data-acc]').forEach(d => d.addEventListener('toggle', () => { d.open ? P2DB.closed.delete(d.dataset.acc) : P2DB.closed.add(d.dataset.acc); }));
    pg.querySelector('#db-refresh').onclick = (e) => busy(e.currentTarget, () => {
      const live = D.displayBoard.concat(P2DB.extra).flatMap(b => b.rows).filter(r => !r.over);
      const r = live[Math.floor(Math.random() * live.length)]; r.item += 1 + Math.floor(Math.random() * 3);
      P2DB.updated = new Date(); router(); toast(`Board refreshed. ${esc(r.court)} is now at item ${r.item}.`, 'ok');
    }, 900);
    pg.addEventListener('click', e => {
      const r = e.target.closest('#db-retry');
      if (r) { busy(r, () => { P2DB.scError = false; P2DB.updated = new Date(); router(); toast('Supreme Court board is back', 'ok'); }, 900); return; }
      const vc = e.target.closest('[data-vc]'); if (vc) toast(`Opening the video conference link for ${esc(vc.dataset.vc)}`, 'info');
    });
  },
});

/* ==========================================================================
   5. APPEAL ALERT: appeals found against our decided cases, for a human to verify.
   ========================================================================== */
page('/appeals', {
  title: 'Appeal alert', perm: 'CASE_EDIT', skeleton: 'table',
  render() {
    const nNew = D.appeals.filter(a => a.status === 'New').length;
    const dismissed = D.appeals.filter(a => a.status === 'Dismissed');
    return `<div id="pg-ap">
      <div class="page-head"><div><h1>Appeal alert</h1><p>Appeals filed in higher courts against your decided cases, found by the nightly court-record check. Verify before acting; no limitation period is calculated.</p></div></div>
      ${nNew ? '' : `<div class="panel" style="margin-bottom:var(--s4)">${emptyState({ icon: 'ok', title: 'No new appeals to review', text: 'The nightly check found nothing new. Confirmed matches stay listed below.' })}</div>`}
      <div id="ap-table"></div>
      <section class="panel" style="margin-top:var(--s6)"><div class="panel-head"><h3>Dismissed as unrelated</h3><span class="sub">${dismissed.length}</span></div>
        <div class="panel-body ${dismissed.length ? 'flush' : ''}">${dismissed.length ? `<div class="list">${dismissed.map(a => { const c = caseById(a.source); return `<div class="list-item"><div class="grow"><div class="small"><span class="mono">${esc(a.appealNo)}</span> <span class="faint">${esc(a.forum)}</span></div><div class="faint xs">${esc(a.parties)}. Matched to <span class="mono">${esc(c.no)}</span></div></div><button class="btn sm" data-restore="${a.id}">${I('restore', 'sm')}Restore</button></div>`; }).join('')}</div>` : '<p class="muted small">Nothing dismissed.</p>'}</div></section>
    </div>`;
  },
  mount(root) {
    const pg = root.querySelector('#pg-ap');
    DataTable(pg.querySelector('#ap-table'), {
      rowsFn: () => D.appeals.filter(a => a.status === 'New' || a.status === 'Confirmed'),
      initialSort: { key: 'matched', dir: 'desc' },
      empty: { icon: 'alert', title: 'No appeals found', text: 'Matches from the nightly check appear here.' },
      rowClass: (a) => a.status === 'New' ? 'hl' : '',
      columns: [
        { key: 'source', label: 'Your case', sort: (a) => caseById(a.source).no, render: (a) => { const c = caseById(a.source); return `<a class="mono link" href="#/cases/${c.id}">${esc(c.no)}</a><div class="cell-sub">${esc(c.title)}</div>`; } },
        { key: 'appealNo', label: 'Appeal found', render: (a) => `<span class="mono">${esc(a.appealNo)}</span>` },
        { key: 'forum', label: 'Forum', sort: true, hideSm: true },
        { key: 'parties', label: 'Parties', hideSm: true, render: (a) => `<span class="small">${esc(a.parties)}</span>` },
        { key: 'filed', label: 'Filed', sort: true, hideSm: true, render: (a) => fdate(a.filed) },
        { key: 'matched', label: 'Matched', sort: true, render: (a) => `<div class="small">${fdate(a.matched)}</div><div class="pp-score" title="Match score ${a.score} of 100"><div class="bar-track"><i style="width:${a.score}%;background:${a.score >= 80 ? 'var(--ink)' : 'var(--ink-3)'}"></i></div><span class="mono xs">${a.score}</span></div>` },
        { key: 'status', label: 'Status', sort: true, render: (a) => chip(a.status) },
        { key: 'act', label: '<span class="sr-only">Actions</span>', cls: 'actions', render: (a) => a.status === 'New' ? `<button class="btn sm primary" data-ap="confirm" data-id="${a.id}">It's an appeal</button> <button class="btn sm ghost" data-ap="dismiss" data-id="${a.id}">Not related</button>` : '<span class="faint xs">Verified</span>' },
      ],
    });
    pg.addEventListener('click', e => {
      const b = e.target.closest('[data-ap]');
      if (b) {
        const a = D.appeals.find(x => x.id === +b.dataset.id);
        a.status = b.dataset.ap === 'confirm' ? 'Confirmed' : 'Dismissed';
        refreshNav(); router();
        toast(a.status === 'Confirmed' ? `Marked <span class="mono">${esc(a.appealNo)}</span> as an appeal. Check the limitation and file your appearance.` : 'Dismissed as unrelated. You can restore it below.', a.status === 'Confirmed' ? 'ok' : 'info');
        return;
      }
      const r = e.target.closest('[data-restore]');
      if (r) { const a = D.appeals.find(x => x.id === +r.dataset.restore); a.status = 'New'; refreshNav(); router(); toast('Restored to the review list', 'ok'); }
    });
  },
});
