import React, { useState } from "react";
import { fetchCourtDocument, downloadHcOrderPdf } from "../services/courtDocuments";
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

// A table for an array of uniform objects (objections, filed-documents index):
// the union of keys becomes the columns.
function ObjTable({ rows }) {
  const columns = [];
  (rows || []).forEach((r) => Object.keys(r || {}).forEach((k) => { if (!columns.includes(k)) columns.push(k); }));
  if (!columns.length) return null;
  return (
    <div className="cr-table-wrap">
      <table className="cr-table">
        <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{columns.map((c) => <td key={c}>{r?.[c] != null ? String(r[c]) : ""}</td>)}</tr>
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

function EcourtsRecord({ record, courtComplex, onFetchDoc, busyKey, compact }) {
  const cases = record.cases || [];
  const canFetch = typeof onFetchDoc === "function";
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
        const docs = c.documents || [];
        return (
          <div className="cr-case" key={idx}>
            <div className="cr-case-head">
              {c.case_number || `Case ${idx + 1}`}{c.parties ? ` — ${c.parties}` : ""}
            </div>

            {!compact && Object.keys(d.case_details || {}).length > 0 && (
              <section className="cr-sec"><h4>Case Details</h4><KV obj={d.case_details} /></section>
            )}
            {!compact && Object.keys(d.case_status || {}).length > 0 && (
              <section className="cr-sec"><h4>Case Status</h4><KV obj={d.case_status} /></section>
            )}

            {!compact && pet.length > 0 && (
              <section className="cr-sec"><h4>Petitioner(s) &amp; Advocate</h4>
                <ul className="cr-party">
                  {pet.map((p, i) => <li key={i}>{p.name}{p.advocate ? <span className="cr-adv"> — Adv: {p.advocate}</span> : null}</li>)}
                </ul>
              </section>
            )}
            {!compact && res.length > 0 && (
              <section className="cr-sec"><h4>Respondent(s) &amp; Advocate</h4>
                <ul className="cr-party">
                  {res.map((p, i) => <li key={i}>{p.name}{p.advocate ? <span className="cr-adv"> — Adv: {p.advocate}</span> : null}</li>)}
                </ul>
              </section>
            )}

            {!compact && acts.length > 0 && (
              <section className="cr-sec"><h4>Acts</h4>
                <div className="cr-table-wrap"><table className="cr-table">
                  <thead><tr><th>Act</th><th>Section</th></tr></thead>
                  <tbody>{acts.map((a, i) => <tr key={i}><td>{a.act}</td><td>{a.section}</td></tr>)}</tbody>
                </table></div>
              </section>
            )}
            {!compact && history.length > 0 && (
              <section className="cr-sec"><h4>Case History</h4>
                <div className="cr-table-wrap"><table className="cr-table">
                  <thead><tr><th>Judge</th><th>Business Date</th><th>Hearing Date</th><th>Purpose</th><th></th></tr></thead>
                  <tbody>{history.map((h, i) => {
                    const key = `${idx}:h${i}`;
                    return (
                      <tr key={i}>
                        <td>{h.judge}</td><td>{h.business_date}</td><td>{h.hearing_date}</td><td>{h.purpose}</td>
                        <td>{canFetch && h.business ? (
                          <button type="button" className="cr-doc-btn cr-doc-inline" disabled={busyKey === key}
                            onClick={() => onFetchDoc(c, { kind: "hearing_business", token: h.business, label: `Business ${h.business_date}` }, key)}>
                            {busyKey === key ? "…" : "👁 View"}
                          </button>) : null}</td>
                      </tr>
                    );
                  })}</tbody>
                </table></div>
              </section>
            )}
            {!compact && orders.length > 0 && (
              <section className="cr-sec"><h4>Orders / Judgements</h4>
                <div className="cr-table-wrap"><table className="cr-table">
                  <thead><tr><th>#</th><th>Order Date</th><th>Details</th><th></th></tr></thead>
                  <tbody>{orders.map((o, i) => {
                    const key = `${idx}:o${i}`;
                    const hasPdf = o.pdf && o.pdf.filename;
                    return (
                      <tr key={i}>
                        <td>{o.order_number || i + 1}</td><td>{o.order_date}</td><td>{o.order_details}</td>
                        <td>{canFetch && hasPdf ? (
                          <button type="button" className="cr-doc-btn cr-doc-inline" disabled={busyKey === key}
                            onClick={() => onFetchDoc(c, { kind: "order_pdf", token: o.pdf, label: `Order ${o.order_number || ""} ${o.order_date || ""}`.trim() }, key)}>
                            {busyKey === key ? "…" : "⬇ Download"}
                          </button>) : null}</td>
                      </tr>
                    );
                  })}</tbody>
                </table></div>
              </section>
            )}

            {/* Any other section table on the page (Subordinate Court Info, Case
                Transfer Details, etc.), captured generically. */}
            {(d.extra || []).map((sec, si) => (
              (sec.rows && sec.rows.length) ? (
                <section className="cr-sec" key={`x${si}`}><h4>{sec.title || "Details"}</h4>
                  <RowTable rows={sec.rows} />
                </section>
              ) : null
            ))}
          </div>
        );
      })}
    </div>
  );
}

// eCourts High Courts: { cases: [ { case_number, parties, detail:{ case_details,
//   case_status, petitioners[], respondents[], acts[], category, hearings[],
//   orders[{order_number, order_date, judge, pdf_url}] } } ] }.
function HcRecord({ record, compact }) {
  const [busyKey, setBusyKey] = useState("");
  const [docError, setDocError] = useState("");
  const cases = record.cases || [];

  const download = async (url, label, key) => {
    setBusyKey(key); setDocError("");
    try { await downloadHcOrderPdf(url, label); }
    catch (e) { setDocError(e?.message || "Couldn’t fetch the order PDF."); }
    finally { setBusyKey(""); }
  };

  return (
    <div className="cr-record">
      {cases.length === 0 && <p className="cr-note">No detailed record was stored.</p>}
      {cases.map((c, idx) => {
        const d = c.detail || {};
        const pet = d.petitioners || [];
        const res = d.respondents || [];
        const acts = d.acts || [];
        const hearings = d.hearings || [];
        const orders = d.orders || [];
        return (
          <div className="cr-case" key={idx}>
            <div className="cr-case-head">
              {c.case_number || `Case ${idx + 1}`}{c.parties ? ` — ${c.parties}` : ""}
            </div>

            {!compact && Object.keys(d.case_details || {}).length > 0 && (
              <section className="cr-sec"><h4>Case Details</h4><KV obj={d.case_details} /></section>
            )}
            {!compact && Object.keys(d.case_status || {}).length > 0 && (
              <section className="cr-sec"><h4>Case Status</h4><KV obj={d.case_status} /></section>
            )}

            {!compact && pet.length > 0 && (
              <section className="cr-sec"><h4>Petitioner(s) &amp; Advocate</h4>
                <ul className="cr-party">
                  {pet.map((p, i) => <li key={i}>{p.name}{p.advocate ? <span className="cr-adv"> — Adv: {p.advocate}</span> : null}</li>)}
                </ul>
              </section>
            )}
            {!compact && res.length > 0 && (
              <section className="cr-sec"><h4>Respondent(s) &amp; Advocate</h4>
                <ul className="cr-party">
                  {res.map((p, i) => <li key={i}>{p.name}{p.advocate ? <span className="cr-adv"> — Adv: {p.advocate}</span> : null}</li>)}
                </ul>
              </section>
            )}

            {!compact && acts.length > 0 && (
              <section className="cr-sec"><h4>Acts</h4>
                <div className="cr-table-wrap"><table className="cr-table">
                  <thead><tr><th>Act</th><th>Section(s)</th></tr></thead>
                  <tbody>{acts.map((a, i) => <tr key={i}><td>{a.act}</td><td>{a.sections}</td></tr>)}</tbody>
                </table></div>
              </section>
            )}
            {!compact && Object.keys(d.category || {}).length > 0 && (
              <section className="cr-sec"><h4>Category</h4><KV obj={d.category} /></section>
            )}
            {!compact && hearings.length > 0 && (
              <section className="cr-sec"><h4>Hearing History</h4>
                <div className="cr-table-wrap"><table className="cr-table">
                  <thead><tr><th>Cause List</th><th>Judge</th><th>Business Date</th><th>Hearing Date</th><th>Purpose</th></tr></thead>
                  <tbody>{hearings.map((h, i) => (
                    <tr key={i}><td>{h.cause_list_type}</td><td>{h.judge}</td><td>{h.business_on_date}</td><td>{h.hearing_date}</td><td>{h.purpose}</td></tr>
                  ))}</tbody>
                </table></div>
              </section>
            )}
            {!compact && orders.length > 0 && (
              <section className="cr-sec"><h4>Orders / Judgements</h4>
                <div className="cr-table-wrap"><table className="cr-table">
                  <thead><tr><th>#</th><th>Order Date</th><th>Judge</th><th></th></tr></thead>
                  <tbody>{orders.map((o, i) => {
                    const key = `${idx}:o${i}`;
                    return (
                      <tr key={i}>
                        <td>{o.order_number || i + 1}</td><td>{o.order_date}</td><td>{o.judge}</td>
                        <td>{o.pdf_url ? (
                          <button type="button" className="cr-doc-btn cr-doc-inline" disabled={busyKey === key}
                            onClick={() => download(o.pdf_url, `Order ${o.order_number || ""} ${o.order_date || ""}`.trim(), key)}>
                            {busyKey === key ? "…" : "⬇ Download"}
                          </button>) : null}</td>
                      </tr>
                    );
                  })}</tbody>
                </table></div>
              </section>
            )}

            {!compact && (d.objections || []).length > 0 && (
              <section className="cr-sec"><h4>Objections</h4><ObjTable rows={d.objections} /></section>
            )}
            {!compact && (d.documents || []).length > 0 && (
              <section className="cr-sec"><h4>Documents Filed</h4><ObjTable rows={d.documents} /></section>
            )}
          </div>
        );
      })}
      {docError && <p className="cr-note" style={{ color: "#e04f5f" }}>{docError}</p>}
    </div>
  );
}

// Madras HC: { fields, prayer, applications, connected_matters, hearing_history, lower_court, caveats, orders }
function MadrasRecord({ record, compact }) {
  const f = record.fields || {};
  const fieldKeys = Object.keys(f);
  return (
    <div className="cr-record">
      {!compact && fieldKeys.length > 0 && (
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
      {!compact && record.hearing_history?.length > 0 && (
        <section className="cr-sec"><h4>Hearing History</h4><RowTable rows={record.hearing_history} /></section>
      )}
      {record.lower_court?.length > 0 && (
        <section className="cr-sec"><h4>Lower Court</h4><RowTable rows={record.lower_court} /></section>
      )}
      {record.caveats?.length > 0 && (
        <section className="cr-sec"><h4>Caveats</h4><RowTable rows={record.caveats} /></section>
      )}
      {!compact && record.orders?.length > 0 && (
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

// Supreme Court: { diaryNo, parties, fields, sections, html }. Sections are
// stored with their content when the case was imported (case-detail is
// fetched with expand=true at save time); any that came back empty are just
// named so it's clear the court had nothing there rather than that we missed it.
function SciRecord({ record, compact }) {
  const f = record.fields || {};
  const fieldKeys = Object.keys(f);
  const sections = record.sections || [];
  const withData = sections.filter((s) => (s.rows?.length || s.links?.length));
  const withoutData = sections.filter((s) => !(s.rows?.length || s.links?.length));
  return (
    <div className="cr-record">
      {!compact && (record.diaryNo || record.parties) && (
        <section className="cr-sec">
          {record.diaryNo && <h4>Diary No. {record.diaryNo}</h4>}
          {record.parties && <p className="cr-prayer">{record.parties}</p>}
        </section>
      )}
      {!compact && fieldKeys.length > 0 && (
        <section className="cr-sec"><h4>Case Details</h4>
          <dl className="cr-kv">
            {fieldKeys.map((k) => (<div className="cr-kv-row" key={k}><dt>{k}</dt><dd>{String(f[k])}</dd></div>))}
          </dl>
        </section>
      )}
      {withData.map((s) => (
        <section className="cr-sec" key={s.tabName || s.label}><h4>{s.label}</h4>
          {s.rows?.length > 0 && (
            <RowTable rows={s.rows} columns={s.columns?.length ? s.columns : null} />
          )}
          {s.links?.length > 0 && (
            <ul className="cr-links">
              {s.links.map((l, i) => (
                <li key={i}><a href={l.href} target="_blank" rel="noreferrer">{l.text || l.href}</a></li>
              ))}
            </ul>
          )}
        </section>
      ))}
      {withoutData.length > 0 && (
        <section className="cr-sec"><h4>Empty Sections</h4>
          <p className="cr-note">
            The court listed no records under: {withoutData.map((s) => s.label).join(", ")}.
          </p>
        </section>
      )}
    </div>
  );
}

// Does the COMPACT view have anything left to render for this record? Mirrors
// what each compact renderer keeps: SCI → data sections; eCourts HC → nothing
// (identity, category, parties, hearings, orders all live elsewhere); eCourts DC
// → generic "extra" tables; Madras → prayer/applications/etc.
function _compactHasContent(record, courtId) {
  if (!record) return false;
  if (courtId === "sci" || record.diaryNo !== undefined) {
    return (record.sections || []).some((s) => (s.rows?.length || s.links?.length));
  }
  if (courtId === "ecourts_hc") return false;
  if (record.cases !== undefined) {
    return (record.cases || []).some((c) => ((c.detail?.extra) || []).some((sec) => sec.rows?.length));
  }
  return !!(record.prayer || record.applications?.length || record.connected_matters?.length
            || record.lower_court?.length || record.caveats?.length);
}

// Renders a stored/scraped court record for either court shape (raw, unstructured).
// `courtComplex` (the value used for the search) is required to fetch eCourts documents.
// `compact` hides sections that have their own dedicated tabs on the case page
// (identity fields, category, parties, hearings/history, orders) — used by the
// case's trimmed "Extra Details" tab. AddCase's validation view leaves it off to
// show the full record.
export default function CourtRecordView({ record, courtComplex, courtId, compact = false }) {
  const [busyKey, setBusyKey] = useState("");
  const [modal, setModal] = useState(null);
  const [docError, setDocError] = useState("");

  const fetchDoc = async (caseObj, doc, key) => {
    setBusyKey(key);
    setDocError("");
    try {
      const business = await fetchCourtDocument({
        courtComplex,
        viewToken: caseObj.view_token,
        kind: doc.kind,
        token: doc.token,
        label: doc.label,
      });
      if (doc.kind !== "order_pdf" && business) setModal(business);
    } catch (e) {
      setDocError(e?.message || "Couldn’t fetch the document. Please try again.");
    } finally {
      setBusyKey("");
    }
  };

  if (!record) return null;

  // In compact mode almost everything has moved to the header/other tabs, so a
  // record can have nothing left to show here. Detect that and show a note
  // instead of an empty panel. Mirrors what each compact renderer keeps.
  if (compact && !_compactHasContent(record, courtId)) {
    return <p className="cr-note">No further details — everything from the court record is shown in the header and the other tabs.</p>;
  }

  let body;
  if (courtId === "sci" || record.diaryNo !== undefined) {
    body = <SciRecord record={record} compact={compact} />;
  } else if (courtId === "ecourts_hc") {
    body = <HcRecord record={record} compact={compact} />;
  } else if (record.cases !== undefined) {
    body = <EcourtsRecord record={record} courtComplex={courtComplex} onFetchDoc={fetchDoc} busyKey={busyKey} compact={compact} />;
  } else {
    body = <MadrasRecord record={record} compact={compact} />;
  }

  return (
    <>
      {body}
      {docError && <p className="cr-note" style={{ color: "#e04f5f" }}>{docError}</p>}

      {modal && (
        <div className="cr-modal-overlay" onClick={() => setModal(null)}>
          <div className="cr-modal" onClick={(e) => e.stopPropagation()}>
            <div className="cr-modal-head">
              <span>Daily Status</span>
              <button type="button" className="cr-modal-x" onClick={() => setModal(null)}>×</button>
            </div>
            {modal.court && <p className="cr-modal-court">{modal.court}</p>}
            {modal.parties && <p className="cr-modal-parties">{modal.parties}</p>}
            <KV obj={modal.fields || {}} />
          </div>
        </div>
      )}
    </>
  );
}
