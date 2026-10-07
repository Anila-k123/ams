import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Navigate, Route, Routes, useParams, Link } from "react-router-dom";
import { apiUrl } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { Avatar, Button, EmptyState, Icon, Panel, Skel, StatusChip } from "../ui/kit";
import { DataTable, type Column } from "../ui/DataTable";
import { ThemeToggle, PasswordField } from "../pages/Login";
import { changePassword, clientDownload, clientGet, fmtDate, inr } from "./clientApi";
import "../ui/pages/portal.css";

// What a Client-role user sees after signing in at the normal /login (rendered for
// /dashboard/* instead of the firm app). Read-only: everything comes from /api/client/*,
// which only ever returns this client's own matters; the backend refuses every firm
// endpoint for client users (clientaccess/gate.py), so this view is not the safeguard.

function useLoad(path: string) {
  const [state, setState] = useState<{ data: any; error: string; loading: boolean }>({ data: null, error: "", loading: true });
  useEffect(() => {
    let alive = true;
    setState({ data: null, error: "", loading: true });
    clientGet(path)
      .then((data) => alive && setState({ data, error: "", loading: false }))
      .catch((err) => alive && setState({ data: null, error: err.message, loading: false }));
    return () => { alive = false; };
  }, [path]);
  return state;
}

function ErrorNote({ children }: { children: ReactNode }) {
  return <div className="callout bad" role="alert"><Icon name="warn" /><div>{children}</div></div>;
}

function Loadable({ state, children }: { state: any; children: (data: any) => any }) {
  if (state.loading) return <div className="stack" aria-busy="true"><Skel h={18} w="40%" /><Skel h={64} /><Skel h={64} /></div>;
  if (state.error) return <ErrorNote>{state.error}</ErrorNote>;
  return children(state.data);
}

// Date stamp (month over day), as in the hearings lists.
function Stamp({ date }: { date: any }) {
  if (!date) return null;
  const d = new Date(date);
  return (
    <div className="stamp" aria-hidden="true">
      <span>{d.toLocaleDateString("en-IN", { month: "short" })}</span><b>{d.getDate()}</b>
    </div>
  );
}

// ---- pages ----------------------------------------------------------------

function Home({ account }: { account: any }) {
  const state = useLoad("overview");
  const hr = new Date().getHours();
  const name = account.fullName?.trim() || account.client?.name;
  return (
    <>
      <h1 className="serif pt-h">Good {hr < 12 ? "morning" : hr < 17 ? "afternoon" : "evening"}{name ? `, ${name}` : ""}</h1>
      <p className="muted pt-lead">Here is where your matters stand with {account.firm?.name || "your advocate"}.</p>
      <Loadable state={state}>
        {(o) => (
          <>
            <div className="figures pt-figs">
              <Link to="/dashboard/cases" className="figure"><div className="lbl">Active cases</div><div className="val">{o.activeCases}</div></Link>
              <Link to="/dashboard/invoices" className="figure"><div className="lbl">Outstanding fees</div><div className="val">{inr(o.outstandingAmount)}</div>
                <div className="meta">{o.outstandingInvoices} invoice{o.outstandingInvoices === 1 ? "" : "s"} due</div></Link>
              <Link to="/dashboard/documents" className="figure"><div className="lbl">Shared documents</div><div className="val">{o.sharedDocuments}</div></Link>
            </div>
            <div className="section-title pt-st"><h2>Upcoming hearings</h2></div>
            <div className="panel"><div className="list">
              {o.upcomingHearings.length === 0
                ? <EmptyState icon="calendar" title="No hearings scheduled" text="Your advocate will add the next date after the court lists it." />
                : o.upcomingHearings.map((h: any) => (
                  <Link key={h.id} to={`/dashboard/cases/${h.caseId}`} className="list-item">
                    <Stamp date={h.date} />
                    <div className="grow">
                      <div className="mono small">{h.caseNumber}</div>
                      <div className="pt-strong">{h.title}</div>
                      <div className="faint xs">{[h.court, h.bench].filter(Boolean).join(", ") || fmtDate(h.date)}</div>
                    </div>
                    <div className="right small">{h.time && <b className="mono">{h.time.slice(0, 5)}</b>}<div className="faint xs">{fmtDate(h.date)}</div></div>
                  </Link>
                ))}
            </div></div>
          </>
        )}
      </Loadable>
    </>
  );
}

function Cases() {
  const state = useLoad("cases");
  return (
    <>
      <h1 className="serif pt-h pt-h-gap">My cases</h1>
      <Loadable state={state}>
        {(cases) => cases.length === 0
          ? <EmptyState icon="case" title="No cases yet" text="Matters your advocate opens for you appear here." />
          : (
            <div className="cols g-2">
              {cases.map((c: any) => (
                <Link key={c.id} to={`/dashboard/cases/${c.id}`} className="panel pp-case-card">
                  <div className="row between"><span className="mono small muted">{c.caseNumber}</span><StatusChip status={c.status} /></div>
                  <h3 className="pt-case-title">{c.caseTitle}</h3>
                  <div className="faint small">{[c.caseType, c.courtLevel].filter(Boolean).join(" · ")}</div>
                  <div className="row between pt-case-foot">
                    <span className="small">Next hearing</span>
                    <span className="small">{c.nextHearing ? <><b>{fmtDate(c.nextHearing.date)}</b> {c.nextHearing.title}</> : <span className="faint">Not scheduled</span>}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
      </Loadable>
    </>
  );
}

function CaseDetail() {
  const { id } = useParams();
  const state = useLoad(`cases/${id}`);
  return (
    <Loadable state={state}>
      {(c) => (
        <>
          <Link to="/dashboard/cases" className="link small">My cases</Link>
          <div className="docket pt-docket">
            <div className="no">{c.caseNumber}</div>
            <h1>{c.caseTitle}</h1>
            <div className="meta-line">
              {c.caseType && <span><Icon name="scale" size="sm" />{c.caseType}</span>}
              {c.courtLevel && <span><Icon name="pin" size="sm" />{c.courtLevel}</span>}
              <span><StatusChip status={c.status} /></span>
              {c.advocateName && <span>Handled by {c.advocateName}</span>}
            </div>
          </div>

          <div className="figures pt-figs-sm">
            <div className="figure"><div className="lbl">Fees agreed</div><div className="val">{inr(c.fees.agreed)}</div></div>
            <div className="figure"><div className="lbl">Paid</div><div className="val">{inr(c.fees.paid)}</div></div>
            <div className="figure"><div className="lbl">Outstanding</div><div className={`val${Number(c.fees.pending) > 0 ? " pt-warn" : ""}`}>{inr(c.fees.pending)}</div></div>
          </div>

          <div className="cols g-2 pt-top">
            <Panel title="Hearings">
              {c.hearings.length === 0 ? <p className="faint small">No hearings recorded yet.</p> : (
                <div className="timeline">
                  {c.hearings.map((h: any) => (
                    <div key={h.id} className="tl-item">
                      <div className="small"><b>{fmtDate(h.date)}</b>, {h.title}</div>
                      <div className="when">{[h.purpose, h.court, h.bench, h.judge && `Before ${h.judge}`].filter(Boolean).join(" · ")}</div>
                      {h.outcome && <div className="small">{h.outcome}</div>}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
            <div className="stack pt-gap">
              {c.parties.length > 0 && (
                <Panel title="Parties">
                  <dl className="kv">
                    {c.parties.map((p: any, i: number) => (
                      <div key={i} className="pt-kv-row">
                        <dt>{p.role || "Party"}</dt>
                        <dd><b>{p.name}</b>{p.counsel && <div className="faint xs">Counsel: {p.counsel}</div>}</dd>
                      </div>
                    ))}
                  </dl>
                </Panel>
              )}
              <Panel title="Shared documents" flush>
                <DocumentList docs={c.documents} empty="Your advocate hasn't shared documents on this case yet." compact />
              </Panel>
            </div>
          </div>

          <div className="section-title"><h2>Invoices</h2></div>
          <InvoiceTable invoices={c.invoices} />
        </>
      )}
    </Loadable>
  );
}

function DocumentList({ docs, empty, compact }: { docs: any[]; empty: string; compact?: boolean }) {
  const [error, setError] = useState("");
  if (!docs.length) return compact ? <div className="list"><div className="list-item faint small">{empty}</div></div>
    : <EmptyState icon="folder" title="Nothing shared yet" text={empty} />;
  const open = (d: any, download: boolean) => clientDownload(`documents/${d.id}/file${download ? "" : "?inline=1"}`, d.originalName,
    { open: !download }).catch((e) => setError(e.message));
  return (
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="list">
        {docs.map((d) => (
          <div key={d.id} className="list-item pt-doc">
            <Icon name="file" />
            <div className="grow">
              <div className="small pt-strong ellipsis">{d.name}</div>
              <div className="faint xs">{[fmtDate(d.uploadedAt), d.category, d.caseNumber, d.version > 1 && `v${d.version}`].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="row">
              <Button size="sm" icon="eye" onClick={() => open(d, false)} aria-label={`View ${d.name}`}>View</Button>
              <Button size="sm" variant="ghost" icon="download" onClick={() => open(d, true)} aria-label={`Download ${d.name}`}>Download</Button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function InvoiceTable({ invoices }: { invoices: any[] }) {
  const [error, setError] = useState("");
  const columns: Column<any>[] = [
    { key: "invoiceNumber", label: "Invoice", sort: true, render: (i) => <span className="mono">{i.invoiceNumber}</span> },
    { key: "caseNumber", label: "Case", render: (i) => <span className="small">{i.caseNumber || "—"}</span> },
    { key: "invoiceDate", label: "Date", hideSm: true, sort: (i) => i.invoiceDate, render: (i) => fmtDate(i.invoiceDate) },
    { key: "dueDate", label: "Due", hideSm: true, sort: (i) => i.dueDate, render: (i) => fmtDate(i.dueDate) },
    { key: "amount", label: "Amount", align: "right", sort: (i) => Number(i.amount), render: (i) => inr(i.amount) },
    { key: "status", label: "Status", render: (i) => <StatusChip status={i.status} /> },
    { key: "pdf", label: <span className="sr-only">Actions</span>, render: (i) => (
      <Button size="sm" variant="ghost" icon="download" aria-label={`Download ${i.invoiceNumber} as PDF`}
        onClick={() => clientDownload(`invoices/${i.id}/pdf`, `${i.invoiceNumber}.pdf`).catch((e) => setError(e.message))}>PDF</Button>
    ) },
  ];
  return (
    <>
      {error && <ErrorNote>{error}</ErrorNote>}
      <DataTable rows={invoices} columns={columns} rowKey={(i) => i.id} pageSize={0}
        empty={{ icon: "receipt", title: "No invoices", text: "Invoices from your advocate appear here." }} />
    </>
  );
}

const PAYMENT_COLS: Column<any>[] = [
  { key: "date", label: "Date", sort: (p) => p.date, render: (p) => <span className="nowrap">{fmtDate(p.date)}</span> },
  { key: "caseNumber", label: "Case", render: (p) => <span className="small">{p.caseNumber || "—"}</span> },
  { key: "mode", label: "Mode", hideSm: true, render: (p) => p.mode || "—" },
  { key: "reference", label: "Reference", hideSm: true, render: (p) => <span className="mono small">{p.reference || "—"}</span> },
  { key: "amount", label: "Amount", align: "right", sort: (p) => Number(p.amount), render: (p) => <b>{inr(p.amount)}</b> },
];

function Invoices() {
  const invoices = useLoad("invoices");
  const payments = useLoad("payments");
  return (
    <>
      <h1 className="serif pt-h pt-h-gap">Invoices</h1>
      <Loadable state={invoices}>{(list) => <InvoiceTable invoices={list} />}</Loadable>
      <div className="section-title"><h2>Payments received</h2></div>
      <Loadable state={payments}>
        {(list) => (
          <DataTable rows={list} columns={PAYMENT_COLS} rowKey={(p) => p.id} pageSize={0}
            empty={{ icon: "wallet", title: "No payments recorded" }} />
        )}
      </Loadable>
    </>
  );
}

function Documents() {
  const state = useLoad("documents");
  return (
    <>
      <h1 className="serif pt-h">Documents</h1>
      <p className="muted pt-lead">Files your advocate has shared with you.</p>
      <Loadable state={state}>
        {(docs) => docs.length === 0
          ? <EmptyState icon="folder" title="Nothing shared yet" text="Documents appear here when your advocate shares them." />
          : <div className="panel"><DocumentList docs={docs} empty="" /></div>}
      </Loadable>
    </>
  );
}

function Messages() {
  const state = useLoad("messages");
  return (
    <>
      <h1 className="serif pt-h">Messages</h1>
      <p className="muted pt-lead">Updates your advocate's office has sent you.</p>
      <Loadable state={state}>
        {(list) => list.length === 0 ? <EmptyState icon="mail" title="No messages yet" text="Updates from your advocate's office appear here." /> : (
          <div className="stack pt-gap">
            {list.map((m: any) => (
              <article key={m.id} className="panel">
                <div className="panel-head"><h3>{m.subject}</h3><span className="faint xs nowrap">{fmtDate(m.createdAt)}</span></div>
                <div className="panel-body"><div className="pp-msg-body">{m.body}</div></div>
              </article>
            ))}
          </div>
        )}
      </Loadable>
    </>
  );
}

function Account({ account }: { account: any }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ type: string; text: string }>({ type: "", text: "" });
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg({ type: "", text: "" });
    try {
      const r = await changePassword(current, next);
      setMsg({ type: "success", text: r.message }); setCurrent(""); setNext("");
    } catch (err: any) {
      setMsg({ type: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  };
  const c = account.client;
  return (
    <>
      <h1 className="serif pt-h pt-h-gap">Account</h1>
      <div className="cols g-2 pt-top">
        <Panel title="Your details">
          <dl className="kv">
            <dt>Signed in as</dt><dd>{account.fullName || "—"} ({account.email})</dd>
            <dt>Client</dt><dd>{c.name}</dd>
            <dt>Phone</dt><dd className="num">{c.phone || "—"}</dd>
            <dt>Address</dt><dd>{c.address || "—"}</dd>
          </dl>
          <p className="faint xs pt-note">To change these, contact {account.firm?.name || "your advocate"}
            {account.firm?.phone ? ` on ${account.firm.phone}` : ""}.</p>
        </Panel>
        <Panel title="Change password">
          <form className="stack" onSubmit={submit}>
            {msg.text && (msg.type === "success"
              ? <div className="callout ok" role="status"><Icon name="ok" /><div>{msg.text}</div></div>
              : <ErrorNote>{msg.text}</ErrorNote>)}
            <PasswordField label="Current password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
            <PasswordField label="New password (at least 8 characters)" autoComplete="new-password" minLength={8} required value={next} onChange={(e) => setNext(e.target.value)} />
            <div><Button type="submit" variant="primary" loading={busy} disabled={busy}>{busy ? "Saving…" : "Change password"}</Button></div>
          </form>
        </Panel>
      </div>
    </>
  );
}

// ---- shell ----------------------------------------------------------------

const NAV: [string, string][] = [
  ["", "Home"], ["cases", "My cases"], ["invoices", "Invoices"], ["documents", "Documents"],
  ["messages", "Messages"], ["account", "Account"],
];

export default function ClientApp() {
  const { logout } = useAuth();
  const [account, setAccount] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    clientGet("me").then(setAccount).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="portal pt-center"><ErrorNote>{error}</ErrorNote></div>;
  if (!account) return <div className="portal pt-center"><span className="faint small" role="status">Loading your portal…</span></div>;
  const firm = account.firm || {};
  const firmName = firm.name || "Your advocate";

  return (
    <div className="portal">
      <header className="portal-top">
        <div className="in">
          {firm.logoUrl
            ? <img className="pt-logo" src={apiUrl(firm.logoUrl)} alt="" />
            : <span className="seal" aria-hidden="true">{firmName.trim()[0]?.toUpperCase()}</span>}
          <div className="grow">
            <b className="serif pt-firm">{firmName}</b>
            <div className="faint xs">Client portal</div>
          </div>
          <div className="row who"><Avatar name={account.client.name} size="sm" /><span className="small">{account.client.name}</span></div>
          <ThemeToggle />
          <Button size="sm" icon="logout" onClick={logout}>Sign out</Button>
        </div>
        <nav className="portal-nav" aria-label="Portal">
          {NAV.map(([to, label]) => (
            <NavLink key={to} to={to ? `/dashboard/${to}` : "/dashboard"} end={to === ""}>{label}</NavLink>
          ))}
        </nav>
      </header>
      <main className="portal-body">
        <Routes>
          <Route index element={<Home account={account} />} />
          <Route path="cases" element={<Cases />} />
          <Route path="cases/:id" element={<CaseDetail />} />
          <Route path="invoices" element={<Invoices />} />
          <Route path="documents" element={<Documents />} />
          <Route path="messages" element={<Messages />} />
          <Route path="account" element={<Account account={account} />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
      {(firm.address || firm.email) && (
        <footer className="portal-foot">
          <div className="in"><b className="pt-foot-firm">{firm.name}</b>{[firm.address, firm.phone, firm.email].filter(Boolean).map((x: string) => <span key={x}>{x}</span>)}</div>
        </footer>
      )}
    </div>
  );
}
