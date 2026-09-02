import React, { useState } from "react";
import "../assets/styles/CourtRecordView.css";

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
function ObjectTable({ rows }) {
  const columns = [];
  rows.forEach((r) => Object.keys(r || {}).forEach((k) => { if (!columns.includes(k)) columns.push(k); }));
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

// A table for headerless / array rows (with optional column labels).
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

// Normalize a record into the list of "extra" sections to show as sub-tabs.
function buildSections(record, courtId) {
  if (!record) return [];
  const out = [];

  if (courtId === "sci" || record.diaryNo !== undefined) {
    (record.sections || []).forEach((s) => {
      if (s.rows?.length || s.links?.length) {
        out.push({ title: s.label || "Details", rows: s.rows, columns: s.columns?.length ? s.columns : null, links: s.links });
      }
    });
    return out;
  }

  if (record.cases !== undefined) {
    (record.cases || []).forEach((c) => {
      const d = c.detail || {};
      if (d.objections?.length) out.push({ title: "Objections", objectRows: d.objections });
      if (d.documents?.length) out.push({ title: "Documents Filed", objectRows: d.documents });
      (d.extra || []).forEach((sec) => {
        if (sec.rows?.length) out.push({ title: sec.title || "Details", rows: sec.rows });
      });
    });
  }
  return out;
}

export default function CaseExtraDetails({ record, courtId }) {
  const [active, setActive] = useState(0);
  const sections = buildSections(record, courtId);

  if (!sections.length) {
    return <p className="cr-note">No further details — everything from the court record is shown in the header and the other tabs.</p>;
  }

  const idx = Math.min(active, sections.length - 1);
  const sec = sections[idx];

  return (
    <div className="cd-extra">
      <div className="cd-subtabs">
        {sections.map((s, i) => (
          <button key={i} className={`cd-subtab ${i === idx ? "active" : ""}`} onClick={() => setActive(i)}>
            {s.title}
          </button>
        ))}
      </div>
      <div className="cd-extra-body">
        {sec.objectRows ? <ObjectTable rows={sec.objectRows} /> : null}
        {sec.rows ? <RowTable rows={sec.rows} columns={sec.columns} /> : null}
        {sec.links?.length ? (
          <ul className="cr-links">
            {sec.links.map((l, i) => (
              <li key={i}><a href={l.href} target="_blank" rel="noreferrer">{l.text || l.href}</a></li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
