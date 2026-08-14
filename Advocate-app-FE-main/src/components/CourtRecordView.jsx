import React from "react";
import "../assets/styles/CourtRecordView.css";

// Known column order for Madras HC row-based sections (API sends headerless rows).
const SECTION_COLUMNS = {
  applications: ["Case No", "Prayer", "Filing Date", "Advocate"],
  connected_matters: ["Case No", "Stage"],
};

function RowTable({ rows, columns }) {
  if (!rows || !rows.length) return null;
  const colCount = columns
    ? columns.length
    : Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 1)), 1);
  return (
    <div className="cr-table-wrap">
      <table className="cr-table">
        {columns && <thead><tr>{columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead>}
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {Array.from({ length: colCount }).map((_, j) => (
                <td key={j}>{Array.isArray(row) ? (row[j] || "") : String(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// eCourts table keys are portal CSS classes ("history_table table") — tidy for display.
function prettyTableName(name) {
  return String(name)
    .replace(/table-bordered/gi, " ")
    .replace(/_/g, " ")
    .replace(/\btable\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim() || "Details";
}

// eCourts: { cases: [ { case_number, parties, detail:{ fields, tables } } ] }
function KV({ obj }) {
  const keys = Object.keys(obj || {});
  if (!keys.length) return null;
  return (
    <dl className="cr-kv">
      {keys.map((k) => (<div className="cr-kv-row" key={k}><dt>{k}</dt><dd>{String(obj[k])}</dd></div>))}
    </dl>
  );
}

function EcourtsRecord({ record }) {
  const cases = record.cases || [];
  return (
    <div className="cr-record">
      {cases.length === 0 && <p className="cr-note">No detailed record was stored.</p>}
      {cases.map((c, idx) => {
        const d = c.detail || {};
        const pet = d.petitioners || [];
        const res = d.respondents || [];
        const acts = d.acts || [];
        const history = d.history || [];
        const orders = d.orders || [];
        return (
          <div className="cr-case" key={idx}>
            <div className="cr-case-head">
              {c.case_number || `Case ${idx + 1}`}{c.parties ? ` — ${c.parties}` : ""}
            </div>

            {Object.keys(d.case_details || {}).length > 0 && (
              <section className="cr-sec"><h4>Case Details</h4><KV obj={d.case_details} /></section>
            )}
            {Object.keys(d.case_status || {}).length > 0 && (
              <section className="cr-sec"><h4>Case Status</h4><KV obj={d.case_status} /></section>
            )}

            {pet.length > 0 && (
              <section className="cr-sec"><h4>Petitioner(s) &amp; Advocate</h4>
                <ul className="cr-party">
                  {pet.map((p, i) => <li key={i}>{p.name}{p.advocate ? <span className="cr-adv"> — Adv: {p.advocate}</span> : null}</li>)}
                </ul>
              </section>
            )}
            {res.length > 0 && (
              <section className="cr-sec"><h4>Respondent(s) &amp; Advocate</h4>
                <ul className="cr-party">
                  {res.map((p, i) => <li key={i}>{p.name}{p.advocate ? <span className="cr-adv"> — Adv: {p.advocate}</span> : null}</li>)}
                </ul>
              </section>
            )}

            {acts.length > 0 && (
              <section className="cr-sec"><h4>Acts</h4>
                <div className="cr-table-wrap"><table className="cr-table">
                  <thead><tr><th>Act</th><th>Section</th></tr></thead>
                  <tbody>{acts.map((a, i) => <tr key={i}><td>{a.act}</td><td>{a.section}</td></tr>)}</tbody>
                </table></div>
              </section>
            )}
            {history.length > 0 && (
              <section className="cr-sec"><h4>Case History</h4>
                <div className="cr-table-wrap"><table className="cr-table">
                  <thead><tr><th>Judge</th><th>Business Date</th><th>Hearing Date</th><th>Purpose</th></tr></thead>
                  <tbody>{history.map((h, i) => <tr key={i}><td>{h.judge}</td><td>{h.business_date}</td><td>{h.hearing_date}</td><td>{h.purpose}</td></tr>)}</tbody>
                </table></div>
              </section>
            )}
            {orders.length > 0 && (
              <section className="cr-sec"><h4>Orders / Judgements</h4>
                <div className="cr-table-wrap"><table className="cr-table">
                  <thead><tr><th>#</th><th>Order Date</th><th>Details</th></tr></thead>
                  <tbody>{orders.map((o, i) => <tr key={i}><td>{o.order_number || i + 1}</td><td>{o.order_date}</td><td>{o.order_details}</td></tr>)}</tbody>
                </table></div>
                <p className="cr-note">Order PDFs are not downloadable from the court at this time.</p>
              </section>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Madras HC: { fields, prayer, applications, connected_matters, hearing_history, lower_court, caveats, orders }
function MadrasRecord({ record }) {
  const f = record.fields || {};
  const fieldKeys = Object.keys(f);
  return (
    <div className="cr-record">
      {fieldKeys.length > 0 && (
        <section className="cr-sec"><h4>Case Details</h4>
          <dl className="cr-kv">
            {fieldKeys.map((k) => (<div className="cr-kv-row" key={k}><dt>{k}</dt><dd>{f[k]}</dd></div>))}
          </dl>
        </section>
      )}
      {record.prayer && (
        <section className="cr-sec"><h4>Prayer</h4><p className="cr-prayer">{record.prayer}</p></section>
      )}
      {record.applications?.length > 0 && (
        <section className="cr-sec"><h4>Applications</h4>
          <RowTable rows={record.applications} columns={SECTION_COLUMNS.applications} /></section>
      )}
      {record.connected_matters?.length > 0 && (
        <section className="cr-sec"><h4>Connected Matters</h4>
          <RowTable rows={record.connected_matters} columns={SECTION_COLUMNS.connected_matters} /></section>
      )}
      {record.hearing_history?.length > 0 && (
        <section className="cr-sec"><h4>Hearing History</h4><RowTable rows={record.hearing_history} /></section>
      )}
      {record.lower_court?.length > 0 && (
        <section className="cr-sec"><h4>Lower Court</h4><RowTable rows={record.lower_court} /></section>
      )}
      {record.caveats?.length > 0 && (
        <section className="cr-sec"><h4>Caveats</h4><RowTable rows={record.caveats} /></section>
      )}
      {record.orders?.length > 0 && (
        <section className="cr-sec"><h4>Orders</h4>
          <div className="cr-table-wrap">
            <table className="cr-table">
              <thead><tr><th>#</th><th>Case</th><th>Order Date</th><th>Judge</th></tr></thead>
              <tbody>
                {record.orders.map((o, i) => (
                  <tr key={i}>
                    <td>{o.sl_no || i + 1}</td><td>{o.case_details || ""}</td>
                    <td>{o.order_date || ""}</td><td>{o.judge || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cr-note">Order PDFs are not downloadable from the court at this time.</p>
        </section>
      )}
    </div>
  );
}

// Renders a stored/scraped court record for either court shape (raw, unstructured).
export default function CourtRecordView({ record }) {
  if (!record) return null;
  const body = record.cases !== undefined
    ? <EcourtsRecord record={record} />
    : <MadrasRecord record={record} />;
  return (
    <>
      {body}
      {/* Guarantees every scraped field is visible even if a section shape is unexpected. */}
      <details className="cr-raw">
        <summary>Raw data (everything fetched)</summary>
        <pre>{JSON.stringify(record, null, 2)}</pre>
      </details>
    </>
  );
}
