import { useState } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { TabMenu } from "primereact/tabmenu";
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
function ObjectTable({ rows }: { rows: any[] }) {
  const columns: string[] = [];
  rows.forEach((r) => Object.keys(r || {}).forEach((k) => { if (!columns.includes(k)) columns.push(k); }));
  if (!columns.length) return null;
  return (
    <DataTable value={rows} size="small" stripedRows scrollable className="text-sm">
      {columns.map((c) => (
        <Column key={c} header={c} body={(r: any) => (r?.[c] != null ? String(r[c]) : "")} />
      ))}
    </DataTable>
  );
}

// A table for headerless / array rows (with optional column labels).
function RowTable({ rows, columns }: { rows: any[]; columns: string[] | null }) {
  if (!rows || !rows.length) return null;
  const colCount = columns
    ? columns.length
    : Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 1)), 1);
  return (
    <DataTable value={rows} size="small" stripedRows scrollable className="text-sm"
      showHeaders={!!columns}>
      {Array.from({ length: colCount }).map((_, j) => (
        <Column key={j} header={columns ? columns[j] : undefined}
          body={(row: any) => (Array.isArray(row) ? (row[j] || "") : String(row))} />
      ))}
    </DataTable>
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
  const [active, setActive] = useState(0);
  const sections = buildSections(record, courtId);

  if (!sections.length) {
    return <p className="cr-note">No further details — everything from the court record is shown in the header and the other tabs.</p>;
  }

  const idx = Math.min(active, sections.length - 1);
  const sec = sections[idx];

  return (
    <div className="flex flex-column gap-3">
      <TabMenu model={sections.map((s: any) => ({ label: s.title }))} activeIndex={idx}
        onTabChange={(e) => setActive(e.index)} />
      <div>
        {sec.objectRows ? <ObjectTable rows={sec.objectRows} /> : null}
        {sec.rows ? <RowTable rows={sec.rows} columns={sec.columns} /> : null}
        {sec.links?.length ? (
          <ul className="cr-links">
            {sec.links.map((l: any, i: number) => (
              <li key={i}><a href={l.href} target="_blank" rel="noreferrer">{l.text || l.href}</a></li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
