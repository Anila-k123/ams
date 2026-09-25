import { useState } from "react";
import type { ReactNode } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { fetchCourtDocument, downloadHcOrderPdf } from "../services/courtDocuments";
import "../assets/styles/CourtRecordView.css";

// Known column order for Madras HC row-based sections (API sends headerless rows).
const SECTION_COLUMNS: Record<string, string[]> = {
  applications: ["Case No", "Prayer", "Filing Date", "Advocate"],
  connected_matters: ["Case No", "Stage"],
};

type ColDef = { header?: string; body: (row: any, i: number) => ReactNode };

// One small PrimeReact table used by every record section. `showHeader` is off
// for the headerless row sections the court APIs send.
function Tbl({ rows, cols, showHeader = true }: { rows: any[]; cols: ColDef[]; showHeader?: boolean }) {
  const value = rows.map((r, i) => ({ __i: i, __r: r }));
  return (
    <div className="cr-table-wrap">
      <DataTable value={value} size="small" dataKey="__i" showHeaders={showHeader} className="cr-dt" stripedRows>
        {cols.map((c, j) => (
          <Column key={j} header={c.header || ""} body={(row: any) => c.body(row.__r, row.__i)} />
        ))}
      </DataTable>
    </div>
  );
}

function RowTable({ rows, columns }: { rows: any[]; columns?: string[] | null }) {
  if (!rows || !rows.length) return null;
  const colCount = columns
    ? columns.length
    : Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 1)), 1);
  const cols: ColDef[] = Array.from({ length: colCount }).map((_, j) => ({
    header: columns ? columns[j] : "",
    body: (row: any) => (Array.isArray(row) ? (row[j] || "") : String(row)),
  }));
  return <Tbl rows={rows} cols={cols} showHeader={!!columns} />;
}

// A table for an array of uniform objects (objections, filed-documents index):
// the union of keys becomes the columns.
function ObjTable({ rows }: { rows: any[] }) {
  const columns: string[] = [];
  (rows || []).forEach((r) => Object.keys(r || {}).forEach((k) => { if (!columns.includes(k)) columns.push(k); }));
  if (!columns.length) return null;
  return <Tbl rows={rows} cols={columns.map((c) => ({ header: c, body: (r: any) => (r?.[c] != null ? String(r[c]) : "") }))} />;
}

function KV({ obj }: { obj: any }) {
  const keys = Object.keys(obj || {});
  if (!keys.length) return null;
  return (
    <dl className="cr-kv">
      {keys.map((k) => (<div className="cr-kv-row" key={k}><dt>{k}</dt><dd>{String(obj[k])}</dd></div>))}
    </dl>
  );
}

function Parties({ title, list }: { title: string; list: any[] }) {
  return (
    <section className="cr-sec"><h4>{title}</h4>
      <ul className="cr-party">
        {list.map((p, i) => <li key={i}>{p.name}{p.advocate ? <span className="cr-adv"> — Adv: {p.advocate}</span> : null}</li>)}
      </ul>
    </section>
  );
}

function DocButton({ busy, icon, label, onClick }: { busy: boolean; icon: string; label: string; onClick: () => void }) {
  return (
    <Button type="button" size="small" outlined label={busy ? "…" : label} icon={busy ? undefined : icon}
      disabled={busy} onClick={onClick} className="cr-doc-inline" />
  );
}

// eCourts: { cases: [ { case_number, parties, detail:{ fields, tables } } ] }
function EcourtsRecord({ record, onFetchDoc, busyKey, compact }: any) {
  const cases = record.cases || [];
  const canFetch = typeof onFetchDoc === "function";
  return (
    <div className="cr-record">
      {cases.length === 0 && <p className="cr-note">No detailed record was stored.</p>}
      {cases.map((c: any, idx: number) => {
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

            {!compact && Object.keys(d.case_details || {}).length > 0 && (
              <section className="cr-sec"><h4>Case Details</h4><KV obj={d.case_details} /></section>
            )}
            {!compact && Object.keys(d.case_status || {}).length > 0 && (
              <section className="cr-sec"><h4>Case Status</h4><KV obj={d.case_status} /></section>
            )}
            {!compact && pet.length > 0 && <Parties title="Petitioner(s) & Advocate" list={pet} />}
            {!compact && res.length > 0 && <Parties title="Respondent(s) & Advocate" list={res} />}

            {!compact && acts.length > 0 && (
              <section className="cr-sec"><h4>Acts</h4>
                <Tbl rows={acts} cols={[{ header: "Act", body: (a) => a.act }, { header: "Section", body: (a) => a.section }]} />
              </section>
            )}
            {!compact && history.length > 0 && (
              <section className="cr-sec"><h4>Case History</h4>
                <Tbl rows={history} cols={[
                  { header: "Judge", body: (h) => h.judge },
                  { header: "Business Date", body: (h) => h.business_date },
                  { header: "Hearing Date", body: (h) => h.hearing_date },
                  { header: "Purpose", body: (h) => h.purpose },
                  { header: "", body: (h, i) => {
                    const key = `${idx}:h${i}`;
                    return canFetch && h.business ? (
                      <DocButton busy={busyKey === key} icon="pi pi-eye" label="View"
                        onClick={() => onFetchDoc(c, { kind: "hearing_business", token: h.business, label: `Business ${h.business_date}` }, key)} />
                    ) : null;
                  } },
                ]} />
              </section>
            )}
            {!compact && orders.length > 0 && (
              <section className="cr-sec"><h4>Orders / Judgements</h4>
                <Tbl rows={orders} cols={[
                  { header: "#", body: (o, i) => o.order_number || i + 1 },
                  { header: "Order Date", body: (o) => o.order_date },
                  { header: "Details", body: (o) => o.order_details },
                  { header: "", body: (o, i) => {
                    const key = `${idx}:o${i}`;
                    const hasPdf = o.pdf && o.pdf.filename;
                    return canFetch && hasPdf ? (
                      <DocButton busy={busyKey === key} icon="pi pi-download" label="Download"
                        onClick={() => onFetchDoc(c, { kind: "order_pdf", token: o.pdf, label: `Order ${o.order_number || ""} ${o.order_date || ""}`.trim() }, key)} />
                    ) : null;
                  } },
                ]} />
              </section>
            )}

            {/* Any other section table on the page (Subordinate Court Info, Case
                Transfer Details, etc.), captured generically. */}
            {(d.extra || []).map((sec: any, si: number) => (
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
function HcRecord({ record, compact }: any) {
  const [busyKey, setBusyKey] = useState("");
  const [docError, setDocError] = useState("");
  const cases = record.cases || [];

  const download = async (url: string, label: string, key: string) => {
    setBusyKey(key); setDocError("");
    try { await (downloadHcOrderPdf as any)(url, label); }
    catch (e: any) { setDocError(e?.message || "Couldn’t fetch the order PDF."); }
    finally { setBusyKey(""); }
  };

  return (
    <div className="cr-record">
      {cases.length === 0 && <p className="cr-note">No detailed record was stored.</p>}
      {cases.map((c: any, idx: number) => {
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
            {!compact && pet.length > 0 && <Parties title="Petitioner(s) & Advocate" list={pet} />}
            {!compact && res.length > 0 && <Parties title="Respondent(s) & Advocate" list={res} />}

            {!compact && acts.length > 0 && (
              <section className="cr-sec"><h4>Acts</h4>
                <Tbl rows={acts} cols={[{ header: "Act", body: (a) => a.act }, { header: "Section(s)", body: (a) => a.sections }]} />
              </section>
            )}
            {!compact && Object.keys(d.category || {}).length > 0 && (
              <section className="cr-sec"><h4>Category</h4><KV obj={d.category} /></section>
            )}
            {!compact && hearings.length > 0 && (
              <section className="cr-sec"><h4>Hearing History</h4>
                <Tbl rows={hearings} cols={[
                  { header: "Cause List", body: (h) => h.cause_list_type },
                  { header: "Judge", body: (h) => h.judge },
                  { header: "Business Date", body: (h) => h.business_on_date },
                  { header: "Hearing Date", body: (h) => h.hearing_date },
                  { header: "Purpose", body: (h) => h.purpose },
                ]} />
              </section>
            )}
            {!compact && orders.length > 0 && (
              <section className="cr-sec"><h4>Orders / Judgements</h4>
                <Tbl rows={orders} cols={[
                  { header: "#", body: (o, i) => o.order_number || i + 1 },
                  { header: "Order Date", body: (o) => o.order_date },
                  { header: "Judge", body: (o) => o.judge },
                  { header: "", body: (o, i) => {
                    const key = `${idx}:o${i}`;
                    return o.pdf_url ? (
                      <DocButton busy={busyKey === key} icon="pi pi-download" label="Download"
                        onClick={() => download(o.pdf_url, `Order ${o.order_number || ""} ${o.order_date || ""}`.trim(), key)} />
                    ) : null;
                  } },
                ]} />
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
      {docError && <p className="cr-note cr-error">{docError}</p>}
    </div>
  );
}

// Madras HC: { fields, prayer, applications, connected_matters, hearing_history, lower_court, caveats, orders }
function MadrasRecord({ record, compact }: any) {
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
          <Tbl rows={record.orders} cols={[
            { header: "#", body: (o, i) => o.sl_no || i + 1 },
            { header: "Case", body: (o) => o.case_details || "" },
            { header: "Order Date", body: (o) => o.order_date || "" },
            { header: "Judge", body: (o) => o.judge || "" },
          ]} />
          <p className="cr-note">Order PDFs are not downloadable from the court at this time.</p>
        </section>
      )}
    </div>
  );
}

// Supreme Court: { diaryNo, parties, fields, sections, html }. Sections are
// stored with their content when the case was imported; any that came back
// empty are just named so it's clear the court had nothing there.
function SciRecord({ record, compact }: any) {
  const f = record.fields || {};
  const fieldKeys = Object.keys(f);
  const sections: any[] = record.sections || [];
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
              {s.links.map((l: any, i: number) => (
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

// Does the COMPACT view have anything left to render for this record?
function _compactHasContent(record: any, courtId: any) {
  if (!record) return false;
  if (courtId === "sci" || record.diaryNo !== undefined) {
    return (record.sections || []).some((s: any) => (s.rows?.length || s.links?.length));
  }
  if (courtId === "ecourts_hc") return false;
  if (record.cases !== undefined) {
    return (record.cases || []).some((c: any) => ((c.detail?.extra) || []).some((sec: any) => sec.rows?.length));
  }
  return !!(record.prayer || record.applications?.length || record.connected_matters?.length
            || record.lower_court?.length || record.caveats?.length);
}

// Renders a stored/scraped court record for any court shape.
// `courtComplex` is required to fetch eCourts documents. `compact` hides
// sections that have their own tabs on the case page.
export default function CourtRecordView({ record, courtComplex, courtId, compact = false }: {
  record: any; courtComplex?: any; courtId?: any; compact?: boolean;
}) {
  const [busyKey, setBusyKey] = useState("");
  const [modal, setModal] = useState<any>(null);
  const [docError, setDocError] = useState("");

  const fetchDoc = async (caseObj: any, doc: any, key: string) => {
    setBusyKey(key);
    setDocError("");
    try {
      const business = await (fetchCourtDocument as any)({
        courtComplex,
        viewToken: caseObj.view_token,
        kind: doc.kind,
        token: doc.token,
        label: doc.label,
      });
      if (doc.kind !== "order_pdf" && business) setModal(business);
    } catch (e: any) {
      setDocError(e?.message || "Couldn’t fetch the document. Please try again.");
    } finally {
      setBusyKey("");
    }
  };

  if (!record) return null;

  if (compact && !_compactHasContent(record, courtId)) {
    return <p className="cr-note">No further details — everything from the court record is shown in the header and the other tabs.</p>;
  }

  let body;
  if (courtId === "sci" || record.diaryNo !== undefined) {
    body = <SciRecord record={record} compact={compact} />;
  } else if (courtId === "ecourts_hc") {
    body = <HcRecord record={record} compact={compact} />;
  } else if (record.cases !== undefined) {
    body = <EcourtsRecord record={record} onFetchDoc={fetchDoc} busyKey={busyKey} compact={compact} />;
  } else {
    body = <MadrasRecord record={record} compact={compact} />;
  }

  return (
    <>
      {body}
      {docError && <p className="cr-note cr-error">{docError}</p>}

      <Dialog header="Daily Status" visible={!!modal} onHide={() => setModal(null)}
        style={{ width: "640px" }} breakpoints={{ "720px": "95vw" }} dismissableMask>
        {modal && (
          <>
            {modal.court && <p className="cr-modal-court">{modal.court}</p>}
            {modal.parties && <p className="cr-modal-parties">{modal.parties}</p>}
            <KV obj={modal.fields || {}} />
          </>
        )}
      </Dialog>
    </>
  );
}
