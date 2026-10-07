/* ==========================================================================
   PAGES 5: sign-in flow, firm administration and the client portal.
   Auth pages are public + bare (own the whole screen). Firm pages render in
   the shell and are gated by the permissions in core NAV. The portal is bare
   but needs a signed-in session.
   ========================================================================== */

/* Page-local styles. Tokens only, so light and dark both work. */
document.head.insertAdjacentHTML('beforeend', `<style>
.auth-form { position: relative; }
.pp-auth-tools { position: absolute; top: 16px; right: 16px; display: flex; gap: 6px; }
.pp-art-brand { display: flex; align-items: center; gap: 12px; position: relative; }
.pp-art-brand .seal { width: 40px; height: 40px; border-radius: 50%; background: var(--tape); display: grid; place-items: center; font: 600 17px/1 var(--f-display); color: #fff; box-shadow: inset 0 0 0 2px rgba(255,255,255,.2), 0 0 0 4px rgba(255,255,255,.04); }
.pp-art-brand b { font: 500 24px/1 var(--f-display); color: #fff; letter-spacing: -.01em; }
.pp-art-brand small { display: block; color: var(--side-ink-2); font-size: var(--t-xs); margin-top: 4px; }
.pp-art-mid { position: relative; }
.pp-art-mid .rule { width: 44px; height: 2px; background: var(--tape); margin-bottom: 22px; }
.pp-art-foot { position: relative; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: var(--t-xs); color: var(--side-ink-2); }
.pp-mobile-brand { display: none; align-items: center; gap: 10px; margin-bottom: 28px; }
.pp-mobile-brand .seal { width: 32px; height: 32px; border-radius: 50%; background: var(--tape); color: #fff; display: grid; place-items: center; font: 600 14px/1 var(--f-display); }
.pp-mobile-brand b { font: 500 20px/1 var(--f-display); }
.pp-kicker { font-size: var(--t-sm); color: var(--ink-3); margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.pp-kicker::before { content: ''; width: 18px; height: 2px; background: var(--tape); }
.pp-pw { position: relative; }
.pp-pw .input { padding-right: 42px; }
.pp-pw .btn { position: absolute; right: 2px; top: 1px; height: 34px; }
.pp-hint { border: 1px dashed var(--line-strong); border-radius: var(--r-md); padding: 12px 14px; font-size: var(--t-xs); color: var(--ink-2); }
.pp-hint .row { margin-top: 8px; }
.pp-full { width: 100%; height: 40px; }
.pp-success-ic { width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; background: var(--ok-soft); color: var(--ok); margin-bottom: 16px; }
.otp input.input { padding: 0; }
@media (max-width: 400px) { .otp { gap: 5px; } .otp input { width: 40px; height: 48px; font-size: 19px; } }
@media (max-width: 1024px) { .pp-mobile-brand { display: flex; } }
.pp-vtabs { display: flex; flex-direction: column; padding: 6px; gap: 2px; }
.pp-vtabs button { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border: 0; background: none; border-radius: var(--r-sm); color: var(--ink-2); font-size: var(--t-sm); text-align: left; position: relative; white-space: nowrap; }
.pp-vtabs button:hover { background: var(--surface-2); color: var(--ink); }
.pp-vtabs button[aria-selected="true"] { background: var(--surface-3); color: var(--ink); font-weight: 500; }
.pp-vtabs button[aria-selected="true"]::before { content: ''; position: absolute; left: -6px; top: 7px; bottom: 7px; width: 3px; border-radius: 0 2px 2px 0; background: var(--tape); }
@media (max-width: 1024px) { .pp-vtabs { flex-direction: row; overflow-x: auto; } .pp-vtabs button[aria-selected="true"]::before { display: none; } }
.pp-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--s4); }
.pp-tile { border: 1px solid var(--line); border-radius: var(--r-lg); overflow: hidden; background: var(--surface); }
.pp-tile .pv { height: 110px; display: grid; place-items: center; background: var(--surface-2); border-bottom: 1px solid var(--line); color: var(--ink-3); font-size: var(--t-xs); text-align: center; }
.pp-tile .pv .seal { width: 56px; height: 56px; border-radius: 50%; background: var(--tape); color: #fff; display: grid; place-items: center; font: 600 22px/1 var(--f-display); }
.pp-tile .bd { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px; }
.pp-swatch { display: flex; align-items: center; gap: 10px; }
.pp-swatch input[type=color] { width: 40px; height: 34px; padding: 2px; border: 1px solid var(--line-strong); border-radius: var(--r-sm); background: var(--surface); }
.pp-radio-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s3); }
.pp-radio-cards label { border: 1px solid var(--line-strong); border-radius: var(--r-md); padding: 12px; cursor: pointer; display: flex; flex-direction: column; gap: 8px; font-size: var(--t-sm); }
.pp-radio-cards label:has(input:checked) { border-color: var(--ink); box-shadow: 0 0 0 1px var(--ink); }
.pp-radio-cards .sw { height: 54px; border-radius: var(--r-sm); border: 1px solid var(--line); display: flex; overflow: hidden; }
.pp-radio-cards input { accent-color: var(--ink); }
@media (max-width: 560px) { .pp-radio-cards { grid-template-columns: 1fr; } }
.pp-role-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: var(--s4); }
.pp-role { display: flex; flex-direction: column; gap: 10px; padding: var(--s5); }
.pp-role h3 { font: 500 var(--t-xl)/1.2 var(--f-display); }
.pp-matrix th, .pp-matrix td { vertical-align: top; }
.pp-matrix .perms { display: flex; flex-wrap: wrap; gap: 6px 18px; }
.pp-progress { height: 8px; border-radius: 4px; background: var(--surface-3); overflow: hidden; }
.pp-progress i { display: block; height: 100%; width: 0; background: var(--ink); transition: width var(--d-med) var(--ease); }
.pp-steps { display: flex; flex-direction: column; gap: 8px; margin-top: 16px; font-size: var(--t-sm); }
.pp-steps div { display: flex; align-items: center; gap: 10px; color: var(--ink-3); }
.pp-steps div.on { color: var(--ink); }
.pp-steps div.done { color: var(--ok); }
.pp-type-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--s3); }
.pp-type-cards button { text-align: left; padding: 14px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--surface); display: flex; flex-direction: column; gap: 6px; }
.pp-type-cards button:hover { border-color: var(--ink-3); background: var(--surface-2); }
.portal-nav a { position: relative; padding: 11px 12px; color: var(--ink-2); font-size: var(--t-sm); font-weight: 500; white-space: nowrap; }
.portal-nav a:hover { color: var(--ink); }
.portal-nav a[aria-current="page"] { color: var(--ink); }
.portal-nav a[aria-current="page"]::after { content: ''; position: absolute; left: 8px; right: 8px; bottom: 0; height: 2px; background: var(--tape); border-radius: 2px 2px 0 0; }
.portal-top .seal { width: 34px; height: 34px; border-radius: 50%; background: var(--tape); color: #fff; display: grid; place-items: center; font: 600 15px/1 var(--f-display); flex: none; }
.portal-foot { border-top: 1px solid var(--line); background: var(--surface); }
.portal-foot .in { max-width: 1080px; margin: 0 auto; padding: 20px; font-size: var(--t-xs); color: var(--ink-3); display: flex; gap: 8px 24px; flex-wrap: wrap; }
.pp-msg-body { white-space: pre-wrap; font-size: var(--t-md); line-height: 1.65; }
.pp-case-card { display: block; padding: var(--s5); transition: border-color var(--d-fast); }
a.pp-case-card:hover { border-color: var(--ink-3); }
@media (max-width: 560px) { .portal-top .in { flex-wrap: wrap; } .portal-top .who { display: none; } }
</style>`);

/* ---------- Shared helpers ---------- */
const PW_RULES = [
  ['len', '8 to 32 characters', v => v.length >= 8 && v.length <= 32],
  ['low', 'A lowercase letter', v => /[a-z]/.test(v)],
  ['up', 'An uppercase letter', v => /[A-Z]/.test(v)],
  ['num', 'A number', v => /\d/.test(v)],
  ['sp', 'A special character', v => /[^A-Za-z0-9]/.test(v)],
];
/* Password field with show/hide toggle */
function pwField({ id, label, value = '', autocomplete = 'new-password', err = 'Enter a password.', required = true }) {
  return `<div class="field"><label for="${id}">${label}${required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
    <div class="pp-pw"><input id="${id}" type="password" class="input" value="${esc(value)}" autocomplete="${autocomplete}" ${required ? 'required' : ''}>
    <button type="button" class="btn ghost sm icon" data-reveal="${id}" aria-label="Show password" aria-pressed="false">${I('eye', 'sm')}</button></div>
    <span class="err" role="alert">${I('warn', 'sm')}${err}</span></div>`;
}
function wireReveal(root) {
  root.querySelectorAll('[data-reveal]').forEach(b => b.addEventListener('click', () => {
    const inp = root.querySelector('#' + b.dataset.reveal); const show = inp.type === 'password';
    inp.type = show ? 'text' : 'password'; b.setAttribute('aria-pressed', show); b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  }));
}
/* New + confirm password block with live rules, strength meter and match indicator */
function pwBlock(p) {
  return `${pwField({ id: p + '-new', label: 'New password', err: 'Meet every rule below.' })}
    <div class="stack" style="gap:8px"><div class="meter" aria-hidden="true"><i id="${p}-meter"></i></div>
      <div class="row between xs"><span class="faint">Strength</span><b id="${p}-str" class="xs" aria-live="polite">Too short</b></div>
      <ul class="pw-rules" id="${p}-rules" style="list-style:none;margin:0;padding:0" aria-label="Password rules">${PW_RULES.map(([k, l]) => `<li data-r="${k}" class="row" style="gap:6px">${I('minus', 'sm')}<span>${l}</span></li>`).join('')}</ul></div>
    ${pwField({ id: p + '-conf', label: 'Confirm new password', err: 'The two passwords don\'t match. Type the same password in both boxes.' })}
    <div id="${p}-match" class="xs" aria-live="polite" style="min-height:18px;margin-top:-8px"></div>`;
}
function wirePwBlock(root, p, onChange) {
  const n = root.querySelector(`#${p}-new`); const c = root.querySelector(`#${p}-conf`);
  const check = () => {
    const v = n.value; let score = 0;
    PW_RULES.forEach(([k, , fn]) => { const ok = fn(v); if (ok) score++; const li = root.querySelector(`#${p}-rules [data-r="${k}"]`); li.classList.toggle('ok', ok); li.querySelector('svg').outerHTML = I(ok ? 'check' : 'minus', 'sm'); });
    const [lbl, col] = !v ? ['Too short', 'var(--ink-3)'] : score <= 2 ? ['Weak', 'var(--bad)'] : score <= 4 ? ['Fair', 'var(--warn)'] : ['Strong', 'var(--ok)'];
    const m = root.querySelector(`#${p}-meter`); m.style.width = (score / 5 * 100) + '%'; m.style.background = col;
    const s = root.querySelector(`#${p}-str`); s.textContent = lbl; s.style.color = col;
    const mt = root.querySelector(`#${p}-match`);
    mt.innerHTML = !c.value ? '' : c.value === v ? `<span class="row" style="gap:4px;color:var(--ok)">${I('ok', 'sm')}Passwords match</span>` : `<span class="row" style="gap:4px;color:var(--bad)">${I('warn', 'sm')}Passwords don't match yet</span>`;
    const valid = score === 5 && c.value === v;
    onChange && onChange(valid);
    return valid;
  };
  n.addEventListener('input', check); c.addEventListener('input', check);
  check();
  return check;
}
const maskEmail = (e) => { const [u, d] = String(e).split('@'); return (u.slice(0, 2) + '•'.repeat(Math.max(2, u.length - 2))) + '@' + (d || ''); };
const themeIconBtn = () => `<button class="icon-btn" id="theme-btn" onclick="toggleTheme()" aria-label="Switch theme"></button>`;

/* Two-column auth frame: ink art panel with the red tape strand, form on paper */
function authFrame(inner) {
  return `<div class="auth">
    <aside class="auth-art" aria-hidden="false">
      <span class="tape-strand" aria-hidden="true"></span>
      <div class="pp-art-brand"><span class="seal" aria-hidden="true">P</span><div><b>PactPro</b><small>Practice management for advocates</small></div></div>
      <div class="pp-art-mid"><div class="rule" aria-hidden="true"></div>
        <blockquote>Justice delayed is justice denied.</blockquote><cite>Legal maxim</cite></div>
      <div class="pp-art-foot"><span>${esc(D.firm.name)}, Chennai</span><span>Madras High Court and subordinate courts</span></div>
    </aside>
    <main class="auth-form"><div class="pp-auth-tools">${themeIconBtn()}</div>
      <div class="auth-card"><div class="pp-mobile-brand"><span class="seal" aria-hidden="true">P</span><b>PactPro</b></div>${inner}</div></main>
  </div>`;
}
let pendingResetEmail = D.me.email;

/* ==========================================================================
   1. /login
   ========================================================================== */
page('/login', {
  title: 'Sign in', public: true, bare: true,
  render: () => authFrame(`
    <div class="pp-kicker">${esc(D.firm.name)}</div>
    <h1>Sign in</h1>
    <p class="muted" style="margin-bottom:24px">Use the email your firm admin created for you.</p>
    <form id="lf" class="stack" novalidate>
      <div id="l-alert" aria-live="assertive"></div>
      ${field({ id: 'l-email', label: 'Email', type: 'email', value: D.me.email, required: true, rule: 'email', err: 'Enter your work email, like name@firm.com.', attrs: 'autocomplete="username"' })}
      ${pwField({ id: 'l-pw', label: 'Password', value: 'Demo@1234', autocomplete: 'current-password', err: 'Enter your password.' })}
      <div class="row between wrap"><label class="check"><input type="checkbox" id="l-keep" checked> Keep me signed in on this device</label><a class="link small" href="#/forgot">Forgot password?</a></div>
      <button class="btn primary pp-full" id="l-go" type="submit">Sign in</button>
    </form>
    <p class="small muted" style="margin-top:18px">Client? Use the link in your invitation email.</p>
    <div class="pp-hint" style="margin-top:20px"><b class="small" style="color:var(--ink)">Demo</b>: any role signs in with password <span class="mono">Demo@1234</span>. Pick the role to view PactPro as:
      <div class="row wrap" id="l-roles">${['Senior Advocate', 'Junior Advocate', 'Intern', 'Accountant', 'Super Admin'].map(r => `<button type="button" class="filter-chip" data-role="${r}" aria-pressed="${session.role === r}">${r}</button>`).join('')}</div>
      <div style="margin-top:10px">Or preview the <a class="link" href="#/set-password">client invitation</a>.</div></div>`),
  mount(root) {
    updateThemeBtn(); wireReveal(root);
    let role = session.role;
    root.querySelector('#l-roles').addEventListener('click', e => {
      const b = e.target.closest('[data-role]'); if (!b) return; role = b.dataset.role;
      root.querySelectorAll('#l-roles [data-role]').forEach(x => x.setAttribute('aria-pressed', x === b));
      const a = D.advocates.find(x => x.role === role); if (a) root.querySelector('#l-email').value = a.email;
    });
    root.querySelector('#lf').addEventListener('submit', e => {
      e.preventDefault();
      const alert = root.querySelector('#l-alert'); alert.innerHTML = '';
      if (!validateForm(e.target)) return;
      busy(root.querySelector('#l-go'), () => {
        if (root.querySelector('#l-pw').value !== 'Demo@1234') {
          alert.innerHTML = `<div class="callout bad">${I('warn')}<div>That email and password don't match. Check the password or <a class="link" href="#/forgot">reset it</a>.</div></div>`;
          root.querySelector('#l-pw').focus(); return;
        }
        session.role = role; store.set('role', role);
        session.authed = true; store.set('authed', true);
        document.querySelector('#app').innerHTML = ''; go('/');
      }, 800);
    });
  },
});

/* ==========================================================================
   2. /forgot
   ========================================================================== */
page('/forgot', {
  title: 'Reset password', public: true, bare: true,
  render: () => authFrame(`<div id="fg">
    <a class="link small" href="#/login">Back to sign in</a>
    <h1 style="margin-top:16px">Reset your password</h1>
    <p class="muted" style="margin-bottom:24px">Enter the email you sign in with. We'll send a 6-digit verification code to it.</p>
    <form id="ff" class="stack" novalidate>
      ${field({ id: 'f-email', label: 'Email', type: 'email', value: pendingResetEmail, required: true, rule: 'email', err: 'Enter a valid email, like name@firm.com.' })}
      <button class="btn primary pp-full" id="f-go" type="submit">Send verification code</button>
    </form></div>`),
  mount(root) {
    updateThemeBtn();
    root.querySelector('#ff').addEventListener('submit', e => {
      e.preventDefault(); if (!validateForm(e.target)) return;
      busy(root.querySelector('#f-go'), () => {
        pendingResetEmail = root.querySelector('#f-email').value.trim();
        root.querySelector('#fg').innerHTML = `<div role="status"><div class="pp-success-ic">${I('mail', 'lg')}</div>
          <h1>Check your email</h1>
          <p class="muted" style="margin:8px 0 24px">We sent a 6-digit code to <b class="mono">${esc(maskEmail(pendingResetEmail))}</b>. It expires in 10 minutes. Check spam if it isn't in your inbox.</p>
          <a class="btn primary pp-full" href="#/verify">Enter the code</a>
          <p class="small muted" style="margin-top:16px">Wrong email? <a class="link" href="#/forgot" onclick="router()">Use a different one</a></p></div>`;
      }, 900);
    });
  },
});

/* ==========================================================================
   3. /verify
   ========================================================================== */
page('/verify', {
  title: 'Verify code', public: true, bare: true,
  render: () => authFrame(`
    <a class="link small" href="#/forgot">Back</a>
    <h1 style="margin-top:16px">Enter verification code</h1>
    <p class="muted" style="margin-bottom:24px">Type the 6-digit code we sent to <b class="mono">${esc(maskEmail(pendingResetEmail))}</b>.</p>
    <form id="vf" class="stack" novalidate>
      <fieldset style="border:0;padding:0;margin:0"><legend class="label" style="margin-bottom:8px">Verification code</legend>
        <div class="otp" id="otp">${Array.from({ length: 6 }, (_, i) => `<input class="input" inputmode="numeric" autocomplete="${i ? 'off' : 'one-time-code'}" maxlength="1" aria-label="Digit ${i + 1} of 6">`).join('')}</div></fieldset>
      <div id="v-alert" aria-live="assertive"></div>
      <button class="btn primary pp-full" id="v-go" type="submit">Verify code</button>
      <p class="small muted" id="v-resend" aria-live="polite"></p>
    </form>`),
  mount(root) {
    updateThemeBtn();
    const ins = [...root.querySelectorAll('#otp input')];
    const fill = (digits, from = 0) => { digits.split('').forEach((d, k) => { if (ins[from + k]) ins[from + k].value = d; }); (ins[Math.min(from + digits.length, 5)]).focus(); };
    ins.forEach((inp, i) => {
      inp.addEventListener('input', () => { const d = inp.value.replace(/\D/g, ''); if (d.length > 1) { fill(d.slice(0, 6 - i), i); return; } inp.value = d; if (d && i < 5) ins[i + 1].focus(); });
      inp.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !inp.value && i > 0) { ins[i - 1].value = ''; ins[i - 1].focus(); e.preventDefault(); }
        if (e.key === 'ArrowLeft' && i > 0) ins[i - 1].focus();
        if (e.key === 'ArrowRight' && i < 5) ins[i + 1].focus();
      });
      inp.addEventListener('paste', e => { e.preventDefault(); const d = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6); if (d) fill(d, 0); });
      inp.addEventListener('focus', () => inp.select());
    });
    setTimeout(() => ins[0].focus(), 30);
    // Resend link with a 30 second cool-down
    const rs = root.querySelector('#v-resend'); let t;
    const countdown = () => { let n = 30; clearInterval(t); const tick = () => { if (!document.body.contains(rs)) return clearInterval(t); if (n <= 0) { clearInterval(t); rs.innerHTML = `Didn't get it? <button type="button" class="link" style="border:0;background:none;padding:0" id="v-again">Send a new code</button>`; rs.querySelector('#v-again').onclick = () => { toast('New code sent to ' + esc(maskEmail(pendingResetEmail)), 'info'); countdown(); }; return; } rs.textContent = `You can request a new code in ${n--} s.`; }; tick(); t = setInterval(tick, 1000); };
    countdown();
    root.querySelector('#vf').addEventListener('submit', e => {
      e.preventDefault();
      const code = ins.map(x => x.value).join(''); const al = root.querySelector('#v-alert');
      if (code.length < 6) { al.innerHTML = `<div class="callout bad">${I('warn')}<div>Enter all 6 digits of the code.</div></div>`; ins.find(x => !x.value).focus(); return; }
      busy(root.querySelector('#v-go'), () => {
        if (code === '000000') { al.innerHTML = `<div class="callout bad">${I('warn')}<div>That code is wrong or expired. Request a new one.</div></div>`; ins.forEach(x => { x.value = ''; x.setAttribute('aria-invalid', 'true'); }); ins[0].focus(); return; }
        clearInterval(t); go('/reset');
      });
    });
  },
});

/* ==========================================================================
   4. /reset
   ========================================================================== */
page('/reset', {
  title: 'Choose a new password', public: true, bare: true,
  render: () => authFrame(`
    <h1>Choose a new password</h1>
    <p class="muted" style="margin-bottom:24px">For <b class="mono">${esc(pendingResetEmail)}</b>. You'll be signed out on other devices.</p>
    <form id="rf" class="stack" novalidate>${pwBlock('r')}
      <button class="btn primary pp-full" id="r-go" type="submit" disabled>Save new password</button></form>`),
  mount(root) {
    updateThemeBtn(); wireReveal(root);
    const btn = root.querySelector('#r-go');
    wirePwBlock(root, 'r', ok => { btn.disabled = !ok; });
    root.querySelector('#rf').addEventListener('submit', e => { e.preventDefault(); if (btn.disabled) return; busy(btn, () => { toast('Password changed. Sign in with your new password.', 'ok'); go('/login'); }); });
  },
});

/* ==========================================================================
   5. /set-password (client invitation)
   ========================================================================== */
page('/set-password', {
  title: 'Set your password', public: true, bare: true,
  render: () => { const c = D.clients[0]; return authFrame(`
    <div class="pp-kicker">Client portal invitation</div>
    <h1>Welcome, ${esc(c.name)}.</h1>
    <p class="muted" style="margin-bottom:24px">Set a password for your client portal. ${esc(D.firm.name)} will share hearing dates, documents and invoices with you there.</p>
    <form id="sf" class="stack" novalidate>
      <div class="field"><label for="s-email">Email</label><input id="s-email" class="input" value="${esc(c.email)}" disabled><span class="hint">This is the email your advocate registered for you.</span></div>
      ${pwBlock('s')}
      <label class="check"><input type="checkbox" id="s-terms" checked> I agree to receive case updates by email</label>
      <button class="btn primary pp-full" id="s-go" type="submit" disabled>Set password and open portal</button></form>`); },
  mount(root) {
    updateThemeBtn(); wireReveal(root);
    const btn = root.querySelector('#s-go');
    wirePwBlock(root, 's', ok => { btn.disabled = !ok; });
    root.querySelector('#sf').addEventListener('submit', e => {
      e.preventDefault(); if (btn.disabled) return;
      busy(btn, () => { session.authed = true; store.set('authed', true); document.querySelector('#app').innerHTML = ''; go('/portal'); toast('Password set. Welcome to your portal.', 'ok'); });
    });
  },
});

/* ==========================================================================
   6. /settings
   ========================================================================== */
const pageHead = (t, p, actions = '') => `<div class="page-head"><div><h1>${t}</h1>${p ? `<p>${p}</p>` : ''}</div>${actions ? `<div class="actions">${actions}</div>` : ''}</div>`;
const saveRow = (id, label = 'Save changes') => `<div class="row full" style="justify-content:flex-end;margin-top:8px"><button type="button" class="btn primary" data-save="${id}">${label}</button></div>`;

page('/settings', {
  title: 'Settings', crumbs: [['Firm', '/users']],
  render() {
    const me = D.me; const b = D.firm.bank;
    const tabs = [['profile', 'user', 'Profile'], ['office', 'home', 'Office'], ['branding', 'image', 'Branding'], ['billing', 'receipt', 'Billing'], ['notifications', 'bell', 'Notifications'], ['security', 'lock', 'Security'], ['preferences', 'cog', 'Preferences']];
    const initialTab = query().get('tab') || 'profile';
    const tile = (name, hint, art) => `<div class="pp-tile"><div class="pv">${art}</div><div class="bd"><b class="small">${name}</b><span class="faint xs">${hint}</span><label class="btn sm">${I('upload', 'sm')}Upload<input type="file" accept="image/png,image/jpeg" class="sr-only" data-tile="${name}"></label></div></div>`;
    const t = effectiveTheme(); const explicit = document.documentElement.dataset.theme;
    return `${pageHead('Settings', 'Your profile, the firm\'s details and how PactPro behaves for you.')}
    <div class="split left-rail" data-tab-scope>
      <div class="panel rail"><div class="pp-vtabs" data-tabs aria-label="Settings sections" aria-orientation="vertical">${tabs.map(([k, i, l]) => `<button data-tab="${k}" aria-selected="${k === initialTab}">${I(i, 'sm')}${l}</button>`).join('')}</div></div>
      <div>
        <section class="panel tab-panel" data-panel="profile"><div class="panel-head"><div><h3>Profile</h3><div class="sub">Shown to colleagues and on documents you sign.</div></div></div>
          <div class="panel-body"><div class="row" style="gap:16px;margin-bottom:20px">${avatar(me.name, 'lg')}<div class="stack" style="gap:6px"><label class="btn sm">${I('upload', 'sm')}Upload photo<input type="file" accept="image/*" class="sr-only" id="av-up"></label><span class="faint xs">Square JPG or PNG, at least 200 px.</span></div></div>
          <form class="form-grid" novalidate id="sp">
            ${field({ id: 'p-name', label: 'Full name', value: me.name, required: true, err: 'Enter your name.' })}
            ${field({ id: 'p-phone', label: 'Phone', type: 'tel', value: me.phone, required: true, rule: 'phone', err: 'Enter a 10-digit mobile number.' })}
            ${field({ id: 'p-dob', label: 'Date of birth', type: 'date', value: '1976-04-18' })}
            ${field({ id: 'p-gender', label: 'Gender', options: ['Male', 'Female', 'Other', 'Prefer not to say'], value: 'Male' })}
            <div class="field"><label for="p-bar">Bar Council no.</label><input id="p-bar" class="input mono" value="${esc(me.bar)}" disabled><span class="hint">Ask a Super Admin to change this.</span></div>
            ${field({ id: 'p-enrol', label: 'Enrolment date', type: 'date', value: '2001-07-12' })}
            ${field({ id: 'p-exp', label: 'Experience (years)', type: 'number', value: 25, attrs: 'min="0" max="70"' })}
            ${field({ id: 'p-areas', label: 'Practice areas', value: 'Civil, Property, Arbitration, Writs', hint: 'Separate with commas.' })}
            ${field({ id: 'p-addr', label: 'Address', type: 'textarea', value: D.firm.address, full: true, rows: 2 })}
            ${field({ id: 'p-bio', label: 'Short bio', type: 'textarea', full: true, value: 'Senior Advocate practising before the Madras High Court and the City Civil Court, Chennai, since 2001.', hint: 'Up to 400 characters.', attrs: 'maxlength="400"' })}
            ${saveRow('sp')}
          </form></div></section>

        <section class="panel tab-panel" data-panel="office" hidden><div class="panel-head"><div><h3>Office</h3><div class="sub">Printed on invoices, letters and the client portal.</div></div></div>
          <div class="panel-body"><form class="form-grid" novalidate id="so">
            ${field({ id: 'o-name', label: 'Office name', value: D.firm.name, required: true, full: true, err: 'Enter the office name.' })}
            ${field({ id: 'o-phone', label: 'Phone', value: D.firm.phone, required: true, rule: 'phone', err: 'Enter a phone number with area code.' })}
            ${field({ id: 'o-email', label: 'Email', value: D.firm.email, required: true, rule: 'email', err: 'Enter a valid email.' })}
            ${field({ id: 'o-web', label: 'Website', value: 'kumar-associates.demo', placeholder: 'Optional' })}
            ${field({ id: 'o-addr', label: 'Address', value: 'No. 14, Second Line Beach Road, Parrys', full: true })}
            ${field({ id: 'o-city', label: 'City', value: 'Chennai' })}
            ${field({ id: 'o-state', label: 'State', options: ['Tamil Nadu', 'Kerala', 'Karnataka', 'Andhra Pradesh', 'Puducherry'], value: 'Tamil Nadu' })}
            ${field({ id: 'o-pin', label: 'PIN code', value: '600001', rule: 'pincode', err: 'PIN code is 6 digits.' })}
            ${field({ id: 'o-gstin', label: 'GSTIN', value: D.firm.gstin, rule: 'gstin', err: 'GSTIN should look like 33AAKFK4471M1ZQ.', attrs: 'style="font-family:var(--f-mono)"' })}
            ${field({ id: 'o-pan', label: 'PAN', value: D.firm.pan, attrs: 'style="font-family:var(--f-mono)" maxlength="10"' })}
            ${saveRow('so')}
          </form></div></section>

        <section class="panel tab-panel" data-panel="branding" hidden><div class="panel-head"><div><h3>Branding</h3><div class="sub">Used on invoices, letterheads and the client portal.</div></div></div>
          <div class="panel-body stack" style="gap:20px"><div class="pp-tiles">
            ${tile('Logo', 'PNG with transparent background', `<span class="seal">K</span>`)}
            ${tile('Signature', 'Scan on white, 600 x 200 px', `<span class="serif" style="font-size:26px;font-style:italic;color:var(--ink-2)">R. Kumar</span>`)}
            ${tile('Seal', 'Round office seal', `<span>${I('image', 'lg')}<br>No seal uploaded</span>`)}
          </div>
          <div><div class="label" style="margin-bottom:10px">Brand colours</div><div class="row wrap" style="gap:24px">
            <label class="pp-swatch"><input type="color" value="#1A1D24" id="b-c1"><span class="small">Primary<br><span class="mono faint xs" id="b-c1v">#1A1D24</span></span></label>
            <label class="pp-swatch"><input type="color" value="#A3232B" id="b-c2"><span class="small">Accent<br><span class="mono faint xs" id="b-c2v">#A3232B</span></span></label></div></div>
          <div class="row" style="justify-content:flex-end"><button class="btn primary" data-save="branding">Save branding</button></div></div></section>

        <section class="panel tab-panel" data-panel="billing" hidden><div class="panel-head"><div><h3>Billing</h3><div class="sub">Bank and tax details printed on every invoice.</div></div></div>
          <div class="panel-body"><form class="form-grid" novalidate id="sb">
            ${field({ id: 'bl-fav', label: 'Pay in favour of', value: b.favour, required: true, err: 'Enter the account holder name.' })}
            ${field({ id: 'bl-mail', label: 'Remittance email', value: 'accounts@kumar-associates.demo', rule: 'email', err: 'Enter a valid email.' })}
            ${field({ id: 'bl-bank', label: 'Bank name', value: b.name, required: true, err: 'Enter the bank name.' })}
            ${field({ id: 'bl-br', label: 'Branch', value: b.branch })}
            ${field({ id: 'bl-acc', label: 'Account no.', value: b.account, required: true, rule: 'min:9', err: 'Account numbers have at least 9 digits.', attrs: 'inputmode="numeric" style="font-family:var(--f-mono)"' })}
            ${field({ id: 'bl-ifsc', label: 'IFSC', value: b.ifsc, required: true, err: 'IFSC is 11 characters, like HDFC0000032.', attrs: 'maxlength="11" pattern="[A-Z]{4}0[A-Z0-9]{6}" style="font-family:var(--f-mono)"' })}
            ${field({ id: 'bl-micr', label: 'MICR', value: b.micr, attrs: 'style="font-family:var(--f-mono)"' })}
            ${field({ id: 'bl-hsn', label: 'HSN / SAC code', value: b.hsn, attrs: 'style="font-family:var(--f-mono)"' })}
            ${field({ id: 'bl-cat', label: 'Service category', value: b.category })}
            ${field({ id: 'bl-gst', label: 'GST note on invoices', type: 'textarea', full: true, rows: 2, value: 'GST at 18% on legal services. Reverse charge applies where the client is a business entity under Notification 13/2017.' })}
            ${saveRow('sb')}
          </form></div></section>

        <section class="panel tab-panel" data-panel="notifications" hidden><div class="panel-head"><div><h3>Notifications</h3><div class="sub">How PactPro reaches you.</div></div></div>
          <div class="panel-body"><div class="list" style="margin:0 -20px">
            ${[['n-br', 'Browser notifications', 'Hearing alerts and review requests while PactPro is open.', true, false], ['n-em', 'Email', 'Daily hearing digest at 7:00 am and anything needing your review.', true, false], ['n-wa', 'WhatsApp', 'Not available yet. WhatsApp delivery is being set up.', false, true]].map(([id, l, d, on, dis]) => `<div class="list-item"><div class="grow"><b class="small">${l}</b><div class="faint xs">${d}</div></div><label class="switch"><span class="sr-only">${l}</span><input type="checkbox" id="${id}" ${on ? 'checked' : ''} ${dis ? 'disabled' : ''}></label></div>`).join('')}
            <div class="list-item"><div class="grow"><label class="small" for="n-when"><b>Hearing reminder</b></label><div class="faint xs">When to remind you before a listed hearing.</div></div><select class="input" id="n-when" style="width:auto"><option>The evening before, 7:00 pm</option><option selected>Same morning, 7:00 am</option><option>1 hour before</option><option>Both evening and morning</option></select></div>
          </div><div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn primary" data-save="notifications">Save preferences</button></div></div></section>

        <section class="panel tab-panel" data-panel="security" hidden><div class="panel-head"><div><h3>Change password</h3></div></div>
          <div class="panel-body"><form class="stack" novalidate id="ss" style="max-width:440px">
            ${pwField({ id: 'sec-cur', label: 'Current password', autocomplete: 'current-password', err: 'Enter your current password.' })}
            ${pwBlock('sec')}
            <div><button type="button" class="btn primary" id="sec-go" disabled>Change password</button></div></form></div>
          <div class="panel-head" style="border-top:1px solid var(--line);padding-top:16px"><div><h3>Active sessions</h3><div class="sub">Sign out anywhere you don't recognise.</div></div></div>
          <div class="panel-body flush"><div class="list" id="sessions">${[['Chrome on Windows 11', 'Chennai, this device', true], ['Safari on iPhone', 'Chennai, 2 h ago', false], ['Edge on Windows 10', 'Madurai, 3 days ago', false]].map(([d, w, cur], i) => `<div class="list-item" data-s="${i}">${I(cur ? 'board' : 'phone')}<div class="grow"><b class="small">${d}</b><div class="faint xs">${w}</div></div>${cur ? chip('This device', 'info') : `<button class="btn sm" data-signout="${i}">Sign out</button>`}</div>`).join('')}</div></div>
          <div class="panel-body" style="border-top:1px solid var(--line)"><div class="row between"><div><b class="small">2-step verification</b><div class="faint xs">Ask for a code sent to your phone when signing in on a new device.</div></div><label class="switch"><span class="sr-only">2-step verification</span><input type="checkbox" id="sec-2fa"></label></div></div></section>

        <section class="panel tab-panel" data-panel="preferences" hidden><div class="panel-head"><div><h3>Preferences</h3></div></div>
          <div class="panel-body"><form class="stack" novalidate id="spf" style="gap:20px">
            <fieldset style="border:0;padding:0;margin:0"><legend class="label" style="margin-bottom:10px">Theme</legend><div class="pp-radio-cards">
              ${[['light', 'Light', '#F2F3F0', '#FFFFFF'], ['dark', 'Dark', '#13161C', '#1A1E25'], ['system', 'Match device', '#F2F3F0', '#13161C']].map(([v, l, a, b2]) => `<label><span class="sw" aria-hidden="true"><span style="flex:1;background:${a}"></span><span style="flex:1;background:${b2}"></span></span><span class="row"><input type="radio" name="theme" value="${v}" ${(explicit ? explicit === v : v === 'system') ? 'checked' : ''}>${l}</span></label>`).join('')}
            </div><div class="faint xs" style="margin-top:6px" id="th-now">Currently showing ${t} theme.</div></fieldset>
            <div class="form-grid">
              ${field({ id: 'pf-lang', label: 'Language', options: ['English', 'தமிழ் (Tamil)', 'हिन्दी (Hindi)'], value: 'English' })}
              ${field({ id: 'pf-tz', label: 'Time zone', options: ['Asia/Kolkata'], value: 'Asia/Kolkata', hint: 'India Standard Time, UTC+5:30' })}
              ${field({ id: 'pf-cur', label: 'Currency', options: [['INR', 'Indian rupee (₹, INR)']], value: 'INR' })}
              ${field({ id: 'pf-date', label: 'Date format', options: ['DD/MM/YYYY', 'DD-MMM-YYYY', 'YYYY-MM-DD'], value: 'DD/MM/YYYY' })}
              ${field({ id: 'pf-out', label: 'Sign out after inactivity (minutes)', type: 'number', value: 30, required: true, err: 'Enter a number from 5 to 480.', attrs: 'min="5" max="480"', hint: 'Between 5 and 480 minutes.' })}
            </div>
            <div class="row" style="justify-content:flex-end"><button type="button" class="btn primary" data-save="spf">Save preferences</button></div></form></div></section>
      </div></div>`;
  },
  mount(root) {
    wireReveal(root);
    root.querySelector('[data-tabs]').addEventListener('tabchange', e => history.replaceState(null, '', '#/settings?tab=' + e.detail));
    root.querySelector('#av-up').onchange = () => toast('Profile photo updated', 'ok');
    root.querySelectorAll('[data-tile]').forEach(i => i.onchange = () => toast(`${i.dataset.tile} uploaded. It appears on new invoices.`, 'ok'));
    ['b-c1', 'b-c2'].forEach(id => root.querySelector('#' + id).addEventListener('input', e => { root.querySelector('#' + id + 'v').textContent = e.target.value.toUpperCase(); }));
    // Security
    const secBtn = root.querySelector('#sec-go');
    wirePwBlock(root, 'sec', ok => { secBtn.disabled = !ok; });
    secBtn.onclick = () => {
      const f = root.querySelector('#ss'); const cur = root.querySelector('#sec-cur');
      const fld = cur.closest('.field'); const bad = !cur.value; fld.classList.toggle('invalid', bad); if (bad) return cur.focus();
      busy(secBtn, () => { f.reset(); f.querySelectorAll('input').forEach(i => i.dispatchEvent(new Event('input'))); toast('Password changed. Other devices have been signed out.', 'ok'); });
    };
    root.querySelector('#sessions').addEventListener('click', e => { const b = e.target.closest('[data-signout]'); if (!b) return; busy(b, () => { const row = b.closest('.list-item'); toast(`Signed out of ${esc(row.querySelector('b').textContent)}`, 'ok'); row.remove(); }, 500); });
    root.querySelector('#sec-2fa').onchange = e => toast(e.target.checked ? '2-step verification is on. We\'ll text a code to ' + esc(D.me.phone) + '.' : '2-step verification is off', e.target.checked ? 'ok' : 'info');
    // Theme radio cards drive the real theme
    root.querySelectorAll('input[name=theme]').forEach(r => r.addEventListener('change', () => {
      if (r.value === 'system') { delete document.documentElement.dataset.theme; store.set('theme', null); }
      else { document.documentElement.dataset.theme = r.value; store.set('theme', r.value); }
      updateThemeBtn(); root.querySelector('#th-now').textContent = `Currently showing ${effectiveTheme()} theme.`;
    }));
    // Save buttons
    const msgs = { sp: 'Profile saved', so: 'Office details saved', sb: 'Billing details saved. New invoices use them.', branding: 'Branding saved', notifications: 'Notification preferences saved', spf: 'Preferences saved' };
    root.querySelectorAll('[data-save]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.save; const form = root.querySelector('#' + k);
      if (form && !validateForm(form)) return;
      if (k === 'sb') { const ifsc = root.querySelector('#bl-ifsc'); const bad = !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc.value.trim().toUpperCase()); ifsc.closest('.field').classList.toggle('invalid', bad); if (bad) return ifsc.focus(); }
      if (k === 'spf') { const o = root.querySelector('#pf-out'); const v = +o.value; const bad = !(v >= 5 && v <= 480); o.closest('.field').classList.toggle('invalid', bad); o.setAttribute('aria-invalid', bad); if (bad) return o.focus(); }
      busy(b, () => toast(msgs[k], 'ok'));
    }));
  },
});

/* ==========================================================================
   7. /users
   ========================================================================== */
const ROLE_NAMES = () => D.roles.filter(r => r.name !== 'Client').map(r => r.name);
function userForm(u) {
  const isNew = !u; u = u || { role: 'Junior Advocate' };
  modal({
    title: isNew ? 'Add user' : 'Edit user', sub: isNew ? 'They get an email with this password and must change it on first sign in.' : esc(u.email), size: 'wide',
    body: `<form class="form-grid" novalidate id="uf2">
      ${field({ id: 'us-name', label: 'Full name', value: u.name, required: true, err: 'Enter the person\'s name.' })}
      ${field({ id: 'us-email', label: 'Work email', type: 'email', value: u.email, required: true, rule: 'email', err: 'Enter a valid email, like name@kumar-associates.demo.', attrs: isNew ? '' : 'disabled' })}
      ${field({ id: 'us-phone', label: 'Phone', type: 'tel', value: u.phone, required: true, rule: 'phone', err: 'Enter a 10-digit mobile number.' })}
      ${field({ id: 'us-bar', label: 'Bar Council no.', value: u.bar === '—' ? '' : u.bar, placeholder: 'MS/0000/2026, advocates only' })}
      <div class="full"><div class="label" style="margin-bottom:8px" id="us-role-l">Role</div><div class="row wrap" role="radiogroup" aria-labelledby="us-role-l" id="us-role">${ROLE_NAMES().map(r => `<button type="button" class="filter-chip" role="radio" aria-checked="${r === u.role}" aria-pressed="${r === u.role}" data-r="${esc(r)}">${esc(r)}</button>`).join('')}</div></div>
      ${field({ id: 'us-rep', label: 'Reports to', options: D.advocates.filter(a => a.id !== u.id && a.role.includes('Advocate')).map(a => [a.id, a.name]), value: u.reportsTo || '', placeholder: 'Nobody (heads a team)' })}
      ${isNew ? field({ id: 'us-pw', label: 'Initial password', type: 'text', required: true, rule: 'min:8', value: '', err: 'Use at least 8 characters.', hint: 'At least 8 characters. Share it with them privately.' }) : ''}
    </form>`,
    foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="us-save">${isNew ? 'Add user' : 'Save changes'}</button>`,
    onMount(el, close) {
      let role = u.role;
      el.querySelector('#us-role').addEventListener('click', e => { const b = e.target.closest('[data-r]'); if (!b) return; role = b.dataset.r; el.querySelectorAll('#us-role [data-r]').forEach(x => { x.setAttribute('aria-pressed', x === b); x.setAttribute('aria-checked', x === b); }); });
      el.querySelector('#us-save').onclick = (e) => {
        if (!validateForm(el.querySelector('#uf2'))) return;
        busy(e.currentTarget, () => {
          const v = (id) => el.querySelector('#' + id).value.trim();
          const data = { name: v('us-name'), phone: v('us-phone'), bar: v('us-bar') || '—', role, reportsTo: +v('us-rep') || null };
          if (isNew) { data.email = v('us-email'); D.advocates.push({ id: Math.max(...D.advocates.map(a => a.id)) + 1, since: String(TODAY.getFullYear()), ...data }); }
          else Object.assign(u, data);
          close(); toast(isNew ? `Added ${esc(data.name)} as ${esc(role)}. Invitation emailed.` : `Saved ${esc(data.name)}`, 'ok'); router();
        });
      };
    },
  });
}
page('/users', {
  title: 'Users', crumbs: [['Firm', '/users']], perm: 'USER_MANAGE', skeleton: 'table',
  render: () => `${pageHead('Users', 'Everyone who signs in to PactPro for ' + esc(D.firm.name) + '. Clients are managed from their client page.', `<button class="btn primary" id="u-add">${I('plus', 'sm')}Add user</button>`)}<div id="u-tbl"></div>`,
  mount(root) {
    root.querySelector('#u-add').onclick = () => userForm();
    DataTable(root.querySelector('#u-tbl'), {
      rowsFn: () => D.advocates,
      search: { placeholder: 'Search name, email or phone', keys: ['name', 'email', 'phone'] },
      filters: [{ key: 'role', label: 'Role', options: ROLE_NAMES() }, { key: 'st', label: 'Status', options: ['Active', 'Left'], test: (r, v) => (r.left ? 'Left' : 'Active') === v }],
      columns: [
        { key: 'name', label: 'User', sort: true, render: r => `<div class="row" style="gap:10px">${avatar(r.name)}<div><div class="cell-title">${esc(r.name)}${r.id === D.me.id ? ' <span class="faint xs">(you)</span>' : ''}</div><div class="cell-sub">${esc(r.email)}</div></div></div>` },
        { key: 'role', label: 'Role', sort: true, render: r => chip(r.role, r.role === 'Super Admin' ? 'tape' : 'plain') },
        { key: 'reportsTo', label: 'Reports to', hideSm: true, render: r => r.reportsTo ? esc(advById(r.reportsTo).name) : '<span class="faint">—</span>' },
        { key: 'bar', label: 'Bar Council no.', hideSm: true, render: r => `<span class="mono">${esc(r.bar)}</span>` },
        { key: 'phone', label: 'Phone', hideSm: true, render: r => `<span class="num nowrap">${esc(r.phone)}</span>` },
        { key: 'st', label: 'Status', render: r => r.left ? chip('Left', '') : chip('Active', 'ok') },
        { key: 'act', label: '<span class="sr-only">Actions</span>', cls: 'actions', render: r => `<button class="btn ghost sm icon" data-pop data-menu="${r.id}" aria-label="Actions for ${esc(r.name)}" aria-haspopup="menu">${I('more', 'sm')}</button>` },
      ],
    });
    root.querySelector('#u-tbl').addEventListener('click', e => {
      const b = e.target.closest('[data-menu]'); if (!b) return; const u = advById(b.dataset.menu);
      popMenu(b, [
        { label: 'Edit', icon: 'edit', onClick: () => userForm(u) },
        { label: 'Reset password', icon: 'key', onClick: () => confirmDialog({ title: 'Reset password?', text: `${esc(u.name)} will get an email at <b>${esc(u.email)}</b> with a link to set a new password. Their current sessions end.`, confirm: 'Send reset email', onConfirm: () => toast(`Reset email sent to ${esc(u.email)}`, 'ok') }) },
        '-',
        u.left ? { label: 'Restore access', icon: 'restore', onClick: () => { u.left = false; toast(`${esc(u.name)} can sign in again`, 'ok'); router(); } }
          : { label: 'Remove from practice', icon: 'trash', danger: true, onClick: () => u.id === D.me.id ? toast('You can\'t remove yourself. Ask another Super Admin.', 'warn') : confirmDialog({ title: `Remove ${esc(u.name)}?`, text: 'They can no longer sign in. Their cases, tasks and history stay in PactPro and can be reassigned.', confirm: 'Remove from practice', danger: true, onConfirm: () => { u.left = true; toast(`${esc(u.name)} removed from the practice`, 'ok'); router(); } }) },
      ]);
    });
  },
});

/* ==========================================================================
   8. /roles
   ========================================================================== */
const PERM_VERB = { VIEW: 'View', CREATE: 'Create', EDIT: 'Edit', DELETE: 'Delete', UPLOAD: 'Upload', ASSIGN: 'Assign', EXPORT: 'Export', MANAGE: 'Manage' };
const PERM_NOUN = { CASE: 'cases', CLIENT: 'clients', EVENT: 'hearings and events', DOCUMENT: 'documents', INVOICE: 'invoices', PAYMENT: 'payments', EXPENSE: 'expenses', TASK: 'tasks', DRAFT: 'drafts', REPORT: 'reports', USER: 'users', ROLE: 'roles', BACKUP: 'backups' };
const PERM_SPECIAL = { CASE_ALERTS: 'Get appeal alerts', AUDIT_VIEW: 'View system activity', SETTINGS_EDIT: 'Edit firm settings', DRAFT_MANAGE: 'Manage templates and playbooks', PAYMENT_CREATE: 'Record payments', DOCUMENT_UPLOAD: 'Upload documents', TASK_ASSIGN: 'Assign tasks to others' };
const permLabel = (p) => PERM_SPECIAL[p] || ((PERM_VERB[p.split('_')[1]] || p) + ' ' + (PERM_NOUN[p.split('_')[0]] || p.toLowerCase()));
function roleEditor(role) {
  const isNew = !role; const current = new Set(isNew ? ['CASE_VIEW'] : (D.rolePerms[role.name] || []));
  const locked = role && role.name === 'Super Admin';
  modal({
    title: isNew ? 'Create role' : `Edit ${esc(role.name)}`, sub: locked ? 'Super Admin always has every permission.' : 'Tick what people with this role can do.', size: 'xwide',
    body: `<form novalidate id="rf2" class="stack" style="gap:16px"><div class="form-grid">
      ${field({ id: 'ro-name', label: 'Role name', value: role ? role.name : '', required: true, err: 'Give the role a name.', attrs: locked ? 'disabled' : '' })}
      ${field({ id: 'ro-desc', label: 'Description', value: role ? role.desc : '', placeholder: 'What this role is for' })}</div>
      <div class="table-wrap"><table class="t pp-matrix"><thead><tr><th scope="col" style="width:200px">Module</th><th scope="col">Permissions</th></tr></thead><tbody>
      ${Object.entries(D.permissionModules).map(([mod, ps]) => `<tr data-mod="${mod}"><th scope="row" style="position:static;background:none;border-bottom:1px solid var(--line)"><div style="color:var(--ink);font-weight:600">${mod}</div><label class="check xs" style="margin-top:6px"><input type="checkbox" data-all="${mod}" ${locked ? 'disabled' : ''}> Select all in module</label></th>
        <td><div class="perms">${ps.map(p => `<label class="check" title="${p}"><input type="checkbox" value="${p}" ${current.has(p) || locked ? 'checked' : ''} ${locked ? 'disabled' : ''}> ${permLabel(p)}</label>`).join('')}</div></td></tr>`).join('')}
      </tbody></table></div><div class="faint xs" id="ro-count" aria-live="polite"></div></form>`,
    foot: `<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="ro-save" ${locked ? 'disabled' : ''}>${isNew ? 'Create role' : 'Save role'}</button>`,
    onMount(el, close) {
      const sync = () => {
        el.querySelectorAll('tr[data-mod]').forEach(tr => { const bs = [...tr.querySelectorAll('input[value]')]; const n = bs.filter(b => b.checked).length; const all = tr.querySelector('[data-all]'); all.checked = n === bs.length; all.indeterminate = n > 0 && n < bs.length; });
        el.querySelector('#ro-count').textContent = el.querySelectorAll('input[value]:checked').length + ' permissions selected';
      };
      el.addEventListener('change', e => { if (e.target.dataset.all) e.target.closest('tr').querySelectorAll('input[value]').forEach(b => { b.checked = e.target.checked; }); sync(); });
      sync();
      el.querySelector('#ro-save').onclick = (e) => {
        if (!validateForm(el.querySelector('#rf2'))) return;
        busy(e.currentTarget, () => {
          const name = el.querySelector('#ro-name').value.trim(); const perms = [...el.querySelectorAll('input[value]:checked')].map(b => b.value);
          if (isNew) { D.roles.push({ id: Math.max(...D.roles.map(r => r.id)) + 1, name, desc: el.querySelector('#ro-desc').value.trim() || 'Custom role', users: 0 }); }
          else { if (name !== role.name) { D.rolePerms[name] = D.rolePerms[role.name]; delete D.rolePerms[role.name]; } role.name = name; role.desc = el.querySelector('#ro-desc').value.trim(); }
          D.rolePerms[name] = perms;
          close(); toast(`${esc(name)} saved with ${perms.length} permissions`, 'ok'); refreshNav(); router();
        });
      };
    },
  });
}
page('/roles', {
  title: 'Roles', crumbs: [['Firm', '/users']], perm: 'ROLE_MANAGE', skeleton: 'cards',
  render: () => `${pageHead('Roles and permissions', 'A role decides what its people can see and change. Edit a role and everyone in it is updated at once.', `<button class="btn primary" id="ro-add">${I('plus', 'sm')}Create role</button>`)}
    <div class="pp-role-grid">${D.roles.map(r => { const n = r.name === 'Super Admin' ? Object.values(D.permissionModules).flat().length : (D.rolePerms[r.name] || []).length; return `<article class="panel pp-role"><div class="row between"><h3>${esc(r.name)}</h3>${r.name === 'Super Admin' ? chip('System', 'tape') : ''}</div>
      <p class="muted small grow">${esc(r.desc)}</p>
      <div class="row small muted" style="gap:16px"><span class="row" style="gap:5px">${I('users', 'sm')}${r.users} ${r.users === 1 ? 'user' : 'users'}</span><span class="row" style="gap:5px">${I('key', 'sm')}${n} permissions</span></div>
      <div class="row" style="border-top:1px solid var(--line);padding-top:12px;margin-top:2px"><button class="btn sm" data-edit="${r.id}">${I('edit', 'sm')}Edit</button><span class="grow"></span><button class="btn ghost sm danger" data-del="${r.id}" aria-label="Delete ${esc(r.name)}">${I('trash', 'sm')}Delete</button></div></article>`; }).join('')}</div>`,
  mount(root) {
    root.querySelector('#ro-add').onclick = () => roleEditor();
    root.addEventListener('click', e => {
      const ed = e.target.closest('[data-edit]'); if (ed) return roleEditor(D.roles.find(r => r.id === +ed.dataset.edit));
      const dl = e.target.closest('[data-del]'); if (!dl) return; const r = D.roles.find(x => x.id === +dl.dataset.del);
      if (r.name === 'Super Admin') return modal({ title: 'Super Admin can\'t be deleted', size: 'narrow', body: '<p class="muted">Every practice needs at least one role that can manage users, roles and backups. You can move people out of Super Admin, but the role itself stays.</p>', foot: '<button class="btn primary" data-close>OK</button>' });
      confirmDialog({ title: `Delete ${esc(r.name)}?`, text: r.users ? `${r.users} ${r.users === 1 ? 'person has' : 'people have'} this role. They lose access until you give them another role.` : 'Nobody has this role. This can\'t be undone.', confirm: 'Delete role', danger: true, onConfirm: () => { D.roles.splice(D.roles.indexOf(r), 1); delete D.rolePerms[r.name]; toast(`${esc(r.name)} deleted`, 'ok'); router(); } });
    });
  },
});

/* ==========================================================================
   9. /activity
   ========================================================================== */
const METHOD = (a) => /CREATED|UPLOADED|RECEIVED|GENERATED|LOGIN/.test(a) ? 'POST' : /DELETED/.test(a) ? 'DELETE' : 'PUT';
page('/activity', {
  title: 'System activity', crumbs: [['Firm', '/users']], perm: 'AUDIT_VIEW', skeleton: 'table',
  render: () => `${pageHead('System activity', 'Every change made in PactPro, who made it and from where. Kept for 7 years.')}<div id="a-tbl"></div>`,
  mount(root) {
    let range = 'all';
    const inRange = (r) => range === 'all' ? true : range === 'today' ? daysFrom(r.at) === 0 : daysFrom(r.at) > -(+range);
    const tbl = DataTable(root.querySelector('#a-tbl'), {
      rowsFn: () => D.activity.filter(inRange),
      search: { placeholder: 'Search user, action or detail', keys: ['user', 'action', 'title'] },
      filters: [{ key: 'module', label: 'Module', options: [...new Set(D.activity.map(a => a.module))].sort() }, { key: 'action', label: 'Action', options: [...new Set(D.activity.map(a => a.action))].sort() }, { key: 'status', label: 'Status', options: ['Success', 'Failed'] }],
      toolbarExtra: `<div class="seg" data-seg id="a-range" aria-label="Date range"><button data-v="all" aria-pressed="true">All</button><button data-v="today">Today</button><button data-v="7">7 days</button><button data-v="30">30 days</button></div><button class="btn sm" data-pop id="a-exp" aria-haspopup="menu">${I('download', 'sm')}Export</button>`,
      initialSort: { key: 'at', dir: 'desc' },
      columns: [
        { key: 'at', label: 'Time', sort: r => +r.at, render: r => `<span class="nowrap small">${fdt(r.at)}</span>` },
        { key: 'user', label: 'User', sort: true, render: r => r.user === 'unknown' ? '<span class="faint">Unknown</span>' : `<div class="row" style="gap:8px">${avatar(r.user, 'sm')}<span class="nowrap">${esc(r.user)}</span></div>` },
        { key: 'action', label: 'Action', render: r => `<span class="mono xs">${esc(r.action)}</span>` },
        { key: 'module', label: 'Module', hideSm: true },
        { key: 'title', label: 'Detail', hideSm: true, render: r => `<span class="small">${esc(r.title)}</span>` },
        { key: 'status', label: 'Status', render: r => chip(r.status) },
      ],
      onRow: (r) => drawer({
        title: 'Event details', sub: `<span class="mono">#${r.id}</span>, ${fdt(r.at)}`,
        body: `<div class="stack" style="gap:22px">
          <section><h4 style="margin-bottom:8px">Basic info</h4><dl class="kv"><dt>Action</dt><dd class="mono">${esc(r.action)}</dd><dt>Module</dt><dd>${esc(r.module)}</dd><dt>Detail</dt><dd>${esc(r.title)}</dd><dt>Status</dt><dd>${chip(r.status)}</dd></dl></section>
          <section><h4 style="margin-bottom:8px">User</h4><dl class="kv"><dt>Name</dt><dd>${esc(r.user === 'unknown' ? 'Not signed in' : r.user)}</dd><dt>Role</dt><dd>${esc((D.advocates.find(a => a.name === r.user) || {}).role || '—')}</dd><dt>Email</dt><dd>${esc((D.advocates.find(a => a.name === r.user) || {}).email || '—')}</dd></dl></section>
          <section><h4 style="margin-bottom:8px">Request</h4><dl class="kv"><dt>Method</dt><dd class="mono">${METHOD(r.action)}</dd><dt>URI</dt><dd class="mono" style="word-break:break-all">${r.module === 'Auth' ? '/api/auth/login' : '/api/' + r.module.toLowerCase() + (METHOD(r.action) === 'POST' ? '' : '/' + (r.id % 97))}</dd><dt>Response</dt><dd class="mono">${r.status === 'Failed' ? '401 Unauthorized' : METHOD(r.action) === 'POST' ? '201 Created' : '200 OK'}</dd></dl></section>
          <section><h4 style="margin-bottom:8px">Device</h4><dl class="kv"><dt>IP address</dt><dd class="mono">${esc(r.ip)}</dd><dt>Browser</dt><dd>${esc(r.browser)}</dd><dt>Operating system</dt><dd>${esc(r.os)}</dd></dl></section>
          ${r.change ? `<section><h4 style="margin-bottom:8px">What changed</h4><div class="table-wrap"><table class="t"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody><tr><td>${esc(r.change.field)}</td><td><span style="color:var(--bad);text-decoration:line-through">${esc(r.change.from)}</span></td><td><span style="color:var(--ok)">${esc(r.change.to)}</span></td></tr></tbody></table></div></section>` : ''}
        </div>`,
        foot: '<button class="btn primary" data-close>Done</button>',
      }),
    });
    const tEl = root.querySelector('#a-tbl'); wireCommon(tEl);
    tEl.querySelector('#a-range').addEventListener('segchange', e => { range = e.detail; tbl.state.page = 1; tbl.refresh(); });
    tEl.querySelector('#a-exp').onclick = (e) => popMenu(e.currentTarget, ['CSV', 'Excel', 'PDF'].map(f => ({ label: f, icon: 'file', onClick: () => toast(`Exporting system activity as ${f}. The download starts in a moment.`, 'info') })));
  },
});

/* ==========================================================================
   10. /backup
   ========================================================================== */
const BK_TYPES = [['Full', 'Everything: database, documents, reports and settings.', ['Database', 'Documents', 'Reports', 'Settings'], '≈ 415 MB'], ['Database', 'Cases, clients, billing and history. Fast.', ['Database'], '≈ 38 MB'], ['Documents', 'Uploaded files and generated drafts.', ['Documents'], '≈ 370 MB'], ['Settings', 'Firm details, roles and preferences.', ['Settings'], '≈ 120 KB']];
let bkSchedule = 'Daily at 2:00 am';
function runBackup(type) {
  const [name, , secs, size] = BK_TYPES.find(t => t[0] === type);
  modal({
    title: `Creating ${name === 'Full' ? 'a full' : name.toLowerCase() + ' only'} backup`, sub: 'You can keep working. Closing this window doesn\'t stop the backup.', size: 'narrow',
    body: `<div class="pp-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Backup progress"><i id="bk-bar"></i></div>
      <div class="row between xs faint" style="margin-top:6px"><span id="bk-step" aria-live="polite">Preparing…</span><span id="bk-pc" class="num">0%</span></div>
      <div class="pp-steps">${secs.map((s, i) => `<div data-i="${i}">${I('clock', 'sm')}<span class="grow">${s}</span><span class="xs num"></span></div>`).join('')}</div>`,
    foot: '<button class="btn ghost" data-close>Run in background</button>',
    onMount(el, close) {
      let p = 0; const per = 100 / secs.length; const started = Date.now();
      const iv = setInterval(() => {
        if (!document.body.contains(el)) { clearInterval(iv); }
        p = Math.min(100, p + 4 + Math.random() * 6);
        const idx = Math.min(secs.length - 1, Math.floor(p / per));
        el.querySelectorAll('.pp-steps > div').forEach((d, i) => { const done = p >= 100 || i < idx; d.className = done ? 'done' : i === idx ? 'on' : ''; d.querySelector('svg').outerHTML = I(done ? 'ok' : i === idx ? 'refresh' : 'clock', 'sm'); if (done && !d.dataset.t) { d.dataset.t = 1; d.querySelector('.num').textContent = Math.max(1, Math.round((Date.now() - started) / 400)) + 's'; } });
        el.querySelector('#bk-bar').style.width = p + '%'; el.querySelector('[role=progressbar]').setAttribute('aria-valuenow', Math.round(p));
        el.querySelector('#bk-pc').textContent = Math.round(p) + '%'; el.querySelector('#bk-step').textContent = p >= 100 ? 'Finishing up' : 'Backing up ' + secs[idx].toLowerCase();
        if (p >= 100) {
          clearInterval(iv);
          D.backups.unshift({ id: Math.max(...D.backups.map(b => b.id)) + 1, at: new Date(), type: name, size: size.replace('≈ ', ''), dur: Math.round((Date.now() - started) / 1000) + 's', health: 100, status: 'Completed', sections: secs.map(s => [s, 'Completed', '—']) });
          setTimeout(() => { close(); toast(`${name} backup completed (${size.replace('≈ ', '')})`, 'ok'); if (currentPath() === '/backup') router(); }, 500);
        }
      }, 260);
    },
  });
}
page('/backup', {
  title: 'Backup', crumbs: [['Firm', '/users']], perm: 'BACKUP_MANAGE', skeleton: 'table',
  render() {
    const last = D.backups[0];
    return `${pageHead('Backup and restore', 'Backups are encrypted and kept for 90 days. Restore replaces current data, so take a fresh backup first.')}
    <div class="figures" style="margin-bottom:24px">
      <div class="figure"><div class="lbl">Latest backup</div><div class="val" style="font-size:var(--t-2xl)">${ago(last.at)}</div><div class="meta">${esc(last.type)}, ${esc(last.size)}, ${chip(last.status === 'Completed' ? 'Completed' : last.status, last.status === 'Completed' ? 'ok' : 'warn')}</div></div>
      <div class="figure"><div class="lbl">Storage used</div><div class="val">1.2<small>GB of 10 GB</small></div><div class="meter" style="margin-top:8px"><i style="width:12%;background:var(--ink)"></i></div></div>
      <div class="figure"><div class="lbl">Schedule</div><div class="val" style="font-size:var(--t-xl)" id="bk-sched">${esc(bkSchedule)}</div><div class="meta"><button class="link xs" style="border:0;background:none;padding:0" id="bk-edit">Change schedule</button></div></div>
    </div>
    <div class="section-title" style="margin-top:0"><h2>Create a backup</h2></div>
    <div class="pp-type-cards">${BK_TYPES.map(([n, d, , s]) => `<button data-bk="${n}">${I(n === 'Full' ? 'archive' : n === 'Database' ? 'database' : n === 'Documents' ? 'folder' : 'cog')}<b>${n === 'Full' ? 'Full backup' : n + ' only'}</b><span class="small muted">${d}</span><span class="faint xs num">${s}</span></button>`).join('')}</div>
    <div class="section-title"><h2>Restore from a backup</h2></div>
    <div class="panel"><div class="panel-body stack">
      <label class="dropzone" id="rs-drop" for="rs-file">${I('upload', 'lg')}<div style="margin-top:8px"><b>Drop a backup .zip here</b> or <span class="link">browse</span></div><div class="faint xs" style="margin-top:4px" id="rs-name">PactPro backup files only, up to 2 GB</div><input type="file" id="rs-file" accept=".zip" class="sr-only"></label>
      <div class="row wrap"><button class="btn" id="rs-val">${I('shield', 'sm')}Validate</button><span class="faint xs">Checks the file before anything is changed.</span></div>
      <div id="rs-out" aria-live="polite"></div></div></div>
    <div class="section-title"><h2>History</h2></div><div id="bk-tbl"></div>`;
  },
  mount(root) {
    root.querySelectorAll('[data-bk]').forEach(b => b.onclick = () => runBackup(b.dataset.bk));
    root.querySelector('#bk-edit').onclick = () => modal({
      title: 'Backup schedule', size: 'narrow',
      body: `<form class="stack" id="bsf">${field({ id: 'bs-f', label: 'How often', options: ['Daily', 'Weekly on Sunday', 'Off'], value: 'Daily' })}${field({ id: 'bs-t', label: 'Time', type: 'time', value: '02:00', hint: 'Pick a time when nobody is working.' })}${field({ id: 'bs-k', label: 'What to back up', options: ['Full', 'Database only'], value: 'Full' })}</form>`,
      foot: '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="bs-save">Save schedule</button>',
      onMount(el, close) { el.querySelector('#bs-save').onclick = (e) => busy(e.currentTarget, () => { const f = el.querySelector('#bs-f').value; const [h, m] = el.querySelector('#bs-t').value.split(':'); const tm = new Date(2000, 0, 1, +h, +m).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); bkSchedule = f === 'Off' ? 'Off' : `${f} at ${tm}`; close(); root.querySelector('#bk-sched').textContent = bkSchedule; toast('Backup schedule saved', 'ok'); }); },
    });
    // Restore
    let file = null; const drop = root.querySelector('#rs-drop');
    const pick = (f) => { if (!f) return; if (!/\.zip$/i.test(f.name)) { toast('That isn\'t a .zip file. Choose a PactPro backup file.', 'bad'); return; } file = f; root.querySelector('#rs-name').innerHTML = `<b class="mono">${esc(f.name)}</b>, ${sizeFmt(Math.max(1, Math.round(f.size / 1024)))}`; root.querySelector('#rs-out').innerHTML = ''; };
    root.querySelector('#rs-file').onchange = e => pick(e.target.files[0]);
    ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => pick(e.dataTransfer.files[0]));
    root.querySelector('#rs-val').onclick = (e) => {
      if (!file) { file = { name: 'pactpro-backup-' + TODAY.toISOString().slice(0, 10) + '.zip', size: 412 * 1024 * 1024 }; root.querySelector('#rs-name').innerHTML = `<b class="mono">${esc(file.name)}</b>, 412 MB (sample)`; }
      busy(e.currentTarget, () => {
        root.querySelector('#rs-out').innerHTML = `<div class="callout ok">${I('ok')}<div class="grow"><b>Backup is readable. Health 96%.</b><div class="small muted" style="margin-top:2px">Created ${fdt(day(0, 2, 0))}. 3 thumbnails are missing and will be regenerated.</div>
          <div class="table-wrap" style="margin-top:10px"><table class="t"><thead><tr><th>Section</th><th>Items</th><th>Check</th></tr></thead><tbody>
          ${[['Database', '28 cases, 16 clients, 14 invoices', 'Success'], ['Documents', '32 files, 3 thumbnails missing', 'Partial'], ['Reports', '6 saved reports', 'Success'], ['Settings', 'Firm, roles, preferences', 'Success']].map(([s, n, st]) => `<tr><td>${s}</td><td class="small">${n}</td><td>${chip(st)}</td></tr>`).join('')}</tbody></table></div>
          <div class="row" style="margin-top:12px"><button class="btn danger solid" id="rs-go">${I('restore', 'sm')}Restore this backup</button></div></div></div>`;
        root.querySelector('#rs-go').onclick = () => confirmDialog({ title: 'Restore this backup?', text: `Everything in PactPro is replaced with the data in <b class="mono">${esc(file.name)}</b>. Changes made after it was created are lost. Everyone is signed out while it runs.`, confirm: 'Restore', danger: true, typeToConfirm: 'RESTORE', onConfirm: () => toast('Restore started. Everyone will be signed out for about 4 minutes.', 'warn', { ms: 7000 }) });
      }, 1100);
    };
    DataTable(root.querySelector('#bk-tbl'), {
      rowsFn: () => D.backups, initialSort: { key: 'at', dir: 'desc' },
      columns: [
        { key: 'at', label: 'Created', sort: r => +r.at, render: r => `<span class="nowrap">${fdt(r.at)}</span>` },
        { key: 'type', label: 'Type', sort: true },
        { key: 'size', label: 'Size', cls: 'amt' },
        { key: 'dur', label: 'Took', hideSm: true, cls: 'num' },
        { key: 'health', label: 'Health', hideSm: true, render: r => `<span class="num" style="color:${r.health < 95 ? 'var(--warn)' : 'var(--ink)'}">${r.health}%</span>` },
        { key: 'status', label: 'Status', render: r => chip(r.status, r.status === 'Partial' ? 'warn' : 'ok') },
        { key: 'act', label: '<span class="sr-only">Actions</span>', cls: 'actions', render: r => `<button class="btn ghost sm icon" data-dl="${r.id}" aria-label="Download backup">${I('download', 'sm')}</button><button class="btn ghost sm icon" data-rm="${r.id}" aria-label="Delete backup">${I('trash', 'sm')}</button>` },
      ],
      onRow: (r) => drawer({
        title: `${esc(r.type)} backup`, sub: fdt(r.at),
        body: `<dl class="kv" style="margin-bottom:20px"><dt>Size</dt><dd>${esc(r.size)}</dd><dt>Took</dt><dd>${esc(r.dur)}</dd><dt>Health</dt><dd>${r.health}%</dd><dt>Status</dt><dd>${chip(r.status, r.status === 'Partial' ? 'warn' : 'ok')}</dd></dl>
          <h4 style="margin-bottom:8px">Sections</h4><div class="table-wrap"><table class="t"><thead><tr><th>Section</th><th>Status</th><th class="right">Time</th></tr></thead><tbody>${r.sections.map(([s, st, t]) => `<tr><td>${s}</td><td>${chip(st)}</td><td class="right num">${t}</td></tr>`).join('')}</tbody></table></div>
          ${r.status === 'Partial' ? `<div class="callout warn" style="margin-top:16px">${I('alert')}<div>Documents failed because the storage disk was busy. Run a documents-only backup to fill the gap.</div></div>` : ''}`,
        foot: `<button class="btn" onclick="toast('Download started')">${I('download', 'sm')}Download</button><button class="btn primary" data-close>Done</button>`,
      }),
    });
    root.querySelector('#bk-tbl').addEventListener('click', e => {
      const d = e.target.closest('[data-dl]'); if (d) return toast('Download started', 'ok');
      const x = e.target.closest('[data-rm]'); if (!x) return; const b = D.backups.find(k => k.id === +x.dataset.rm);
      confirmDialog({ title: 'Delete this backup?', text: `The ${esc(b.type.toLowerCase())} backup from ${fdt(b.at)} is removed for good.`, confirm: 'Delete backup', danger: true, onConfirm: () => { D.backups.splice(D.backups.indexOf(b), 1); toast('Backup deleted', 'ok'); router(); } });
    });
  },
});

/* ==========================================================================
   11. /notifications (delivery log)
   ========================================================================== */
const EVENT_LABEL = (k) => ({ HEARING_REMINDER: 'Hearing reminder', TASK_SUBMITTED: 'Task submitted', PAYMENT_RECEIVED: 'Payment received', OVERDUE_PAYMENT_REMINDER: 'Overdue payment reminder', INVOICE_GENERATED: 'Invoice generated', HEARING_SCHEDULED: 'Hearing scheduled', CLIENT_REGISTERED: 'Client registered', HEARING_RESCHEDULED: 'Hearing rescheduled', TASK_ASSIGNED: 'Task assigned', CASE_CREATED: 'Case created', PASSWORD_RESET: 'Password reset' }[k] || k.toLowerCase().replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()));
const msgBody = (r) => `Dear ${r.name},\n\n${r.subject}.\n\n${r.kind === 'HEARING_REMINDER' ? 'Please be present in Court No. VI, City Civil Court, Chennai by 10:15 am. Item 14 on today\'s list.' : r.kind === 'PASSWORD_RESET' ? 'Your verification code is 482 913. It expires in 10 minutes. If you didn\'t ask for this, ignore this email.' : 'You can see the details in PactPro.'}\n\nRegards,\n${D.firm.name}\n${D.firm.phone}`;
let autoEmail = true;
page('/notifications', {
  title: 'Notifications', crumbs: [['Firm', '/users']], perm: 'SETTINGS_EDIT', skeleton: 'table',
  render() {
    const today = D.deliveryLog.filter(r => daysFrom(r.at) === 0);
    return `${pageHead('Notifications', 'Every email and in-app message PactPro sent for the practice, and whether it arrived.', `<label class="switch"><input type="checkbox" id="n-auto" ${autoEmail ? 'checked' : ''}> Automatic email notifications</label>`)}
    <div class="figures" style="margin-bottom:20px">
      <div class="figure"><div class="lbl">Sent today</div><div class="val">${today.filter(r => r.status === 'Sent').length}</div></div>
      <div class="figure"><div class="lbl">Emails today</div><div class="val">${today.filter(r => r.channel === 'Email').length}</div></div>
      <div class="figure"><div class="lbl">Failed</div><div class="val" style="color:var(--bad)" id="n-failed">${D.deliveryLog.filter(r => r.status === 'Failed').length}</div><div class="meta">Last 7 days</div></div>
      <div class="figure"><div class="lbl">Pending</div><div class="val">${D.deliveryLog.filter(r => r.status === 'Pending').length}</div></div>
    </div><div id="n-tbl"></div>`;
  },
  mount(root) {
    root.querySelector('#n-auto').onchange = e => { autoEmail = e.target.checked; toast(autoEmail ? 'Automatic emails are on' : 'Automatic emails are off. Clients won\'t get hearing reminders.', autoEmail ? 'ok' : 'warn'); };
    const tbl = DataTable(root.querySelector('#n-tbl'), {
      rowsFn: () => D.deliveryLog, initialSort: { key: 'at', dir: 'desc' },
      search: { placeholder: 'Search recipient or subject', keys: ['name', 'to', 'subject'] },
      filters: [{ key: 'channel', label: 'Channel', options: ['Email', 'In-App', 'WhatsApp'] }, { key: 'status', label: 'Status', options: ['Sent', 'Failed', 'Pending'] }, { key: 'kind', label: 'Event type', options: [...new Set(D.deliveryLog.map(r => EVENT_LABEL(r.kind)))], test: (r, v) => EVENT_LABEL(r.kind) === v }],
      columns: [
        { key: 'kind', label: 'Event', sort: r => EVENT_LABEL(r.kind), render: r => `<span class="nowrap">${EVENT_LABEL(r.kind)}</span>` },
        { key: 'channel', label: 'Channel', hideSm: true },
        { key: 'name', label: 'Recipient', sort: true, render: r => `<div class="cell-title">${esc(r.name)}</div><div class="cell-sub">${esc(r.to)}</div>` },
        { key: 'subject', label: 'Subject', hideSm: true, render: r => `<span class="small">${esc(r.subject)}</span>` },
        { key: 'at', label: 'Sent', sort: r => +r.at, render: r => `<span class="nowrap small">${fdt(r.at)}</span>` },
        { key: 'status', label: 'Status', render: r => chip(r.status) },
        { key: 'act', label: '<span class="sr-only">Actions</span>', cls: 'actions', render: r => `<button class="btn ghost sm" data-view="${r.id}">View</button>${r.status === 'Failed' ? `<button class="btn sm" data-resend="${r.id}">${I('refresh', 'sm')}Resend</button>` : ''}` },
      ],
    });
    root.querySelector('#n-tbl').addEventListener('click', e => {
      const v = e.target.closest('[data-view]');
      if (v) { const r = D.deliveryLog.find(x => x.id === +v.dataset.view); return modal({ title: esc(r.subject), sub: `${EVENT_LABEL(r.kind)} by ${esc(r.channel)} to ${esc(r.to)}, ${fdt(r.at)}`, body: `<div class="panel tinted"><div class="panel-body pp-msg-body small">${esc(msgBody(r))}</div></div>${r.status === 'Failed' ? `<div class="callout bad" style="margin-top:14px">${I('warn')}<div>${r.channel === 'WhatsApp' ? 'WhatsApp isn\'t connected for this practice yet.' : 'The recipient\'s mail server rejected the message (mailbox full). Resend, or call the client.'}</div></div>` : ''}`, foot: '<button class="btn primary" data-close>Close</button>' }); }
      const rs = e.target.closest('[data-resend]');
      if (rs) { const r = D.deliveryLog.find(x => x.id === +rs.dataset.resend); busy(rs, () => { r.status = 'Sent'; r.at = new Date(); tbl.refresh(); root.querySelector('#n-failed').textContent = D.deliveryLog.filter(x => x.status === 'Failed').length; toast(`Resent to ${esc(r.to)}`, 'ok'); }, 900); }
    });
  },
});

/* ==========================================================================
   12. /communication
   ========================================================================== */
const SMTP = { host: 'smtp.gmail.com', port: 587, sender: 'office@kumar-associates.demo', senderName: 'Kumar & Associates' };
page('/communication', {
  title: 'Communication', crumbs: [['Firm', '/users']], perm: 'SETTINGS_EDIT',
  render: () => `${pageHead('Communication channels', 'How PactPro sends messages to your team and clients.')}
    <div class="grid g-2" style="align-items:start">
      <section class="panel"><div class="panel-head"><div class="row">${I('mail')}<h3>Email</h3></div>${chip('Working', 'ok')}</div>
        <div class="panel-body"><dl class="kv" id="smtp-kv"></dl>
          <div class="row" style="margin-top:16px"><button class="btn sm" id="smtp-edit">${I('edit', 'sm')}Edit settings</button></div>
          <form class="stack" novalidate id="tf3" style="border-top:1px solid var(--line);margin-top:18px;padding-top:16px"><h4>Send a test email</h4>
            <div class="row" style="align-items:flex-start">${field({ id: 'te-to', label: '<span class="sr-only">Send test to</span>', type: 'email', value: D.me.email, required: true, rule: 'email', err: 'Enter a valid email to send the test to.' }).replace('class="field', 'class="field grow')}<button class="btn" id="te-go" type="submit">${I('send', 'sm')}Send test</button></div>
            <div id="te-out" aria-live="polite"></div></form></div></section>
      <div class="stack" style="gap:16px">
        <section class="panel"><div class="panel-head"><div class="row">${I('chat')}<h3>WhatsApp</h3></div>${chip('Not connected', '')}</div>
          <div class="panel-body stack"><p class="small muted">WhatsApp needs a verified WhatsApp Business account linked through Meta. Until then, reminders go by email and in-app only.</p>
          <div class="form-grid">${field({ id: 'wa-num', label: 'Business number', placeholder: '+91 44 0000 0000', attrs: 'disabled' })}${field({ id: 'wa-id', label: 'Phone number ID', placeholder: 'From Meta Business', attrs: 'disabled' })}</div>
          <div><button class="btn" id="wa-req">Request access</button></div></div></section>
        <section class="panel"><div class="panel-head"><div class="row">${I('bell')}<h3>In-app</h3></div>${chip('Always on', 'ok')}</div>
          <div class="panel-body"><p class="small muted">Everyone sees alerts in the bell menu while signed in. This channel can't be turned off.</p></div></section>
      </div></div>
    <div class="section-title"><h2>Recent messages</h2><a class="link small" href="#/notifications">Open delivery log</a></div>
    <div class="table-wrap"><table class="t"><thead><tr><th>Event</th><th>Channel</th><th>Recipient</th><th class="hide-sm">Sent</th><th>Status</th></tr></thead><tbody>
    ${D.deliveryLog.slice().sort((a, b) => b.at - a.at).slice(0, 6).map(r => `<tr><td>${EVENT_LABEL(r.kind)}</td><td>${esc(r.channel)}</td><td>${esc(r.name)}</td><td class="hide-sm small nowrap">${fdt(r.at)}</td><td>${chip(r.status)}</td></tr>`).join('')}</tbody></table></div>`,
  mount(root) {
    const draw = () => { root.querySelector('#smtp-kv').innerHTML = `<dt>SMTP host</dt><dd class="mono">${esc(SMTP.host)}</dd><dt>Port</dt><dd class="mono">${SMTP.port} (STARTTLS)</dd><dt>Sender email</dt><dd>${esc(SMTP.sender)}</dd><dt>Sender name</dt><dd>${esc(SMTP.senderName)}</dd><dt>Password</dt><dd class="mono">••••••••••••</dd>`; };
    draw();
    root.querySelector('#smtp-edit').onclick = () => modal({
      title: 'Email settings', sub: 'Use an app password if your provider requires one.',
      body: `<form class="form-grid" novalidate id="smf">
        ${field({ id: 'sm-host', label: 'SMTP host', value: SMTP.host, required: true, err: 'Enter the SMTP server, like smtp.gmail.com.' })}
        ${field({ id: 'sm-port', label: 'Port', type: 'number', value: SMTP.port, required: true, err: 'Enter the port, usually 587 or 465.' })}
        ${field({ id: 'sm-from', label: 'Sender email', value: SMTP.sender, required: true, rule: 'email', err: 'Enter a valid email.' })}
        ${field({ id: 'sm-name', label: 'Sender name', value: SMTP.senderName, required: true, err: 'Enter the name clients will see.' })}
        <div class="full">${pwField({ id: 'sm-pw', label: 'Password', value: 'demo-app-pass', required: true, err: 'Enter the password or app password.' })}</div></form>`,
      foot: '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" id="sm-save">Save settings</button>',
      onMount(el, close) {
        wireReveal(el);
        el.querySelector('#sm-save').onclick = (e) => {
          const f = el.querySelector('#smf'); if (!validateForm(f)) return;
          const port = el.querySelector('#sm-port'); const bad = !(+port.value > 0 && +port.value < 65536); port.closest('.field').classList.toggle('invalid', bad); if (bad) return port.focus();
          busy(e.currentTarget, () => { SMTP.host = el.querySelector('#sm-host').value.trim(); SMTP.port = +port.value; SMTP.sender = el.querySelector('#sm-from').value.trim(); SMTP.senderName = el.querySelector('#sm-name').value.trim(); close(); draw(); toast('Email settings saved. Send a test to check them.', 'ok'); }, 900);
        };
      },
    });
    root.querySelector('#tf3').addEventListener('submit', e => {
      e.preventDefault(); const out = root.querySelector('#te-out'); out.innerHTML = '';
      if (!validateForm(e.target)) return;
      const to = root.querySelector('#te-to').value.trim();
      busy(root.querySelector('#te-go'), () => { out.innerHTML = `<div class="callout ok">${I('ok')}<div>Test email delivered to <b>${esc(to)}</b>. Check that inbox to confirm.</div></div>`; }, 1200);
    });
    root.querySelector('#wa-req').onclick = (e) => busy(e.currentTarget, () => toast('Request sent. We\'ll email you when WhatsApp is available.', 'info'));
  },
});

/* ==========================================================================
   CLIENT PORTAL (bare, needs a session). Client = Kannan (D.clients[0]).
   ========================================================================== */
const PC = () => D.clients[0];
const pCases = () => D.cases.filter(c => c.client === PC().id);
const pInvoices = () => D.invoices.filter(i => i.client === PC().id && i.status !== 'Draft');
const pPayments = () => D.payments.filter(p => p.client === PC().id);
const pDocs = () => D.documents.filter(d => d.client === PC().id && d.shared);
const stampHtml = (d) => `<span class="stamp ${daysFrom(d) === 0 ? 'today' : ''}" aria-hidden="true"><span>${fdate(d, { month: 'short' })}</span><b>${new Date(d).getDate()}</b></span>`;
const PORTAL_NAV = [['/portal', 'Home'], ['/portal/cases', 'My cases'], ['/portal/invoices', 'Invoices'], ['/portal/documents', 'Documents'], ['/portal/messages', 'Messages'], ['/portal/account', 'Account']];
function portalFrame(active, inner) {
  const c = PC();
  return `<div class="portal">
    <div class="preview-banner">${I('eye', 'sm')}<span>You're previewing the client portal as ${esc(c.name)}. <a href="#/">Back to PactPro</a></span></div>
    <header class="portal-top"><div class="in"><span class="seal" aria-hidden="true">K</span><div class="grow"><b class="serif" style="font-size:19px;font-weight:500">${esc(D.firm.name)}</b><div class="faint xs">Client portal</div></div>
      <div class="row who" style="gap:8px">${avatar(c.name, 'sm')}<span class="small">${esc(c.name)}</span></div>
      <button class="icon-btn" id="theme-btn" onclick="toggleTheme()" aria-label="Switch theme"></button>
      <button class="btn sm" onclick="go('/')">${I('logout', 'sm')}Sign out</button></div>
      <nav class="portal-nav" aria-label="Portal">${PORTAL_NAV.map(([h, l]) => `<a href="#${h}" ${h === active ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav></header>
    <main class="portal-body fade-in">${inner}</main>
    <footer class="portal-foot"><div class="in"><b style="color:var(--ink-2)">${esc(D.firm.name)}</b><span>${esc(D.firm.address)}</span><span>${esc(D.firm.phone)}</span><span>${esc(D.firm.email)}</span></div></footer></div>`;
}
const caseMoney = (cs) => cs.reduce((a, c) => ({ fee: a.fee + c.fee, paid: a.paid + c.paid }), { fee: 0, paid: 0 });
const portalPage = (path, title, body, mount) => page(path, { title, bare: true, render: (p) => portalFrame(path.includes(':') ? '/portal/cases' : path, body(p)), mount: (root, p) => { updateThemeBtn(); mount && mount(root, p); } });

portalPage('/portal', 'Client portal', () => {
  const cs = pCases(); const m = caseMoney(cs);
  const ups = D.events.filter(e => e.type === 'Hearing' && cs.some(c => c.id === e.caseId) && daysFrom(e.at) >= 0).sort((a, b) => a.at - b.at);
  const hr = new Date().getHours();
  return `<h1 class="serif" style="margin-bottom:6px">Good ${hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening'}, ${esc(PC().name)}</h1>
    <p class="muted" style="margin-bottom:24px">Here is where your matters stand with ${esc(D.firm.name)}.</p>
    <div class="figures" style="margin-bottom:28px">
      <a class="figure" href="#/portal/cases"><div class="lbl">Active cases</div><div class="val">${cs.filter(c => c.status !== 'Closed').length}</div></a>
      <a class="figure" href="#/portal/invoices"><div class="lbl">Outstanding fees</div><div class="val">${inr(m.fee - m.paid)}</div><div class="meta">of ${inr(m.fee)} agreed</div></a>
      <a class="figure" href="#/portal/documents"><div class="lbl">Shared documents</div><div class="val">${pDocs().length}</div></a></div>
    <div class="section-title" style="margin-top:0"><h2>Upcoming hearings</h2></div>
    <div class="panel"><div class="list">${ups.length ? ups.map(e => { const c = caseById(e.caseId); return `<a class="list-item" href="#/portal/cases/${c.id}">${stampHtml(e.at)}<div class="grow"><div class="mono small">${esc(c.no)}</div><div style="font-weight:500">${esc(c.title)}</div><div class="faint xs">${esc(c.hall)}, ${esc(c.courtName)}</div></div><div class="right small"><b class="mono">${ftime(e.at)}</b><div class="faint xs">${rel(e.at)}</div></div></a>`; }).join('') : emptyState({ icon: 'calendar', title: 'No hearings scheduled', text: 'Your advocate will add the next date after the court lists it.' })}</div></div>`;
});

portalPage('/portal/cases', 'My cases', () => `<h1 class="serif" style="margin-bottom:20px">My cases</h1>
  <div class="grid g-2">${pCases().map(c => `<a class="panel pp-case-card" href="#/portal/cases/${c.id}"><div class="row between"><span class="mono small muted">${esc(c.no)}</span>${chip(c.status)}</div>
    <h3 class="serif" style="font:500 var(--t-xl)/1.25 var(--f-display);margin:8px 0 6px">${esc(c.title)}</h3><div class="faint small">${esc(c.courtName)}, ${esc(c.hall)}</div>
    <div class="row between" style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px"><span class="small">Stage: <b>${esc(c.stage)}</b></span><span class="small">${c.next ? 'Next: <b>' + fdate(c.next) + '</b>' : '<span class="faint">No date yet</span>'}</span></div></a>`).join('')}</div>`);

portalPage('/portal/cases/:id', 'Case', (p) => {
  const c = caseById(p.id);
  if (!c || c.client !== PC().id) return emptyState({ icon: 'case', title: 'This case isn\'t in your portal', text: 'It may belong to someone else, or the link is wrong.', action: '<a class="btn" href="#/portal/cases">See my cases</a>' });
  const invs = pInvoices().filter(i => i.caseId === c.id); const docs = pDocs().filter(d => d.caseId === c.id);
  return `<a class="link small" href="#/portal/cases">My cases</a>
    <div class="docket" style="margin:12px 0 20px"><div class="no">${esc(c.no)}</div><h1>${esc(c.party[0])}<span class="vs">vs</span>${esc(c.party[1])}</h1>
      <div class="meta-line"><span>${I('scale', 'sm')}${esc(c.courtName)}</span><span>${I('pin', 'sm')}${esc(c.hall)}</span><span>${chip(c.status)}</span><span>Stage: ${esc(c.stage)}</span></div></div>
    <div class="figures" style="margin-bottom:20px"><div class="figure"><div class="lbl">Fees agreed</div><div class="val">${inr(c.fee)}</div></div><div class="figure"><div class="lbl">Paid</div><div class="val">${inr(c.paid)}</div></div><div class="figure"><div class="lbl">Outstanding</div><div class="val" ${c.fee - c.paid ? 'style="color:var(--warn)"' : ''}>${inr(c.fee - c.paid)}</div></div></div>
    <div class="grid g-2" style="align-items:start">
      <section class="panel"><div class="panel-head"><h3>Hearings</h3></div><div class="panel-body">
        ${c.next ? `<div class="row" style="margin-bottom:16px">${stampHtml(c.next)}<div><b>Next hearing ${rel(c.next).toLowerCase() === 'today' ? 'today' : 'on ' + fdate(c.next)}</b><div class="faint xs">${ftime(c.next)}, ${esc(c.hall)}. Item ${c.item}.</div></div></div>` : ''}
        <div class="timeline">${D.hearingHistory(c.id).slice().reverse().slice(0, 4).map(h => `<div class="tl-item"><div class="small"><b>${fdate(h.date)}</b>, ${esc(h.purpose)}</div><div class="when">${esc(h.outcome)}</div></div>`).join('')}</div></div></section>
      <div class="stack" style="gap:16px">
        <section class="panel"><div class="panel-head"><h3>Parties</h3></div><div class="panel-body"><dl class="kv">${D.parties(c).map(pt => `<dt>${pt.role}</dt><dd><b>${esc(pt.name)}</b><div class="faint xs">Counsel: ${esc(pt.counsel)}</div></dd>`).join('')}</dl></div></section>
        <section class="panel"><div class="panel-head"><h3>Shared documents</h3></div><div class="panel-body flush"><div class="list">${docs.length ? docs.map(d => `<div class="list-item">${I(docIcon(d.ext))}<span class="grow small ellipsis">${esc(d.name)}</span><button class="btn ghost sm" data-dn="${esc(d.name)}">Download</button></div>`).join('') : '<div class="list-item faint small">Nothing shared on this case yet.</div>'}</div></div></section>
        <section class="panel"><div class="panel-head"><h3>Invoices</h3></div><div class="panel-body flush"><div class="list">${invs.length ? invs.map(i => `<div class="list-item"><span class="mono small grow">${esc(i.no)}</span><span class="num small">${inr(i.total)}</span>${chip(i.status)}</div>`).join('') : '<div class="list-item faint small">No invoices on this case.</div>'}</div></div></section>
      </div></div>`;
}, (root) => root.addEventListener('click', e => { const b = e.target.closest('[data-dn]'); if (b) toast('Download started: ' + esc(b.dataset.dn)); }));

portalPage('/portal/invoices', 'Invoices', () => `<h1 class="serif" style="margin-bottom:20px">Invoices</h1>
  <div class="table-wrap"><table class="t"><thead><tr><th>Invoice</th><th>Case</th><th class="hide-sm">Date</th><th class="hide-sm">Due</th><th class="right">Amount</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>
  ${pInvoices().map(i => `<tr><td class="mono">${esc(i.no)}</td><td class="small">${esc(caseById(i.caseId).no)}</td><td class="hide-sm small">${fdate(i.date)}</td><td class="hide-sm small">${fdate(i.due)}</td><td class="amt">${inr(i.total)}</td><td>${chip(i.status)}</td><td class="actions"><button class="btn ghost sm" data-dn="${esc(i.no)}.pdf">${I('download', 'sm')}PDF</button></td></tr>`).join('')}</tbody></table></div>
  <div class="callout info" style="margin-top:16px">${I('info')}<div>Pay by bank transfer to <b>${esc(D.firm.bank.favour)}</b>, ${esc(D.firm.bank.name)}, account <span class="mono">${esc(D.firm.bank.account)}</span>, IFSC <span class="mono">${esc(D.firm.bank.ifsc)}</span>. Quote the invoice number.</div></div>
  <div class="section-title"><h2>Payments received</h2></div>
  <div class="table-wrap"><table class="t"><thead><tr><th>Date</th><th>Case</th><th class="hide-sm">Mode</th><th class="hide-sm">Reference</th><th class="right">Amount</th></tr></thead><tbody>
  ${pPayments().sort((a, b) => b.date - a.date).map(p => `<tr><td class="small nowrap">${fdate(p.date)}</td><td class="small">${esc(caseById(p.caseId).no)}</td><td class="hide-sm">${esc(p.mode)}</td><td class="hide-sm mono small">${esc(p.ref)}</td><td class="amt">${inr(p.amount)}</td></tr>`).join('')}</tbody></table></div>`,
(root) => root.addEventListener('click', e => { const b = e.target.closest('[data-dn]'); if (b) toast('Download started: ' + esc(b.dataset.dn)); }));

portalPage('/portal/documents', 'Documents', () => `<h1 class="serif" style="margin-bottom:6px">Documents</h1><p class="muted" style="margin-bottom:20px">Files your advocate has shared with you.</p>
  ${pDocs().length ? `<div class="doc-grid">${pDocs().map(d => `<div class="doc-tile" style="cursor:default"><div class="sheet"><span class="ext">${esc(d.ext)}</span><div class="pg" aria-hidden="true"><i></i><i></i><i style="width:70%"></i><i></i><i style="width:50%"></i></div></div>
    <div class="body"><div class="name">${esc(d.name)}</div><div class="faint xs" style="margin:4px 0 10px">${esc(caseById(d.caseId).no)}, ${sizeFmt(d.kb)}</div><div class="row"><button class="btn sm" data-v="${esc(d.name)}">${I('eye', 'sm')}View</button><button class="btn ghost sm" data-dn="${esc(d.name)}">${I('download', 'sm')}Download</button></div></div></div>`).join('')}</div>`
    : emptyState({ icon: 'folder', title: 'Nothing shared yet', text: 'Documents appear here when your advocate shares them.' })}`,
(root) => root.addEventListener('click', e => { const v = e.target.closest('[data-v]'); if (v) toast('Opening ' + esc(v.dataset.v), 'info'); const b = e.target.closest('[data-dn]'); if (b) toast('Download started: ' + esc(b.dataset.dn)); }));

portalPage('/portal/messages', 'Messages', () => `<h1 class="serif" style="margin-bottom:20px">Messages</h1>
  <div class="stack" style="gap:16px">${D.messages.slice().sort((a, b) => b.at - a.at).map(m => `<article class="panel"><div class="panel-head"><h3>${esc(m.subject)}</h3><span class="faint xs nowrap">${fdt(m.at)}</span></div><div class="panel-body"><div class="row small muted" style="margin-bottom:12px">${avatar(D.me.name, 'sm')}From ${esc(D.me.name)}</div><div class="pp-msg-body">${esc(m.body)}</div></div></article>`).join('')}</div>`);

portalPage('/portal/account', 'Account', () => { const c = PC(); return `<h1 class="serif" style="margin-bottom:20px">Account</h1>
  <div class="grid g-2" style="align-items:start">
    <section class="panel"><div class="panel-head"><h3>Your details</h3></div><div class="panel-body"><dl class="kv"><dt>Name</dt><dd>${esc(c.name)}</dd><dt>Email</dt><dd>${esc(c.email)}</dd><dt>Phone</dt><dd class="num">${esc(c.phone)}</dd><dt>Address</dt><dd>${esc(c.building)}, ${esc(c.street)}, ${esc(c.city)} ${esc(c.pin)}</dd><dt>Advocate</dt><dd>${esc(advById(c.advocate).name)}</dd></dl>
      <p class="faint xs" style="margin-top:14px">To change these, call ${esc(D.firm.phone)} or email ${esc(D.firm.email)}.</p></div></section>
    <section class="panel"><div class="panel-head"><h3>Change password</h3></div><div class="panel-body"><form class="stack" novalidate id="pa">
      ${pwField({ id: 'pa-cur', label: 'Current password', autocomplete: 'current-password', err: 'Enter your current password.' })}
      ${pwBlock('pa')}<div><button class="btn primary" id="pa-go" type="submit" disabled>Change password</button></div></form></div></section></div>`; },
(root) => {
  wireReveal(root); const btn = root.querySelector('#pa-go');
  wirePwBlock(root, 'pa', ok => { btn.disabled = !ok; });
  root.querySelector('#pa').addEventListener('submit', e => {
    e.preventDefault(); const cur = root.querySelector('#pa-cur'); const bad = !cur.value; cur.closest('.field').classList.toggle('invalid', bad); if (bad) return cur.focus();
    busy(btn, () => { e.target.reset(); e.target.querySelectorAll('input').forEach(i => i.dispatchEvent(new Event('input'))); toast('Password changed', 'ok'); });
  });
});
