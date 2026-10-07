# PactPro design system: "Red Tape"

This is the design direction and system for the PactPro (AMS) redesign demo in `ams-redesign-demo/index.html`. It covers which direction was chosen and why, the tokens and components, and how to move the design into the real React and PrimeReact codebase. The source of truth for tokens is `src/styles.css`.

---

## 1. Three directions considered (Phase 2)

All three directions were designed for advocates who read case papers for long stretches, scan dense registers, and need to be able to trust the tool.

### A. Chambers ink and brass
- **Mood:** a senior counsel's chambers: dark panelled wood, brass fittings, bound reports.
- **Primary and secondary:** deep ink-green `#1E2B26` and oxidised brass `#9C7A3C`.
- **Accent:** brass.
- **Surfaces:**
  - Light: `#F4F3EE`, `#FFFFFF`, `#ECEAE2`.
  - Dark: `#121815`, `#1A221E`.
- **Text:** `#1C211E`, `#4D554F`, `#727A73`.
- **Borders:** `#D9D6CB`.
- **Semantic:** ok `#2F6B4F`, warn `#946312`, danger `#A8322A`, info `#2F5A7A`.
- **Fonts:** Cormorant Garamond (display), Source Sans 3 (body), JetBrains Mono (case numbers).
- **Why it fits:** gold-on-dark signals authority and tradition.
- **Risk:** brass on cream drifts into the "luxury law firm" cliché. Brass is also a weak accent for status and only reaches AA contrast on dark grounds.

### B. Registry green, editorial
- **Mood:** a well-set law report: warm neutral paper with a deep-green rule, the colour of court registry ink.
- **Primary and accent:** registry green `#1F4D3A` and saffron `#C9821B` (alerts).
- **Surfaces:** `#F6F4EF`, `#FFFFFF`, `#EEEBE3`.
- **Text:** `#202320`, `#545851`.
- **Semantic:** ok `#2E7D57`, warn `#B7791F`, danger `#B4372E`, info `#2C5D8F`.
- **Fonts:** Fraunces (display), Inter Tight (body), IBM Plex Mono.
- **Why it fits:** calm and highly readable, with a strong editorial hierarchy.
- **Risk:** warm cream plus a serif display is currently the most common generated "tasteful" look. Green as the brand colour also collides with "success".

### C. Red Tape (chosen)
- **Mood:** the advocate's brief: a bundle of papers on cool bond paper, the black of the gown, and the strand of red tape that ties every Indian case file.
- **Colours:**
  - Primary: ink `#1A1D24`, used for text and primary buttons.
  - Accent: red tape `#A3232B`. It is used only for *today, now, needs you*.
  - Surfaces, light: paper `#F2F3F0`, surface `#FFFFFF`, inset `#F7F8F6`, pressed `#E9EBE6`.
  - Surfaces, dark: `#13161C`, `#1A1E25`, `#1F242C`, `#282E38`.
  - Text: `#1A1D24` / `#464C57` / `#686F7B`.
  - Borders: `#DCDFD8`, strong `#C4C8C0`.
  - Semantic: ok `#276A50`, warn `#8A5C0B`, danger `#B3261E`, info `#2D5785`.
- **Fonts:** Newsreader (display serif with optical sizes), IBM Plex Sans (body), IBM Plex Mono (case numbers, CNR, amounts).
- **Why it fits:** the subject supplies the accent. Every case file in a Tamil Nadu court is tied with red tape, so the accent means something here and isn't just decoration. The design is ink-first, so the one red is always the loudest thing on screen. That gives the app a calm, monochrome working surface with a single, unmissable "act now" signal.

### Evaluation

| Criterion | A Chambers | B Registry | C Red Tape |
|---|---|---|---|
| Distinct from generic admin / AI looks | Medium (luxury cliché) | Low (cream + serif default) | **High** (subject-derived accent, ink chrome) |
| Readability over long sessions | Good | Very good | **Very good** (cool neutral paper, 14px Plex, 1.5 leading) |
| WCAG AA | Brass fails as text on light | Pass | **Pass**: ink 16.9:1, ink-3 5.1:1 (4.5:1 on paper), tape-ink 8.9:1 on white; every chip ≥ 4.9:1 in both themes |
| Status semantics | Brass muddles warning | Green brand clashes with success | **Clean**: brand is ink; red reserved for urgency, never for "Closed" |
| Dense data | OK | Good | **Good**: mono figures, tabular nums, quiet chrome |
| Fit with current trends | Glass and gold feel dated | Editorial is on trend | **Calm layers, command palette, keyboard-first, restrained motion** |
| Dark mode | Natural | Hard (cream inverts badly) | **Natural** (ink/paper invert cleanly; tape lightens to `#D9555C`) |

**Decision: C, Red Tape.** It is the only direction whose accent carries meaning in this domain. It also fixes the current UI's biggest problems: the blue-violet AI-dashboard look, two competing palettes, and red used for "Closed".

---

## 2. Principles

1. **Ink, paper, one strand of red.** The chrome is monochrome. Crimson appears only for the active nav item, today's date, the next hearing, overdue amounts and urgent tags. If everything is red, nothing is.
2. **Today first.** The home page is "Today", a cause list of your matters, rather than a grid of equal-weight KPI cards.
3. **Numbers are type.** Case numbers, CNRs and amounts are always mono with tabular figures. Headline figures use the serif with lining numerals.
4. **Status is finished or pending, not good or bad.** Closed and Disposed are neutral grey. Red means "act".
5. **Quiet motion.** There is one page-enter fade (220–360 ms). Overlays animate because the user opened them. `prefers-reduced-motion` turns animation off.
6. **Keyboard-first.** Ctrl/⌘ K opens the palette, `g` then a letter jumps between pages, `n` opens the New menu, `?` lists shortcuts, and every overlay traps focus and closes on Esc.

---

## 3. Tokens (`src/styles.css` §1)

### Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#F2F3F0` | `#13161C` | App background |
| `--surface` | `#FFFFFF` | `#1A1E25` | Panels, tables, modals |
| `--surface-2` | `#F7F8F6` | `#1F242C` | Table header, inset, modal footer |
| `--surface-3` | `#E9EBE6` | `#282E38` | Hover, pressed, skeleton |
| `--ink` | `#1A1D24` | `#E8EAED` | Primary text and primary button |
| `--ink-2` | `#464C57` | `#B4BAC4` | Secondary text |
| `--ink-3` | `#686F7B` | `#8F96A1` | Captions, placeholders |
| `--line` / `--line-strong` | `#DCDFD8` / `#C4C8C0` | `#2C323C` / `#3A414D` | Hairlines, input borders |
| `--tape` | `#A3232B` | `#D9555C` | Accent: active, today, urgent |
| `--tape-ink` / `--tape-soft` | `#8E1D24` / `#F6E4E3` | `#EE8186` / `#3A2226` | Accent text and tint |
| `--ok` / soft | `#276A50` / `#E1EFE8` | `#6CC29C` / `#1D3229` | Active, Paid, Approved |
| `--warn` / soft | `#8A5C0B` / `#F6EBD3` | `#DDAA4B` / `#362C19` | Pending, Unpaid, To review |
| `--bad` / soft | `#B3261E` / `#F9E1DE` | `#F07C72` / `#3B2120` | Overdue, Failed, High priority |
| `--info` / soft | `#2D5785` / `#E2EAF4` | `#8DB3DE` / `#1F2C3C` | In progress, Reserved, links, focus |
| `--mute` / soft | `#5B6370` / `#E8EAE7` | `#A3AAB5` / `#272C34` | Closed, Disposed, Draft |
| `--side-bg` | `#1B1E25` | `#0F1115` | Sidebar, always ink (the gown) |

#### Status mapping (`TONE` in `core.js`)

| Group | ok | warn | bad | info | mute | tape |
|---|---|---|---|---|---|---|
| Case | Active | Pending | — | Reserved | Closed, Disposed | — |
| Invoice | Paid | Unpaid | Overdue | — | Draft | — |
| Task | Completed | To review | Changes requested | In Progress | — | — |
| Priority | — | Medium | High | — | Low | — |
| Appeal alert | — | — | — | — | — | New |

### Typography

| Role | Family | Fallbacks |
|---|---|---|
| Display | Newsreader 400/500/600, italic for "vs" | Iowan Old Style, Palatino Linotype, Georgia, serif |
| Body | IBM Plex Sans 400/500/600 | Segoe UI, system-ui, sans-serif |
| Data | IBM Plex Mono 400/500/600 | Cascadia Mono, Consolas, monospace |

Scale (a modular step of about 1.25 from a 14px base):

| Token | Size | Use |
|---|---|---|
| `--t-xs` | 12 | Captions, chips, meta |
| `--t-sm` | 13 | Tables, buttons, nav |
| `--t-md` | 14 | Body (line-height 1.5) |
| `--t-lg` | 16 | h3, emphasis |
| `--t-xl` | 20 | Modal and drawer titles, section titles |
| `--t-2xl` | 26 | Page titles (serif) |
| `--t-3xl` | 34 | Docket title, KPI numerals, auth (serif) |

There are no all-caps labels. Sentence case is used everywhere.

### Space, radius, elevation, motion

| Group | Tokens |
|---|---|
| Space | `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s5` 20, `--s6` 24, `--s8` 32, `--s10` 40, `--s12` 48 |
| Radius | `--r-xs` 3 (chips, kbd), `--r-sm` 5 (buttons, inputs), `--r-md` 8 (menus, small cards), `--r-lg` 12 (panels, modals), `--r-pill` |
| Elevation | `--e-1` panel hairline; `--e-2` hover and popover; `--e-3` modal, drawer, palette, toast |
| Motion | `--ease` cubic-bezier(.2,.7,.2,1); `--d-fast` 120ms, `--d-med` 220ms, `--d-slow` 360ms |

Small things have tight radii and containers are softer. Panels are flat with a 1px border, and only overlays float.

### Layout grid

- **Shell:** sidebar 248px (64px when collapsed), top bar 56px sticky with blur, and a content area up to 1480px wide with 24px gutters (16px on mobile).
- **`.split`:** main column plus a 320px rail. The rail sticks on desktop and stacks below 1024px.
- **Grid classes:** `.grid g-2/g-3/g-4`, `.form-grid` (2 columns, 1 on mobile).

Breakpoints:

| Width | Behaviour |
|---|---|
| 1180px | Editor's right pane moves under the editor |
| 1024px | Sidebar becomes an icon rail; rails stack; top search becomes an icon |
| 768px | Sidebar becomes an off-canvas drawer with a scrim; single-column forms; calendar events become dots |

---

## 4. Components

| Component | Class or API | Notes |
|---|---|---|
| Button | `.btn` + `.primary` (ink), `.tape` (rare), `.ghost`, `.danger`, `.danger.solid`, `.sm`, `.icon`, `.loading` | 34px tall; primary is ink rather than blue; loading swaps the label for a spinner |
| Segmented control | `.seg[data-seg] > button[data-v][aria-pressed]` | View toggles (Table/Board, Month/Week/Agenda, Grid/List) |
| Chip | `chip(label)` → `.chip.ok/warn/bad/info/tape` | Status with a dot; tone comes from `TONE` |
| Tag | `.tag`, `.tag.hot` | Case tags; High Priority and Urgent get the tape outline |
| Input / field | `field({...})`, `.input`, `.field.invalid/.valid` | Label above, hint below, error with icon and `role=alert` |
| Validation | `validateForm(form)` | Rules for required, email, phone, gstin, pincode and min:N; focuses the first error |
| Table | `DataTable(el, cfg)` | Search, filters, sortable headers (keyboard too), paging, empty and no-match states, row click |
| Tabs | `[data-tabs] > button[data-tab]` + `[data-panel]` | ARIA tabs with arrow-key support |
| Modal | `modal({title, body, foot, size})` | Focus trap, Esc, click outside to close |
| Drawer | `drawer({...})` | Right sheet for detail views (event, document, audit entry) |
| Popover menu | `popMenu(anchor, items)` | Arrow-key navigation |
| Toast | `toast(msg, kind, {action})` | Always-dark capsule, bottom right, `aria-live` |
| Command palette | `openPalette()` | Ctrl/⌘ K; recent items, pages and actions; searches cases, CNR, clients, invoices and documents |
| Skeleton | `SKELETONS.table/dashboard/detail/cards` | Shown for about 320ms on navigation |
| Empty state | `emptyState({icon,title,text,action})` | Always offers the next action |
| **Cause slip** | `.slips > .slip(.now)` | Signature component: item no. in serif, case no. in mono, tape stripe on the next matter |
| **Docket** | `.docket` | Case header styled as a file cover, with a vertical tape strand and italic "vs" |
| Date stamp | `.stamp(.today)` | Hearing lists |
| Timeline | `.timeline > .tl-item(.key)` | Case history and document versions |
| Figures | `.figures > .figure` | KPI row as one ruled strip, not separate cards |
| Charts | `barChart`, `lineChart`, `donut`, `.bar-row` | Inline SVG, token colours, labels drawn to scale |
| Calendar | `.cal`, `.ev.hearing/meeting/payment/filing`, `.week` | Event types are encoded by stripe colour, kept apart from status colours |
| Paper sheet | `.paper-sheet`, `.ph`, `.cite`, `.risk` | Drafting editor and document preview |

### Iconography
- A custom inline line set in `core.js`: 24px grid, 1.6 stroke, round caps.
- Sizes: 18px by default, 15px with `.sm`, 22px with `.lg`.
- Icons always sit next to a label, or carry `aria-label` / `title` when used alone.

---

## 5. Accessibility

- **Contrast:** body text and all chips meet AA in both themes (measured: ink-3 on surface 5.1:1 light and 5.6:1 dark; chip text on chip tint 4.9–7.3:1; white on tape 7.4:1).
- **Focus:** visible two-ring focus (`--focus`) on every control.
- **Overlays:** modals, drawers and the palette trap focus, close on Esc, and restore focus.
- **Navigation:** a skip link, `aria-current` on nav and portal tabs, `aria-sort` on table headers, and `aria-live` for toasts and form errors.
- **Reduced motion:** `prefers-reduced-motion` disables animations.
- **Status:** never shown by colour alone; chips always carry text.

---

## 6. Implementing in the real codebase (`Advocate-app-FE-main`)

1. **Replace `themes.css` tokens** with §3, keeping the same `data-theme` switch in `ThemeContext`.
   - Drop the animated gradient body and the `glass-card` blur.
   - Remove the hard-coded sidebar palette in `Dashboard.css:24-40`. The sidebar becomes `--side-*`.
2. **Bridge PrimeReact.**
   - Map Lara variables in `prime-bridge.css`: `--primary-color: var(--ink)`, `--surface-*`, `--text-color`, `--highlight-bg: var(--surface-3)`, `--border-radius: var(--r-sm)`.
   - Better still, switch to PrimeReact unstyled mode with pass-through classes that match §4.
3. **Fonts.** Load Newsreader, IBM Plex Sans and IBM Plex Mono in `index.html` and remove the Inter import from `src/index.css`.
4. **Unify components.**
   - Retire `.btn-*` gradients and use `.btn` variants.
   - Make one table style: DataTable pass-through using `.t` rules.
   - Make one `StatusChip` component driven by the `TONE` map, and fix "Closed" being danger in `Panel.css:128-160`.
5. **Navigation.** Group the sidebar as Practice, Court, Billing, Drafting, Library and Firm. Rename Dashboard to "Today" and make it the cause-slip layout.
6. **Case detail.** Add the docket header and right rail. Collapse the 13 tabs into Overview, Parties, Hearings, Orders, Documents, Tasks, Billing, Notes, Related, Acts and Timeline. Billing merges Expenses and Invoices.
7. **Missing states.**
   - Add a 404 route and a 403 component in place of the silent redirect in `PermissionRoute`.
   - Fix topbar titles to use breadcrumbs.
   - Surface fetch errors (currently console-only in ReportsCenter, CommunicationHistory and NotificationsCenter) with the error panel pattern.
8. **Inline styles.** Remove the roughly 405 inline `style={{}}` uses and roughly 385 hex literals in favour of tokens. Use a single breakpoint set (1180 / 1024 / 768).
9. **Billing settings.** Move the orphaned billing-profile fields (`SettingsPage`) into Settings → Billing.

---

## 7. Alternative theme: "Chambers"

This is the second candidate design, built for side-by-side comparison. It uses the same pages, data and behaviour as Red Tape. Only the visual layer changes, in `src/theme-chambers.css`, which loads on top of `styles.css`.

**Build:** `.\build.ps1 -Theme chambers` produces `chambers.html` and `dist/artifact-chambers.html`.

| | Red Tape | Chambers |
|---|---|---|
| Mood | Modern brief bundle: ink, cool paper, one crimson strand | A senior counsel's chambers: green panelling, antique brass, warm stone |
| Ground / surface | `#F2F3F0` / `#FFFFFF` | Stone `#EFECE4` / vellum `#FBFAF6` |
| Primary action | Ink `#1A1D24` | Panelling green `#1F3A2F` (dark mode: brass `#C9A45C`) |
| Accent | Crimson `#A3232B` | Brass `#9C7A3C`, text `#74581F` |
| Sidebar | Ink `#1B1E25`, tape-strip active marker | Green `#17231E`, gilt rule under the brand, brass lozenge active marker |
| Fonts | Newsreader / IBM Plex Sans / IBM Plex Mono | Cormorant Garamond / Source Sans 3 / JetBrains Mono |
| Corners | 3–12px | 2–6px (cut, bound-volume edges) |
| Panels | Flat, 1px border | Vellum sheet with a 2px gilt head rule |
| Case header | White docket with a crimson tape strip | Green bound brief: gilt top edge, inset brass rule, brass "vs" |
| Labels | Sans, sentence case | Italic serif for group labels, table headers and figure labels |
| Calendar "today" | Crimson | Green |

**Contrast (measured):**
- **Light:** ink on vellum 15.2:1, captions 4.9:1 on stone, brass text 6.4:1, primary button 10.6:1.
- **Dark:** parchment ink 13.6:1, captions 5.4:1, brass chips 7.8:1.
- **Status chips:** 4.7–7.8:1 in both themes.

Every pair meets WCAG AA.

---

## 8. Alternative theme: "Night Court" (dark-first command centre)

This is the third candidate. Like Chambers, it changes only the visual layer, in `src/theme-nightcourt.css`.

**Build:** `.\build.ps1 -Theme nightcourt` produces `nightcourt.html` and `dist/artifact-nightcourt.html`. It opens in dark mode unless the viewer has already chosen a theme.

| | Night Court |
|---|---|
| Mood | A night-shift operations console: blue-slate glass, one signal-teal light |
| Dark ground / surface | `#0A0E13` / `#111821` → `#151D28` gradient tiles |
| Light ground / surface | `#EDF1F5` / `#FFFFFF` |
| Accent | Teal `#36D1BC` (dark), `#0D8C7C` (light); text `#5FE0CE` / `#08695D` |
| Primary action | Teal fill with dark text (dark mode), deep teal with white text (light) |
| Fonts | Geist (all headings and body; no serif), Geist Mono for figures, labels, table headers, case numbers |
| Corners | 4–16px, soft |
| Layout signature | Bento KPI tiles with a teal underline glow, a pill-track tab bar, glass overlays (blurred modals and palette) |
| Case header | Status console: dot-grid texture, teal corner glow, glowing left edge, "vs" as a mono badge |
| Cause slips | Mono item readout; a glowing teal dot marks the next matter |

**Contrast (measured):**
- **Dark:** ink 15.1:1, captions 5.4–5.7:1, teal chips 8.9:1, primary button 9.0:1.
- **Light:** ink 18.1:1, captions 5.4:1, primary button 5.2:1.
- **Status chips:** 4.6–8.3:1 in both modes.

Every pair meets WCAG AA.
