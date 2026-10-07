import { useState } from "react";
import { Tabs } from "../ui/forms";
import "../ui/pages/casedetail.css";

// Provakil-style "Extra Details": the parts of the imported court record that
// aren't already surfaced in the header or a dedicated tab, arranged as a row
// of sub-tabs (one per category), each showing a table.
//
// Sources of "extra" data, by court shape:
//   - Supreme Court:  record.sections[]  (Earlier Court Details, Listing Dates,
//                     Notices, Defects, Similarities, …)
//   - eCourts DC/HC:  detail.objections[], detail.documents[] (filed papers),
//                     and detail.extra[] (Subordinate Court Info, FIR Details, …)
// Everything else (identity fields, acts, hearings, orders, parties) lives
// elsewhere in the UI, and case-level `documents` are internal fetch tokens.

// A table for an array of uniform objects: keys become columns.
function ObjectTable({ rows }: { rows: any[] }) {
  const columns: string[] = [];
  rows.forEach((r) => Object.keys(r || {}).forEach((k) => { if (!columns.includes(k)) columns.push(k); }));
  if (!columns.length) return null;
  return (
    <div className="table-wrap">
      <table className="t cs-extra-table">
        <thead><tr>{columns.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{columns.map((c) => <td key={c}>{r?.[c] != null ? String(r[c]) : ""}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// A table for headerless / array rows (with optional column labels).
function RowTable({ rows, columns }: { rows: any[]; columns: string[] | null }) {
  if (!rows || !rows.length) return null;
  const colCount = columns
    ? columns.length
    : Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 1)), 1);
  return (
    <div className="table-wrap">
      <table className="t cs-extra-table">
        <thead>
          <tr>
            {Array.from({ length: colCount }).map((_, j) => (
              columns
                ? <th key={j} scope="col">{columns[j]}</th>
                : <th key={j} scope="col"><span className="sr-only">Column {j + 1}</span></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {Array.from({ length: colCount }).map((_, j) => (
                <td key={j}>{Array.isArray(row) ? (row[j] || "") : j === 0 ? String(row) : ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Normalize a record into the list of "extra" sections to show as sub-tabs.
function buildSections(record: any, courtId: any) {
  if (!record) return [];
  const out: any[] = [];

  if (courtId === "sci" || record.diaryNo !== undefined) {
    (record.sections || []).forEach((s: any) => {
      if (s.rows?.length || s.links?.length) {
        out.push({ title: s.label || "Details", rows: s.rows, columns: s.columns?.length ? s.columns : null, links: s.links });
      }
    });
    return out;
  }

  if (record.cases !== undefined) {
    (record.cases || []).forEach((c: any) => {
      const d = c.detail || {};
      if (d.objections?.length) out.push({ title: "Objections", objectRows: d.objections });
      if (d.documents?.length) out.push({ title: "Documents Filed", objectRows: d.documents });
      (d.extra || []).forEach((sec: any) => {
        if (sec.rows?.length) out.push({ title: sec.title || "Details", rows: sec.rows });
      });
    });
  }
  return out;
}

export default function CaseExtraDetails({ record, courtId }: { record: any; courtId?: any }) {
  const [active, setActive] = useState("0");
  const sections = buildSections(record, courtId);

  if (!sections.length) {
    return <p className="faint small">No further details. Everything from the court record is shown in the header and the other tabs.</p>;
  }

  const idx = Math.min(Number(active), sections.length - 1);
  const sec = sections[idx];

  return (
    <div className="stack" style={{ gap: "var(--s3)" }}>
      {sections.length > 1 && (
        <Tabs label="Court record sections" value={String(idx)} onChange={setActive}
          tabs={sections.map((s: any, i: number) => ({ value: String(i), label: s.title }))} />
      )}
      {sections.length === 1 && <h3 style={{ fontSize: "var(--t-md)" }}>{sec.title}</h3>}
      <div className="stack" style={{ gap: "var(--s3)" }}>
        {sec.objectRows ? <ObjectTable rows={sec.objectRows} /> : null}
        {sec.rows ? <RowTable rows={sec.rows} columns={sec.columns} /> : null}
        {sec.links?.length ? (
          <ul className="stack small" style={{ gap: 4, paddingLeft: 18, margin: 0 }}>
            {sec.links.map((l: any, i: number) => (
              <li key={i}><a className="link" href={l.href} target="_blank" rel="noreferrer">{l.text || l.href}</a></li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
