import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useParams, Link } from "react-router-dom";
import { Button } from "primereact/button";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { Message } from "primereact/message";
import { InputText } from "primereact/inputtext";
import { ProgressSpinner } from "primereact/progressspinner";
import { apiUrl } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { changePassword, clientDownload, clientGet, fmtDate, inr } from "./clientApi";
import "./client.css";

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

function Loadable({ state, children }: { state: any; children: (data: any) => any }) {
  if (state.loading) return <div className="cl-pad flex justify-content-center"><ProgressSpinner style={{ width: 36, height: 36 }} /></div>;
  if (state.error) return <Message severity="error" text={state.error} className="w-full justify-content-start" />;
  return children(state.data);
}

function StatusPill({ value }: { value: any }) {
  const v = (value || "").toUpperCase();
  const sev = v === "PAID" || v === "CLOSED" || v === "DISPOSED" ? "success" : v === "OVERDUE" ? "danger" : "warning";
  return <Tag value={value || "—"} severity={sev} rounded className="cl-pill" />;
}

function Empty({ children }: { children: any }) {
  return <div className="cl-empty">{children}</div>;
}

// ---- pages ----------------------------------------------------------------

function Home({ account }: { account: any }) {
  const state = useLoad("overview");
  return (
    <>
      <h2>Hello{account.fullName ? `, ${account.fullName.trim()}` : ""}</h2>
      <p className="cl-muted">Here's where your matters with {account.firm?.name || "your advocate"} stand.</p>
      <Loadable state={state}>
        {(o) => (
          <>
            <div className="cl-stats">
              <Link to="/dashboard/cases" className="cl-stat"><span>{o.activeCases}</span>Active cases</Link>
              <Link to="/dashboard/invoices" className="cl-stat"><span>{inr(o.outstandingAmount)}</span>
                {o.outstandingInvoices} invoice{o.outstandingInvoices === 1 ? "" : "s"} due</Link>
              <Link to="/dashboard/documents" className="cl-stat"><span>{o.sharedDocuments}</span>Shared documents</Link>
            </div>
            <section className="cl-card">
              <h3>Upcoming hearings</h3>
              {o.upcomingHearings.length === 0 ? <Empty>No hearings scheduled.</Empty> : (
                <ul className="cl-list">
                  {o.upcomingHearings.map((h: any) => (
                    <li key={h.id}>
                      <div className="cl-date">{fmtDate(h.date)}{h.time ? ` · ${h.time.slice(0, 5)}` : ""}</div>
                      <div>
                        <Link to={`/dashboard/cases/${h.caseId}`} className="cl-strong">{h.caseNumber}</Link>
                        <div className="cl-muted">{h.title}{h.court ? ` · ${h.court}` : ""}{h.bench ? ` · ${h.bench}` : ""}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
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
      <h2>My cases</h2>
      <Loadable state={state}>
        {(cases) => cases.length === 0 ? <Empty>No cases yet.</Empty> : (
          <div className="cl-grid">
            {cases.map((c: any) => (
              <Link key={c.id} to={`/dashboard/cases/${c.id}`} className="cl-card cl-case">
                <div className="cl-row"><span className="cl-strong">{c.caseNumber}</span><StatusPill value={c.status} /></div>
                <div>{c.caseTitle}</div>
                <div className="cl-muted">{[c.caseType, c.courtLevel].filter(Boolean).join(" · ")}</div>
                <div className="cl-muted">
                  Next hearing: {c.nextHearing ? `${fmtDate(c.nextHearing.date)} — ${c.nextHearing.title}` : "not scheduled"}
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
          <Link to="/dashboard/cases" className="cl-link"><i className="pi pi-arrow-left" style={{ fontSize: 11 }} /> All cases</Link>
          <div className="cl-row cl-title-row">
            <h2>{c.caseNumber}</h2><StatusPill value={c.status} />
          </div>
          <p className="cl-lead">{c.caseTitle}</p>
          <p className="cl-muted">
            {[c.caseType, c.courtLevel, c.advocateName && `Handled by ${c.advocateName}`].filter(Boolean).join(" · ")}
          </p>

          <div className="cl-stats">
            <div className="cl-stat"><span>{inr(c.fees.agreed)}</span>Agreed fee</div>
            <div className="cl-stat"><span>{inr(c.fees.paid)}</span>Paid</div>
            <div className="cl-stat"><span>{inr(c.fees.pending)}</span>Outstanding</div>
          </div>

          <section className="cl-card">
            <h3>Hearings</h3>
            {c.hearings.length === 0 ? <Empty>No hearings recorded yet.</Empty> : (
              <ul className="cl-list">
                {c.hearings.map((h: any) => (
                  <li key={h.id}>
                    <div className="cl-date">{fmtDate(h.date)}</div>
                    <div>
                      <div className="cl-strong">{h.title}</div>
                      <div className="cl-muted">
                        {[h.purpose, h.court, h.bench, h.judge && `Before ${h.judge}`].filter(Boolean).join(" · ")}
                      </div>
                      {h.outcome && <div>{h.outcome}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {c.parties.length > 0 && (
            <section className="cl-card">
              <h3>Parties</h3>
              <ul className="cl-list compact">
                {c.parties.map((p: any, i: number) => (
                  <li key={i}><span className="cl-strong">{p.name}</span>
                    <span className="cl-muted">{[p.role, p.counsel && `Counsel: ${p.counsel}`].filter(Boolean).join(" · ")}</span></li>
                ))}
              </ul>
            </section>
          )}

          <section className="cl-card">
            <h3>Documents</h3>
            <DocumentList docs={c.documents} empty="Your advocate hasn't shared documents on this case yet." />
          </section>

          <section className="cl-card">
            <h3>Invoices</h3>
            <InvoiceTable invoices={c.invoices} />
          </section>
        </>
      )}
    </Loadable>
  );
}

function DocumentList({ docs, empty }: { docs: any[]; empty: string }) {
  const [error, setError] = useState("");
  if (!docs.length) return <Empty>{empty}</Empty>;
  const open = (d: any, download: boolean) => clientDownload(`documents/${d.id}/file${download ? "" : "?inline=1"}`, d.originalName,
    { open: !download }).catch((e) => setError(e.message));
  return (
    <>
      {error && <Message severity="error" text={error} className="w-full justify-content-start" />}
      <ul className="cl-list">
        {docs.map((d) => (
          <li key={d.id}>
            <div className="cl-date">{fmtDate(d.uploadedAt)}</div>
            <div className="cl-grow">
              <div className="cl-strong">{d.name}</div>
              <div className="cl-muted">{[d.category, d.caseNumber, d.version > 1 && `v${d.version}`].filter(Boolean).join(" · ")}</div>
            </div>
            <div className="cl-actions">
              <Button size="small" outlined icon="pi pi-eye" label="View" onClick={() => open(d, false)} />
              <Button size="small" outlined icon="pi pi-download" label="Download" onClick={() => open(d, true)} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function InvoiceTable({ invoices }: { invoices: any[] }) {
  const [error, setError] = useState("");
  if (!invoices.length) return <Empty>No invoices.</Empty>;
  return (
    <>
      {error && <Message severity="error" text={error} className="w-full justify-content-start" />}
      <DataTable value={invoices} dataKey="id" size="small" scrollable>
        <Column header="Invoice" body={(i) => <span className="cl-strong">{i.invoiceNumber}</span>} />
        <Column header="Case" body={(i) => i.caseNumber || "—"} />
        <Column header="Date" body={(i) => fmtDate(i.invoiceDate)} />
        <Column header="Due" body={(i) => fmtDate(i.dueDate)} />
        <Column header="Amount" body={(i) => inr(i.amount)} />
        <Column header="Status" body={(i) => <StatusPill value={i.status} />} />
        <Column body={(i) => (
          <Button size="small" outlined icon="pi pi-file-pdf" label="PDF"
            onClick={() => clientDownload(`invoices/${i.id}/pdf`, `${i.invoiceNumber}.pdf`).catch((e) => setError(e.message))} />
        )} />
      </DataTable>
    </>
  );
}

function Invoices() {
  const invoices = useLoad("invoices");
  const payments = useLoad("payments");
  return (
    <>
      <h2>Invoices & payments</h2>
      <section className="cl-card"><h3>Invoices</h3>
        <Loadable state={invoices}>{(list) => <InvoiceTable invoices={list} />}</Loadable>
      </section>
      <section className="cl-card"><h3>Payments received</h3>
        <Loadable state={payments}>
          {(list) => list.length === 0 ? <Empty>No payments recorded.</Empty> : (
            <DataTable value={list} dataKey="id" size="small" scrollable>
              <Column header="Date" body={(p) => fmtDate(p.date)} />
              <Column header="Amount" body={(p) => <span className="cl-strong">{inr(p.amount)}</span>} />
              <Column header="Mode" body={(p) => p.mode || "—"} />
              <Column header="Reference" body={(p) => p.reference || "—"} />
              <Column header="Case" body={(p) => p.caseNumber || "—"} />
            </DataTable>
          )}
        </Loadable>
      </section>
    </>
  );
}

function Documents() {
  const state = useLoad("documents");
  return (
    <>
      <h2>Documents</h2>
      <p className="cl-muted">Documents your advocate has shared with you.</p>
      <section className="cl-card">
        <Loadable state={state}>{(docs) => <DocumentList docs={docs} empty="Nothing has been shared with you yet." />}</Loadable>
      </section>
    </>
  );
}

function Messages() {
  const state = useLoad("messages");
  return (
    <>
      <h2>Messages</h2>
      <p className="cl-muted">Updates your advocate's office has sent you.</p>
      <Loadable state={state}>
        {(list) => list.length === 0 ? <Empty>No messages yet.</Empty> : (
          <div className="cl-stack">
            {list.map((m: any) => (
              <section key={m.id} className="cl-card">
                <div className="cl-row"><span className="cl-strong">{m.subject}</span>
                  <span className="cl-muted">{fmtDate(m.createdAt)}</span></div>
                <pre className="cl-message">{m.body}</pre>
              </section>
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
  const [msg, setMsg] = useState<{ type: any; text: string }>({ type: "", text: "" });
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
      <h2>My account</h2>
      <section className="cl-card">
        <h3>Contact details</h3>
        <dl className="cl-dl">
          <dt>Signed in as</dt><dd>{account.fullName || "—"} ({account.email})</dd>
          <dt>Client</dt><dd>{c.name}</dd>
          <dt>Phone</dt><dd>{c.phone || "—"}</dd>
          <dt>Address</dt><dd>{c.address || "—"}</dd>
        </dl>
        <p className="cl-muted">To change these, contact {account.firm?.name || "your advocate"}
          {account.firm?.phone ? ` on ${account.firm.phone}` : ""}.</p>
      </section>
      <section className="cl-card">
        <h3>Change password</h3>
        <form className="cl-form narrow" onSubmit={submit}>
          {msg.text && <Message severity={msg.type} text={msg.text} className="w-full justify-content-start" />}
          <label htmlFor="cl-cur">Current password</label>
          <InputText id="cl-cur" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          <label htmlFor="cl-next">New password (at least 8 characters)</label>
          <InputText id="cl-next" type="password" autoComplete="new-password" minLength={8} required value={next} onChange={(e) => setNext(e.target.value)} />
          <Button type="submit" className="mt-2" label={busy ? "Saving…" : "Change password"} loading={busy} disabled={busy} />
        </form>
      </section>
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

  if (error) return <div className="cl-auth"><Message severity="error" text={error} /></div>;
  if (!account) return <div className="cl-auth"><ProgressSpinner style={{ width: 40, height: 40 }} /></div>;
  const firm = account.firm || {};

  return (
    <div className="cl-shell">
      <header className="cl-header">
        <div className="cl-firm">
          {firm.logoUrl && <img src={apiUrl(firm.logoUrl)} alt="" />}
          <div>
            <div className="cl-strong">{firm.name || "Your advocate"}</div>
            <div className="cl-muted">{account.client.name}</div>
          </div>
        </div>
        <Button outlined size="small" icon="pi pi-sign-out" label="Sign out" onClick={logout} />
      </header>
      <nav className="cl-nav">
        {NAV.map(([to, label]) => (
          <NavLink key={to} to={to ? `/dashboard/${to}` : "/dashboard"} end={to === ""}
            className={({ isActive }) => `cl-nav-link${isActive ? " active" : ""}`}>{label}</NavLink>
        ))}
      </nav>
      <main className="cl-main">
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
        <footer className="cl-footer">{[firm.name, firm.address, firm.phone, firm.email].filter(Boolean).join(" · ")}</footer>
      )}
    </div>
  );
}
