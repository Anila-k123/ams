import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import Select from "react-select";
import { FiSearch, FiX, FiChevronLeft, FiHome, FiEdit3, FiChevronDown } from "react-icons/fi";
import { useToast } from "../contexts/ToastContext.jsx";
import CourtRecordView from "../components/CourtRecordView.jsx";
import "../assets/styles/AddCase.css";

const customSelectStyles = {
  control: (base, state) => ({
    ...base,
    backgroundColor: "var(--bg-primary)",
    borderColor: state.isFocused ? "var(--accent)" : "var(--border-color)",
    color: "var(--text-primary)",
    borderRadius: "8px",
    minHeight: "44px",
    boxShadow: "none",
    "&:hover": { borderColor: "var(--accent)" },
  }),
  menu: (base) => ({ ...base, backgroundColor: "var(--bg-secondary)", border: "1px solid var(--border-color)", borderRadius: "8px", zIndex: 9999 }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected ? "var(--accent)" : state.isFocused ? "var(--border-color)" : "transparent",
    color: state.isSelected ? "#fff" : "var(--text-primary)",
    cursor: "pointer",
  }),
  singleValue: (base) => ({ ...base, color: "var(--text-primary)" }),
  placeholder: (base) => ({ ...base, color: "var(--text-muted)" }),
  input: (base) => ({ ...base, color: "var(--text-primary)" }),
};

const EMPTY_CASE = {
  caseNumber: "", caseTitle: "", caseType: "", courtLevel: "",
  status: "", amount: "", description: "", clientId: "",
};

// Known column order for the row-based record sections (API sends rows without headers).
const SECTION_COLUMNS = {
  applications: ["Case No", "Prayer", "Filing Date", "Advocate"],
  connected_matters: ["Case No", "Stage"],
};

function RowTable({ rows, columns }) {
  if (!rows || !rows.length) return null;
  const colCount = columns ? columns.length : Math.max(...rows.map((r) => (Array.isArray(r) ? r.length : 1)), 1);
  return (
    <div className="ac-rtable-wrap">
      <table className="ac-rtable">
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

// eCourts record ({ cases: [ { case_number, parties, detail:{ fields, tables } } ] }).
function EcourtsRecord({ record }) {
  const cases = (record && record.cases) || [];
  return (
    <div className="ac-record">
      <div className="ac-record-head">
        Full court record{cases.length > 1 ? ` (${cases.length} matches)` : ""}
      </div>
      {cases.length === 0 && <p className="ac-record-note">No detailed record returned.</p>}
      {cases.map((c, idx) => {
        const f = (c.detail && c.detail.fields) || {};
        const tables = (c.detail && c.detail.tables) || {};
        const fieldKeys = Object.keys(f);
        return (
          <div className="ac-rcase" key={idx}>
            <div className="ac-rcase-head">
              {c.case_number || `Case ${idx + 1}`}{c.parties ? ` — ${c.parties}` : ""}
            </div>
            {fieldKeys.length > 0 && (
              <section className="ac-rsec"><h4>Case Details</h4>
                <dl className="ac-kv">
                  {fieldKeys.map((k) => (<div className="ac-kv-row" key={k}><dt>{k}</dt><dd>{f[k]}</dd></div>))}
                </dl>
              </section>
            )}
            {Object.entries(tables).map(([name, rows]) => (
              Array.isArray(rows) && rows.length > 0 ? (
                <section className="ac-rsec" key={name}>
                  <h4>{prettyTableName(name)}</h4>
                  <RowTable rows={rows} />
                </section>
              ) : null
            ))}
          </div>
        );
      })}
    </div>
  );
}

// Full scraped court record — shown raw for now; to be structured later.
function CourtRecord({ record }) {
  if (!record) return null;
  // eCourts has a different shape than Madras HC.
  if (record.cases !== undefined) {
    return <EcourtsRecord record={record} />;
  }
  const f = record.fields || {};
  const fieldKeys = Object.keys(f);
  return (
    <div className="ac-record">
      <div className="ac-record-head">Full court record</div>

      {fieldKeys.length > 0 && (
        <section className="ac-rsec">
          <h4>Case Details</h4>
          <dl className="ac-kv">
            {fieldKeys.map((k) => (
              <div className="ac-kv-row" key={k}><dt>{k}</dt><dd>{f[k]}</dd></div>
            ))}
          </dl>
        </section>
      )}

      {record.prayer && (
        <section className="ac-rsec"><h4>Prayer</h4><p className="ac-prayer">{record.prayer}</p></section>
      )}

      {record.applications?.length > 0 && (
        <section className="ac-rsec"><h4>Applications</h4>
          <RowTable rows={record.applications} columns={SECTION_COLUMNS.applications} /></section>
      )}
      {record.connected_matters?.length > 0 && (
        <section className="ac-rsec"><h4>Connected Matters</h4>
          <RowTable rows={record.connected_matters} columns={SECTION_COLUMNS.connected_matters} /></section>
      )}
      {record.hearing_history?.length > 0 && (
        <section className="ac-rsec"><h4>Hearing History</h4>
          <RowTable rows={record.hearing_history} /></section>
      )}
      {record.lower_court?.length > 0 && (
        <section className="ac-rsec"><h4>Lower Court</h4><RowTable rows={record.lower_court} /></section>
      )}
      {record.caveats?.length > 0 && (
        <section className="ac-rsec"><h4>Caveats</h4><RowTable rows={record.caveats} /></section>
      )}

      {record.orders?.length > 0 && (
        <section className="ac-rsec"><h4>Orders</h4>
          <div className="ac-rtable-wrap">
            <table className="ac-rtable">
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
          <p className="ac-record-note">Order PDFs are not downloadable from the court at this time.</p>
        </section>
      )}
    </div>
  );
}

function firstParty(blob) {
  if (!blob) return "";
  return String(blob).split(",")[0].trim();
}

function mapCourtRecordToCase(record, searchedType) {
  const f = (record && record.fields) || {};
  const pet = firstParty(f["Petitioner Details"]);
  const res = firstParty(f["Respondent Details"]);
  const title = pet && res ? `${pet} vs ${res}` : (f["Registration No"] || "");
  const stage = (f["Stage"] || "").toLowerCase();
  let status = "Active";
  if (/dispos|dismiss|withdraw|closed|allowed|rejected/.test(stage)) status = "Closed";
  else if (/pending/.test(stage)) status = "Pending";
  const desc = [];
  if (f["Registration No"]) desc.push(`Reg No: ${f["Registration No"]}`);
  if (f["Subject"]) desc.push(`Subject: ${f["Subject"]}`);
  if (f["Nature of Writ"]) desc.push(`Nature: ${f["Nature of Writ"]}`);
  if (f["Stage"]) desc.push(`Stage: ${f["Stage"]}`);
  return {
    caseNumber: (f["CNR"] || "").trim(),
    caseType: searchedType || "",
    caseTitle: title,
    courtLevel: "High Court",
    status,
    description: desc.join("\n"),
  };
}

// eCourts: { cases: [ { case_number, parties, detail:{ case_details, case_status, petitioners[], respondents[], acts[], history[], orders[] } } ] }.
function mapEcourtsToCase(record, caseTypeLabel) {
  const c0 = (record && record.cases && record.cases[0]) || {};
  const d = c0.detail || {};
  const cd = d.case_details || {};
  const cs = d.case_status || {};
  const pet = (d.petitioners || [])[0];
  const res = (d.respondents || [])[0];
  const cnr = String(cd["CNR Number"] || cd["CNR"] || "").trim();
  const title =
    c0.parties ||
    [pet && pet.name, res && res.name].filter(Boolean).join(" vs ") ||
    c0.case_number || "";
  const statusText = (Object.values(cs).join(" ") + " " + String(cd["Case Status"] || "")).toLowerCase();
  let status = "Active";
  if (/dispos|dismiss|withdraw|closed|allowed|rejected|decided/.test(statusText)) status = "Closed";
  else if (/pending/.test(statusText)) status = "Pending";
  const desc = Object.entries(cd).slice(0, 8).map(([k, v]) => `${k}: ${v}`).join("\n");
  return {
    // Prefer the 16-char CNR; otherwise use the portal case number so the case can still save.
    caseNumber: cnr.length === 16 ? cnr : (c0.case_number || ""),
    caseType: cd["Case Type"] || caseTypeLabel || "",
    caseTitle: title,
    courtLevel: "District",
    status,
    description: desc,
  };
}

// eCourts High Courts share the eCourts detail shape ({cases:[{detail:{case_details,
// case_status, petitioners[], respondents[], hearings[], orders[]}}]}); only the
// court level and CNR format differ (HC CNRs may carry dashes, e.g. HCMA01-000393-2023).
function mapHcToCase(record, caseTypeLabel) {
  const c0 = (record && record.cases && record.cases[0]) || {};
  const d = c0.detail || {};
  const cd = d.case_details || {};
  const cs = d.case_status || {};
  const pet = (d.petitioners || [])[0];
  const res = (d.respondents || [])[0];
  const cnr = String(cd["CNR Number"] || cd["CNR"] || "").replace(/[^A-Za-z0-9]/g, "").trim();
  const title =
    c0.parties ||
    [pet && pet.name, res && res.name].filter(Boolean).join(" vs ") ||
    c0.case_number || "";
  const statusText = (Object.values(cs).join(" ") + " " + String(cd["Case Status"] || "")).toLowerCase();
  let status = "Active";
  if (/dispos|dismiss|withdraw|closed|allowed|rejected|decided/.test(statusText)) status = "Closed";
  else if (/pending/.test(statusText)) status = "Pending";
  const desc = Object.entries(cd).slice(0, 8).map(([k, v]) => `${k}: ${v}`).join("\n");
  return {
    caseNumber: cnr.length === 16 ? cnr : (c0.case_number || ""),
    caseType: cd["Case Type"] || caseTypeLabel || "",
    caseTitle: title,
    courtLevel: "High Court",
    status,
    description: desc,
  };
}

// SCI flattens its numbered party list into a single string
// ("1 THE STATE OF ODISHA 2 ENGINEER-IN-CHIEF 3 ..."); split it back into
// individual names. Falls back to the whole string if it isn't numbered.
function splitSciParties(blob) {
  const s = String(blob || "").trim();
  if (!s) return [];
  const out = [];
  const re = /(?:^|\s)\d+\s+(.*?)(?=\s\d+\s|$)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const name = m[1].trim();
    if (name) out.push(name);
  }
  return out.length ? out : [s];
}

// Find a stored SCI section by its label ("Listing Dates", "Judgement/Orders").
function sciSection(record, label) {
  return (record?.sections || []).find((s) => s.label === label) || null;
}

// Build case Party rows (name, role, counsel, opponent) from a fetched court record.
function buildParties(record, courtId) {
  const out = [];
  if (!record) return out;
  if (courtId === "ecourts_dc" || courtId === "ecourts_hc") {
    const d = (record.cases && record.cases[0] && record.cases[0].detail) || {};
    (d.petitioners || []).forEach((p) =>
      out.push({ name: p.name, role: "Petitioner", counsel: p.advocate || "", isOpponent: false }));
    (d.respondents || []).forEach((p) =>
      out.push({ name: p.name, role: "Respondent", counsel: p.advocate || "", isOpponent: true }));
  } else if (courtId === "sci") {
    // SCI gives one combined advocate string per side rather than a per-party
    // one, so it's attached to that side's first (lead) party only.
    const f = record.fields || {};
    splitSciParties(f["Petitioner(s)"]).forEach((name, i) =>
      out.push({ name, role: "Petitioner", counsel: i === 0 ? (f["Petitioner Advocate(s)"] || "") : "", isOpponent: false }));
    splitSciParties(f["Respondent(s)"]).forEach((name, i) =>
      out.push({ name, role: "Respondent", counsel: i === 0 ? (f["Respondent Advocate(s)"] || "") : "", isOpponent: true }));
  } else {
    const f = record.fields || {};
    if (f["Petitioner Details"])
      out.push({ name: firstParty(f["Petitioner Details"]), role: "Petitioner", counsel: f["Petitioner Counsel"] || "", isOpponent: false });
    if (f["Respondent Details"])
      out.push({ name: firstParty(f["Respondent Details"]), role: "Respondent", counsel: f["Respondent Counsel"] || "", isOpponent: true });
  }
  return out
    .filter((p) => p.name && p.name.trim())
    .map((p) => ({ ...p, name: p.name.slice(0, 255), counsel: (p.counsel || "").slice(0, 255) }));
}

// Parse the portal's mixed date formats into ISO (yyyy-mm-dd); "" if unparseable.
const _MONTHS = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12,
  jan:1,feb:2,mar:3,apr:4,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
function toISODate(s) {
  if (!s) return "";
  const t = String(s).trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);            // dd/mm/yyyy or dd-mm-yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\.?\s+(\d{4})/);  // 12th June 2023
  if (m) { const mo = _MONTHS[m[2].toLowerCase()]; if (mo) return `${m[3]}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  return "";
}

// Build case hearing events from a fetched court record.
// (Orders are intentionally NOT mapped here — they'll get their own section later.)
function buildEvents(record, courtId) {
  const out = [];
  const cap = (v) => String(v || "").slice(0, 255);
  if (!record) return out;

  if (courtId === "ecourts_dc") {
    const d = (record.cases && record.cases[0] && record.cases[0].detail) || {};
    (d.history || []).forEach((h) => {
      const date = toISODate(h.hearing_date) || toISODate(h.business_date);
      if (date) out.push({ title: cap(h.purpose || "Hearing"), eventType: "HEARING", description: cap(h.judge ? `Judge: ${h.judge}` : ""), date });
    });
  } else if (courtId === "ecourts_hc") {
    const d = (record.cases && record.cases[0] && record.cases[0].detail) || {};
    (d.hearings || []).forEach((h) => {
      const date = toISODate(h.hearing_date) || toISODate(h.business_on_date);
      if (date) out.push({ title: cap(h.purpose || "Hearing"), eventType: "HEARING", description: cap(h.judge ? `Judge: ${h.judge}` : ""), date });
    });
  } else if (courtId === "sci") {
    // The hearing history is the "Listing Dates" section (columns: CL Date,
    // Misc./Regular, Stage, Purpose, ..., Judges, IA, Remarks, Listed), which
    // is only populated on an expanded fetch. Fall back to the always-present
    // "Present/Last Listed On" field when it wasn't captured.
    const listing = sciSection(record, "Listing Dates");
    const cols = listing?.columns || [];
    const at = (row, name) => {
      const i = cols.indexOf(name);
      return i >= 0 ? String(row[i] || "").trim() : "";
    };
    if (listing?.rows?.length) {
      listing.rows.forEach((row) => {
        if (!Array.isArray(row)) return;
        const date = toISODate(at(row, "CL Date"));
        if (!date) return;
        const judges = at(row, "Judges");
        const remarks = at(row, "Remarks");
        out.push({
          title: cap(at(row, "Purpose") || "Hearing"),
          eventType: "HEARING",
          description: cap([judges, remarks].filter(Boolean).join(" — ")),
          date,
        });
      });
    } else {
      const listed = String((record.fields || {})["Present/Last Listed On"] || "");
      const date = toISODate(listed);
      if (date) {
        const coram = (listed.match(/\[(.+)\]/) || [])[1] || "";
        out.push({ title: "Hearing", eventType: "HEARING", description: cap(coram.trim()), date });
      }
    }
  } else {
    (record.hearing_history || []).forEach((row) => {
      if (!Array.isArray(row)) return;
      let date = "";
      for (const c of row) { if (!date) date = toISODate(c); }
      if (!date) return;
      const rest = row.slice(1).filter((c) => c && !toISODate(c));
      out.push({ title: cap(rest.length ? rest[rest.length - 1] : "Hearing"), eventType: "HEARING",
                 description: cap(row[0] ? `Judge: ${row[0]}` : ""), date });
    });
  }
  return out;
}

// eCourts table keys are portal CSS classes ("history_table table") — tidy them for display.
function prettyTableName(name) {
  return String(name)
    .replace(/table-bordered/gi, " ")
    .replace(/_/g, " ")
    .replace(/\btable\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim() || "Details";
}

export default function AddCase() {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const token = localStorage.getItem("token");
  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

  const [step, setStep] = useState("select"); // select | search | review | manual
  const [courts, setCourts] = useState([]);
  const [forumQuery, setForumQuery] = useState("");
  const [selectedCourt, setSelectedCourt] = useState(null);
  const [clients, setClients] = useState([]);

  const [caseTypes, setCaseTypes] = useState({});
  const [typesLoading, setTypesLoading] = useState(false);
  const [lkType, setLkType] = useState(null);
  const [lkNumber, setLkNumber] = useState("");
  const [lkYear, setLkYear] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [fetchedRecord, setFetchedRecord] = useState(null);
  const [fetchedQuery, setFetchedQuery] = useState(null); // search params used, stored with the record

  // eCourts cascade state (state -> district -> complex -> establishment? -> case type)
  const [ecStates, setEcStates] = useState({});
  const [ecDistricts, setEcDistricts] = useState({});
  const [ecComplexes, setEcComplexes] = useState({});
  const [ecEstabs, setEcEstabs] = useState({});
  const [ecStateCode, setEcStateCode] = useState("");
  const [ecDistCode, setEcDistCode] = useState("");
  const [ecComplexVal, setEcComplexVal] = useState("");
  const [ecEstCode, setEcEstCode] = useState("");
  const [cascadeBusy, setCascadeBusy] = useState(""); // "" | states|districts|complexes|establishments|case-types
  // eCourts search mode: case_number | cnr | party_name | filing_number | advocate | fir_number | act | case_type
  const [ecMode, setEcMode] = useState("case_number");
  const [cnrInput, setCnrInput] = useState("");
  // shared list-mode inputs (only one mode active at a time)
  const [ecYear, setEcYear] = useState("");
  const [ecStatus, setEcStatus] = useState("Both");   // Pending | Disposed | Both
  const [pName, setPName] = useState("");             // party name
  const [filingNo, setFilingNo] = useState("");       // filing number
  const [advName, setAdvName] = useState("");         // advocate name
  const [advSubMode, setAdvSubMode] = useState("1");  // 1=name 2=bar code 3=date case list
  const [barState, setBarState] = useState("");
  const [barCode, setBarCode] = useState("");
  const [barYear, setBarYear] = useState("");
  const [caselistDate, setCaselistDate] = useState("");
  const [policeStations, setPoliceStations] = useState({});
  const [firPolice, setFirPolice] = useState("");
  const [firNo, setFirNo] = useState("");
  const [actTypes, setActTypes] = useState({});
  const [actSearch, setActSearch] = useState("");
  const [actCode, setActCode] = useState("");
  const [actSection, setActSection] = useState("");
  const [resultRows, setResultRows] = useState([]);   // list-search results
  const [picking, setPicking] = useState(-1);          // index being fetched to detail
  const [sciDetail, setSciDetail] = useState(null);    // full SCI case-details record
  const [sciSectionsOpen, setSciSectionsOpen] = useState(() => new Set()); // expanded dropdown-section tab names
  const [sciSectionLoading, setSciSectionLoading] = useState("");         // tab name currently being fetched

  // SCI search mode: case_number | diary_no | cnr | aor_code | party_name | court
  const [sciMode, setSciMode] = useState("case_number");
  const [sciYear, setSciYear] = useState("");          // shared "Year" field (diary_no/aor_code/party_name/court)
  const [sciAorCode, setSciAorCode] = useState("");
  const [sciAorPartyType, setSciAorPartyType] = useState("any");  // any | P | R
  const [sciAorStatus, setSciAorStatus] = useState("P");          // P | D
  const [sciPartyName, setSciPartyName] = useState("");
  const [sciPartyType, setSciPartyType] = useState("any");        // any | P | R
  const [sciPartyStatus, setSciPartyStatus] = useState("");       // "" | P | D

  // eCourts High Court cascade state (High Court -> bench -> case type)
  const [hcCourts, setHcCourts] = useState({});        // {name: state_code}
  const [hcBenchList, setHcBenchList] = useState({});  // {bench: court_code}
  const [hcStateCode, setHcStateCode] = useState("");
  const [hcBenchCode, setHcBenchCode] = useState("");

  const [newCase, setNewCase] = useState(EMPTY_CASE);
  const [caseNumberError, setCaseNumberError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [courtsError, setCourtsError] = useState("");
  const [courtsLoading, setCourtsLoading] = useState(true);

  // Load courts and clients independently so a scraper outage doesn't block clients.
  useEffect(() => {
    (async () => {
      try {
        const res = await axios.get("/api/clients/my-clients", authHeaders);
        setClients(res.data || []);
      } catch { /* client list optional here */ }
    })();
    (async () => {
      setCourtsLoading(true);
      try {
        const res = await axios.get("/api/courtsearch/courts", authHeaders);
        setCourts(res.data || []);
      } catch (err) {
        setCourtsError(
          err?.response?.data?.error ||
          "Couldn’t reach the court lookup service. Online case import is unavailable right now — you can still add a case manually."
        );
      } finally {
        setCourtsLoading(false);
      }
    })();
  }, []);

  const forums = useMemo(() => {
    // The standalone Madras HC flat lookup is superseded by the eCourts High
    // Courts cascade below (which covers Madras HC plus every other High
    // Court with richer search + full case detail), so hide it here.
    const list = (courts || [])
      .filter((c) => c.court_id !== "madras_hc")
      .map((c) => ({
        id: c.court_id,
        name: c.court_id === "ecourts_dc" ? "District Courts"
          : c.court_id === "ecourts_hc" ? "High Courts"
          : c.name,
        kind: "court",
      }));
    // CNR is a unified eCourts lookup that needs no cascade/court selection -
    // it tries District Courts and High Courts together and offers it standalone
    // (see CnrSearchView on the backend for why this is one box, not two).
    if ((courts || []).some((c) => c.court_id === "ecourts_dc" || c.court_id === "ecourts_hc")) {
      list.push({ id: "__cnr__", name: "CNR Number", kind: "cnr" });
    }
    list.push({ id: "__manual__", name: "Offline / Manual Entry", kind: "manual" });
    return list;
  }, [courts]);

  const filteredForums = useMemo(() => {
    const q = forumQuery.trim().toLowerCase();
    return q ? forums.filter((f) => f.name.toLowerCase().includes(q)) : forums;
  }, [forums, forumQuery]);

  const loadCaseTypes = useCallback(async (courtId) => {
    setTypesLoading(true); setCaseTypes({}); setLkType(null);
    try {
      const res = await axios.get(`/api/courtsearch/courts/${courtId}/case-types`, authHeaders);
      setCaseTypes(res.data || {});
    } catch { /* ignore */ } finally { setTypesLoading(false); }
  }, []);

  // ---- eCourts cascade fetchers ----
  const ecGet = useCallback(async (stepName, params) => {
    setSearchError("");
    const res = await axios.get(`/api/courtsearch/ecourts/${stepName}`, { ...authHeaders, params });
    return res.data || {};
  }, []);

  // Same shape as ecGet, but for the High Court cascade (police-stations/act-types).
  const hcGet = useCallback(async (stepName, params) => {
    setSearchError("");
    const res = await axios.get(`/api/courtsearch/hc/${stepName}`, { ...authHeaders, params });
    return res.data || {};
  }, []);

  const loadStates = useCallback(async () => {
    setCascadeBusy("states");
    try { setEcStates(await ecGet("states")); }
    catch (e) { setSearchError(e?.response?.data?.error || "Couldn’t load states."); }
    finally { setCascadeBusy(""); }
  }, [ecGet]);

  const needsEst = ecComplexVal.endsWith("@Y");
  const cascadeReady = !!(ecStateCode && ecDistCode && ecComplexVal && (!needsEst || ecEstCode));

  const EC_TABS = [
    ["case_number", "Case Number"], ["party_name", "Party Name"],
    ["filing_number", "Filing Number"], ["advocate", "Advocate"], ["fir_number", "FIR Number"],
    ["act", "Act"], ["case_type", "Case Type"],
  ];

  const SCI_TABS = [
    ["diary_no", "Diary Number"], ["case_number", "Case Number"], ["cnr", "CNR Number"],
    ["aor_code", "AOR Code"], ["party_name", "Party Name"],
  ];
  const onEcTab = (key) => {
    setEcMode(key); setSearchError("");
    const ready = selectedCourt?.id === "ecourts_hc" ? hcReady : cascadeReady;
    if (key === "fir_number" && ready && !Object.keys(policeStations).length) loadPoliceStations();
    if (key === "act" && ready && !Object.keys(actTypes).length) loadActTypes("");
  };

  const loadCaseTypesEc = async (params) => {
    setCascadeBusy("case-types"); setCaseTypes({}); setLkType(null);
    try { setCaseTypes(await ecGet("case-types", params)); }
    catch (e) { setSearchError(e?.response?.data?.error || "Couldn’t load case types."); }
    finally { setCascadeBusy(""); }
  };

  const onSelectState = async (opt) => {
    const code = opt ? opt.value : "";
    setEcStateCode(code);
    setEcDistCode(""); setEcComplexVal(""); setEcEstCode("");
    setEcDistricts({}); setEcComplexes({}); setEcEstabs({}); setCaseTypes({}); setLkType(null);
    if (!code) return;
    setCascadeBusy("districts");
    try { setEcDistricts(await ecGet("districts", { state_code: code })); }
    catch (e) { setSearchError(e?.response?.data?.error || "Couldn’t load districts."); }
    finally { setCascadeBusy(""); }
  };

  const onSelectDistrict = async (opt) => {
    const code = opt ? opt.value : "";
    setEcDistCode(code);
    setEcComplexVal(""); setEcEstCode("");
    setEcComplexes({}); setEcEstabs({}); setCaseTypes({}); setLkType(null);
    if (!code) return;
    setCascadeBusy("complexes");
    try { setEcComplexes(await ecGet("complexes", { state_code: ecStateCode, dist_code: code })); }
    catch (e) { setSearchError(e?.response?.data?.error || "Couldn’t load court complexes."); }
    finally { setCascadeBusy(""); }
  };

  const onSelectComplex = async (opt) => {
    const val = opt ? opt.value : "";
    setEcComplexVal(val);
    setEcEstCode(""); setEcEstabs({}); setCaseTypes({}); setLkType(null);
    if (!val) return;
    if (val.endsWith("@Y")) {
      setCascadeBusy("establishments");
      try { setEcEstabs(await ecGet("establishments", { state_code: ecStateCode, dist_code: ecDistCode, court_complex: val })); }
      catch (e) { setSearchError(e?.response?.data?.error || "Couldn’t load establishments."); }
      finally { setCascadeBusy(""); }
    } else {
      await loadCaseTypesEc({ state_code: ecStateCode, dist_code: ecDistCode, court_complex: val });
    }
  };

  const onSelectEst = async (opt) => {
    const code = opt ? opt.value : "";
    setEcEstCode(code);
    setCaseTypes({}); setLkType(null);
    if (!code) return;
    await loadCaseTypesEc({ state_code: ecStateCode, dist_code: ecDistCode, court_complex: ecComplexVal, est_code: code });
  };

  const chooseForum = (f) => {
    setSearchError(""); setSaveError("");
    setFetchedRecord(null); setFetchedQuery(null);
    if (f.kind === "cnr") {
      // Placeholder until the search resolves which portal actually has the
      // case; runSearchCnr() overwrites this with the real court id/name.
      setSelectedCourt({ id: "cnr", name: "CNR Number" });
      setCnrInput("");
      setStep("cnr");
    } else if (f.kind === "manual") {
      setNewCase(EMPTY_CASE);
      setSelectedCourt(null);
      setStep("manual");
    } else {
      setSelectedCourt(f);
      setLkNumber(""); setLkYear(""); setLkType(null); setCaseTypes({});
      if (f.id === "ecourts_dc") {
        setEcMode("case_number"); setCnrInput("");
        setEcYear(""); setEcStatus("Both"); setPName(""); setFilingNo(""); setAdvName("");
        setAdvSubMode("1"); setBarState(""); setBarCode(""); setBarYear(""); setCaselistDate("");
        setPoliceStations({}); setFirPolice(""); setFirNo("");
        setActTypes({}); setActSearch(""); setActCode(""); setActSection(""); setResultRows([]);
        setEcStates({}); setEcDistricts({}); setEcComplexes({}); setEcEstabs({});
        setEcStateCode(""); setEcDistCode(""); setEcComplexVal(""); setEcEstCode("");
        loadStates();
      } else if (f.id === "ecourts_hc") {
        setEcMode("case_number");
        setEcYear(""); setEcStatus("Both"); setPName(""); setFilingNo(""); setAdvName("");
        setAdvSubMode("1"); setBarState(""); setBarCode(""); setBarYear(""); setCaselistDate("");
        setPoliceStations({}); setFirPolice(""); setFirNo("");
        setActTypes({}); setActSearch(""); setActCode(""); setActSection(""); setResultRows([]);
        setSciDetail(null);
        setCaseTypes({}); setLkType(null);
        setHcCourts({}); setHcBenchList({}); setHcStateCode(""); setHcBenchCode("");
        loadHcCourts();
      } else if (f.id === "sci") {
        setResultRows([]); setSciDetail(null);
        setSciMode("case_number"); setCnrInput("");
        setSciYear(""); setSciAorCode(""); setSciAorPartyType("any"); setSciAorStatus("P");
        setSciPartyName(""); setSciPartyType("any"); setSciPartyStatus("");
        loadSciCaseTypes();
      } else {
        loadCaseTypes(f.id);
      }
      setStep("search");
    }
  };

  // Case-type options: eCourts must submit the numeric CODE; Madras accepts the label key.
  const caseTypeOptions = useMemo(() => {
    if (selectedCourt?.id === "ecourts_dc" || selectedCourt?.id === "ecourts_hc") {
      return Object.entries(caseTypes)
        .map(([label, code]) => ({ value: String(code), label }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    if (selectedCourt?.id === "sci") {
      // SCI case types come as {code: label}; submit the numeric code.
      return Object.entries(caseTypes)
        .map(([code, label]) => ({ value: String(code), label }))
        .sort((a, b) => Number(a.value) - Number(b.value));
    }
    return Object.keys(caseTypes).sort().map((k) => ({ value: k, label: k }));
  }, [caseTypes, selectedCourt]);

  const mapToOptions = (m) =>
    Object.entries(m || {})
      .map(([label, code]) => ({ value: String(code), label }))
      .sort((a, b) => a.label.localeCompare(b.label));

  // ---- Supreme Court of India (case number) ----
  const loadSciCaseTypes = useCallback(async () => {
    setTypesLoading(true); setCaseTypes({}); setLkType(null);
    try {
      const res = await axios.get("/api/courtsearch/sci/case-types", authHeaders);
      setCaseTypes(res.data || {});
    } catch { /* ignore */ } finally { setTypesLoading(false); }
  }, []);

  const mapSciStatus = (s) => (/dispos/i.test(s) ? "Closed" : "Pending");

  // Shared by every SCI search mode: same request/response shape
  // ({ cases: [...] }), just a different endpoint + body per mode.
  const runSearchSciMode = async (url, body) => {
    setSearching(true); setSearchError(""); setResultRows([]);
    try {
      const res = await axios.post(url, body, authHeaders);
      const cases = res.data?.cases || [];
      if (!cases.length) { setSearchError("No matching cases found."); return; }
      setResultRows(cases.map((c) => ({
        sr_no: c.serial,
        case_number: c.caseNumber,
        parties: [c.petitioner, c.respondent].filter(Boolean).join("  vs  "),
        _sci: c,
      })));
      setStep("results");
    } catch (err) {
      setSearchError(err?.response?.data?.error || "Lookup failed. Please try again.");
    } finally {
      setSearching(false);
    }
  };

  const runSearchSci = () => {
    if (!lkType || !lkNumber.trim() || !lkYear) return;
    return runSearchSciMode("/api/courtsearch/sci/case-no", {
      case_type: lkType.value, case_no: lkNumber.trim(), case_year: Number(lkYear),
    });
  };

  const runSearchSciDiaryNo = () => {
    if (!lkNumber.trim() || !sciYear) return;
    return runSearchSciMode("/api/courtsearch/sci/diary-no", {
      diary_no: lkNumber.trim(), year: Number(sciYear),
    });
  };

  const runSearchSciCnr = () => {
    if (!cnrInput.trim()) return;
    return runSearchSciMode("/api/courtsearch/sci/cnr", { cnr_no: cnrInput.trim() });
  };

  const runSearchSciAorCode = () => {
    if (!sciAorCode.trim() || !sciYear) return;
    return runSearchSciMode("/api/courtsearch/sci/aor-code", {
      aor_code: sciAorCode.trim(), year: Number(sciYear),
      party_type: sciAorPartyType, status: sciAorStatus,
    });
  };

  const runSearchSciPartyName = () => {
    if (sciPartyName.trim().length < 3) return;
    return runSearchSciMode("/api/courtsearch/sci/party-name", {
      party_name: sciPartyName.trim(), year: sciYear ? Number(sciYear) : null,
      party_type: sciPartyType, status: sciPartyStatus || null,
    });
  };

  const onSciSearch = () => {
    if (sciMode === "case_number") return runSearchSci();
    if (sciMode === "diary_no") return runSearchSciDiaryNo();
    if (sciMode === "cnr") return runSearchSciCnr();
    if (sciMode === "aor_code") return runSearchSciAorCode();
    if (sciMode === "party_name") return runSearchSciPartyName();
  };

  const sciSearchEnabled = (() => {
    if (sciMode === "case_number") return !!(lkType && lkNumber.trim() && lkYear);
    if (sciMode === "diary_no") return !!lkNumber.trim() && !!sciYear;
    if (sciMode === "cnr") return !!cnrInput.trim();
    if (sciMode === "aor_code") return !!sciAorCode.trim() && !!sciYear;
    if (sciMode === "party_name") return sciPartyName.trim().length >= 3;
    return false;
  })();

  const onSciTab = (key) => {
    setSciMode(key); setSearchError("");
  };

  // ---- eCourts High Courts (High Court -> bench -> case type -> case no) ----
  const loadHcCourts = useCallback(async () => {
    setCascadeBusy("hc-courts"); setHcCourts({}); setSearchError("");
    try {
      const res = await axios.get("/api/courtsearch/hc/high-courts", authHeaders);
      setHcCourts(res.data || {});
    } catch (e) { setSearchError(e?.response?.data?.error || "Couldn’t load High Courts."); }
    finally { setCascadeBusy(""); }
  }, []);

  const onSelectHcCourt = async (opt) => {
    const code = opt ? opt.value : "";
    setHcStateCode(code);
    setHcBenchCode(""); setHcBenchList({}); setCaseTypes({}); setLkType(null); setSearchError("");
    if (!code) return;
    setCascadeBusy("hc-benches");
    try {
      const res = await axios.get("/api/courtsearch/hc/benches", { ...authHeaders, params: { state_code: code } });
      const benches = res.data || {};
      setHcBenchList(benches);
      // High Courts with only one bench (most of them) skip the extra
      // click — select it immediately, same as if the user had picked
      // the only option.
      const entries = Object.entries(benches);
      if (entries.length === 1) {
        await onSelectHcBench({ value: entries[0][1] }, code);
      }
    } catch (e) { setSearchError(e?.response?.data?.error || "Couldn’t load benches."); }
    finally { setCascadeBusy(""); }
  };

  const onSelectHcBench = async (opt, stateCodeOverride) => {
    const code = opt ? opt.value : "";
    const stateCode = stateCodeOverride || hcStateCode;
    setHcBenchCode(code);
    setCaseTypes({}); setLkType(null); setSearchError("");
    if (!code) return;
    setCascadeBusy("case-types");
    try {
      const res = await axios.get("/api/courtsearch/hc/case-types", { ...authHeaders, params: { state_code: stateCode, court_complex: code } });
      setCaseTypes(res.data || {});
    } catch (e) { setSearchError(e?.response?.data?.error || "Couldn’t load case types."); }
    finally { setCascadeBusy(""); }
  };

  const hcReady = !!(hcStateCode && hcBenchCode);

  const runSearchHc = async () => {
    if (!hcReady || !lkType || !lkNumber.trim() || !lkYear) return;
    setSearching(true); setSearchError("");
    try {
      const res = await axios.post("/api/courtsearch/hc/search", {
        state_code: hcStateCode,
        court_complex: hcBenchCode,
        case_type: lkType.value,
        case_number: lkNumber.trim(),
        case_year: Number(lkYear),
      }, authHeaders);
      const mapped = mapHcToCase(res.data, lkType.label);
      setNewCase({ ...EMPTY_CASE, ...mapped });
      setFetchedRecord(res.data);
      setFetchedQuery({
        state_code: hcStateCode, court_complex: hcBenchCode,
        case_type: lkType.value, case_number: lkNumber.trim(), case_year: Number(lkYear),
      });
      setCaseNumberError(mapped.caseNumber.trim() ? "" : "Enter the case number to save.");
      setStep("review");
    } catch (err) {
      setSearchError(err?.response?.data?.error || "Lookup failed. Please try again.");
    } finally {
      setSearching(false);
    }
  };

  const runSearch = async () => {
    if (!selectedCourt || !lkType || !lkNumber.trim() || !lkYear) return;
    setSearching(true); setSearchError("");
    try {
      const res = await axios.post("/api/courtsearch/search", {
        court_id: selectedCourt.id,
        case_type: lkType.value,
        case_number: lkNumber.trim(),
        case_year: Number(lkYear),
      }, authHeaders);
      const mapped = mapCourtRecordToCase(res.data, lkType.value);
      setNewCase({ ...EMPTY_CASE, ...mapped });
      setFetchedRecord(res.data);
      setFetchedQuery({ case_type: lkType.value, case_number: lkNumber.trim(), case_year: Number(lkYear) });
      setCaseNumberError(mapped.caseNumber.length !== 16 ? "Case Number must be exactly 16 digits." : "");
      setStep("review");
    } catch (err) {
      setSearchError(err?.response?.data?.error || "Lookup failed. Please try again.");
    } finally {
      setSearching(false);
    }
  };

  // Unified CNR lookup: the backend queries District Courts and High Courts
  // concurrently and tells us which one actually had the case (courtId) - use
  // that exactly like selectedCourt.id is used everywhere else (mapping,
  // CourtRecordView, parties/events extraction, imported-record courtId).
  // The Supreme Court is NOT part of this - its own CNR search stays inside
  // the Supreme Court forum (its CAPTCHA-solving is much slower than eCourts,
  // so folding it into this fan-out would drag every ordinary District/High
  // Court lookup's worst case down to SCI's pace).
  const runSearchCnr = async () => {
    const cnr = cnrInput.trim();
    if (!cnr) return;
    setSearching(true); setSearchError("");
    try {
      const res = await axios.post("/api/courtsearch/cnr", { cnr }, authHeaders);
      const courtId = res.data?.courtId === "ecourts_hc" ? "ecourts_hc" : "ecourts_dc";
      const record = { cases: res.data?.cases || [] };
      const mapped = courtId === "ecourts_hc" ? mapHcToCase(record, "") : mapEcourtsToCase(record, "");
      setSelectedCourt({
        id: courtId,
        name: courtId === "ecourts_hc" ? "High Court (via CNR)" : "District Court (via CNR)",
      });
      setNewCase({ ...EMPTY_CASE, ...mapped });
      setFetchedRecord(record);
      setFetchedQuery({ cnr });
      setCaseNumberError(mapped.caseNumber.trim() ? "" : "Enter the case number to save.");
      setStep("review");
    } catch (err) {
      setSearchError(err?.response?.data?.error || "Lookup failed. Please try again.");
    } finally {
      setSearching(false);
    }
  };

  const runSearchEcourts = async () => {
    if (!ecStateCode || !ecDistCode || !ecComplexVal || (needsEst && !ecEstCode) || !lkType || !lkNumber.trim() || !lkYear) return;
    setSearching(true); setSearchError("");
    try {
      const res = await axios.post("/api/courtsearch/ecourts/search", {
        state_code: Number(ecStateCode),
        dist_code: Number(ecDistCode),
        court_complex: ecComplexVal,
        est_code: ecEstCode || null,
        case_type: lkType.value,
        case_number: lkNumber.trim(),
        case_year: Number(lkYear),
      }, authHeaders);
      const mapped = mapEcourtsToCase(res.data, lkType.label);
      setNewCase({ ...EMPTY_CASE, ...mapped });
      setFetchedRecord(res.data);
      setFetchedQuery({
        state_code: Number(ecStateCode), dist_code: Number(ecDistCode),
        court_complex: ecComplexVal, est_code: ecEstCode || null,
        case_type: lkType.value, case_number: lkNumber.trim(), case_year: Number(lkYear),
      });
      setCaseNumberError(mapped.caseNumber.trim() ? "" : "Enter the case number to save.");
      setStep("review");
    } catch (err) {
      setSearchError(err?.response?.data?.error || "Lookup failed. Please try again.");
    } finally {
      setSearching(false);
    }
  };

  // Cascade codes shared by all eCourts list-search modes.
  const ecCascade = () => ({
    state_code: Number(ecStateCode), dist_code: Number(ecDistCode),
    court_complex: ecComplexVal, est_code: ecEstCode || null,
  });

  const loadPoliceStations = useCallback(async () => {
    setCascadeBusy("police"); setPoliceStations({}); setFirPolice("");
    try {
      const rows = selectedCourt?.id === "ecourts_hc"
        ? await hcGet("police-stations", { state_code: hcStateCode, court_complex: hcBenchCode })
        : await ecGet("police-stations", {
            state_code: ecStateCode, dist_code: ecDistCode, court_complex: ecComplexVal,
            ...(ecEstCode ? { est_code: ecEstCode } : {}),
          });
      setPoliceStations(rows);
    } catch (e) { setSearchError(e?.response?.data?.error || "Couldn’t load police stations."); }
    finally { setCascadeBusy(""); }
  }, [ecGet, hcGet, selectedCourt, ecStateCode, ecDistCode, ecComplexVal, ecEstCode, hcStateCode, hcBenchCode]);

  const loadActTypes = useCallback(async (search) => {
    setCascadeBusy("acts"); setActTypes({}); setActCode("");
    try {
      const acts = selectedCourt?.id === "ecourts_hc"
        ? await hcGet("act-types", { state_code: hcStateCode, court_complex: hcBenchCode, search: search || "" })
        : await ecGet("act-types", {
            state_code: ecStateCode, dist_code: ecDistCode, court_complex: ecComplexVal,
            ...(ecEstCode ? { est_code: ecEstCode } : {}), search: search || "",
          });
      setActTypes(acts);
      // Auto-select when the search narrows to a single act (e.g. "Indian Penal Code").
      const codes = Object.values(acts || {});
      if (codes.length === 1) setActCode(String(codes[0]));
    } catch (e) { setSearchError(e?.response?.data?.error || "Couldn’t load acts."); }
    finally { setCascadeBusy(""); }
  }, [ecGet, hcGet, selectedCourt, ecStateCode, ecDistCode, ecComplexVal, ecEstCode, hcStateCode, hcBenchCode]);

  const runListSearch = async (mode, params) => {
    const isHc = selectedCourt?.id === "ecourts_hc";
    if (isHc ? !hcReady : !(ecStateCode && ecDistCode && ecComplexVal && (!needsEst || ecEstCode))) return;
    setSearching(true); setSearchError(""); setResultRows([]);
    try {
      const url = isHc ? "/api/courtsearch/hc/list-search" : "/api/courtsearch/ecourts/list-search";
      const body = isHc
        ? { state_code: hcStateCode, court_complex: hcBenchCode, mode, params }
        : { ...ecCascade(), mode, params };
      const res = await axios.post(url, body, authHeaders);
      const rows = res.data?.rows || [];
      if (!rows.length) { setSearchError("No matching cases found."); return; }
      setResultRows(rows);
      setStep("results");
    } catch (err) {
      setSearchError(err?.response?.data?.error || "Search failed. Please try again.");
    } finally {
      setSearching(false);
    }
  };

  const pickResult = async (row, i) => {
    // SCI — fetch the full Case Details record for the picked diary no/year.
    if (selectedCourt?.id === "sci") {
      const c = row._sci || {};
      const tok = c.viewToken || {};
      setPicking(i); setSearchError(""); setSciDetail(null);
      setSciSectionsOpen(new Set());
      try {
        const res = await axios.post("/api/courtsearch/sci/case-detail",
          { diary_no: tok.diaryNo, diary_year: tok.diaryYear }, authHeaders);
        const detail = res.data || {};
        const f = detail.fields || {};
        const cnr = (f["CNR Number"] || "").trim();
        const caseNo = (f["Case Number"] || c.caseNumber || "").split("\n")[0].trim();
        setSciDetail(detail);
        setNewCase({
          ...EMPTY_CASE,
          caseNumber: (cnr || caseNo || "").slice(0, 255),
          caseTitle: (detail.parties || [c.petitioner, c.respondent].filter(Boolean).join(" vs ")).slice(0, 255),
          caseType: lkType?.label || "",
          courtLevel: "Supreme Court",
          status: mapSciStatus(f["Status/Stage"] || c.status || ""),
          description: Object.entries(f).slice(0, 8).map(([k, v]) => `${k}: ${v}`).join("\n"),
        });
        setFetchedRecord(null);
        setFetchedQuery({ diary_no: tok.diaryNo, diary_year: tok.diaryYear });
        setCaseNumberError("");
        setStep("review");
      } catch (err) {
        setSearchError(err?.response?.data?.error || "Couldn’t fetch the full case details. Please try again.");
      } finally {
        setPicking(-1);
      }
      return;
    }
    // High Courts — fetch full detail via the HC case:detail endpoint (no court_complex needed).
    if (selectedCourt?.id === "ecourts_hc") {
      setPicking(i); setSearchError("");
      try {
        const res = await axios.post("/api/courtsearch/hc/case-detail",
          { view_token: row.view_token }, authHeaders);
        const mapped = mapHcToCase(res.data, "");
        setNewCase({ ...EMPTY_CASE, ...mapped });
        setFetchedRecord(res.data);
        setFetchedQuery({ state_code: hcStateCode, court_complex: hcBenchCode, view_token: row.view_token });
        setCaseNumberError(mapped.caseNumber.trim() ? "" : "Enter the case number to save.");
        setStep("review");
      } catch (err) {
        setSearchError(err?.response?.data?.error || "Couldn’t fetch that case. Please try again.");
      } finally {
        setPicking(-1);
      }
      return;
    }
    setPicking(i); setSearchError("");
    try {
      const res = await axios.post("/api/courtsearch/ecourts/case-detail",
        { court_complex: ecComplexVal, view_token: row.view_token }, authHeaders);
      const mapped = mapEcourtsToCase(res.data, "");
      setNewCase({ ...EMPTY_CASE, ...mapped });
      setFetchedRecord(res.data);
      setFetchedQuery({ ...ecCascade(), view_token: row.view_token });
      setCaseNumberError(mapped.caseNumber.trim() ? "" : "Enter the case number to save.");
      setStep("review");
    } catch (err) {
      setSearchError(err?.response?.data?.error || "Couldn’t fetch that case. Please try again.");
    } finally {
      setPicking(-1);
    }
  };

  // SCI dropdown sections (Listing Dates, Judgement/Orders, Notices, ...) are
  // listed up front by case-detail but not fetched - load one lazily the
  // first time it's expanded, then cache its content in sciDetail so
  // re-collapsing/re-expanding doesn't re-fetch.
  const toggleSciSection = (sec) => {
    setSciSectionsOpen((prev) => {
      const next = new Set(prev);
      if (next.has(sec.tabName)) next.delete(sec.tabName);
      else next.add(sec.tabName);
      return next;
    });
    if (sec.loaded || !fetchedQuery?.diary_no) return;
    setSciSectionLoading(sec.tabName);
    axios.post("/api/courtsearch/sci/case-section", {
      diary_no: fetchedQuery.diary_no, diary_year: fetchedQuery.diary_year,
      tab_name: sec.tabName, label: sec.label,
    }, authHeaders).then((res) => {
      setSciDetail((prev) => prev && ({
        ...prev,
        sections: (prev.sections || []).map((s) => (s.tabName === sec.tabName ? { ...s, ...res.data } : s)),
      }));
    }).catch((err) => {
      setSearchError(err?.response?.data?.error || "Couldn’t load that section.");
    }).finally(() => {
      setSciSectionLoading("");
    });
  };

  const onEcSearch = () => {
    const isHc = selectedCourt?.id === "ecourts_hc";
    if (ecMode === "cnr") return runSearchCnr();
    if (ecMode === "case_number") return isHc ? runSearchHc() : runSearchEcourts();
    if (ecMode === "party_name") return runListSearch("party_name", { name: pName.trim(), year: ecYear, status: ecStatus });
    if (ecMode === "filing_number") return runListSearch("filing_number", { filing_no: filingNo.trim(), year: ecYear });
    if (ecMode === "advocate") {
      if (advSubMode === "1") return runListSearch("advocate", { adv_name: advName.trim(), adv_mode: "1", status: ecStatus });
      // High Courts take a single free-form bar-registration string (no separate
      // state/code/year fields like district courts).
      if (isHc) {
        if (advSubMode === "2") return runListSearch("advocate", { bar_code: barCode.trim(), adv_mode: "2", status: ecStatus });
        return runListSearch("advocate", { bar_code: barCode.trim(), date: caselistDate.trim(), adv_mode: "3" });
      }
      if (advSubMode === "2") return runListSearch("advocate", { bar_state: barState.trim(), bar_code: barCode.trim(), bar_year: barYear.trim(), adv_mode: "2", status: ecStatus });
      return runListSearch("advocate", { bar_state: barState.trim(), bar_code: barCode.trim(), bar_year: barYear.trim(), date: caselistDate.trim(), adv_mode: "3" });
    }
    if (ecMode === "fir_number") return runListSearch("fir_number", { police_st: firPolice, fir_no: firNo.trim(), year: ecYear, status: ecStatus });
    if (ecMode === "act") return runListSearch("act", { act_code: actCode, section: actSection.trim(), status: ecStatus });
    if (ecMode === "case_type") return runListSearch("case_type", { case_type: lkType?.value, year: ecYear, status: ecStatus });
  };

  const ecSearchEnabled = (() => {
    if (ecMode === "cnr") return !!cnrInput.trim();
    const isHc = selectedCourt?.id === "ecourts_hc";
    const ready = isHc ? hcReady : cascadeReady;
    if (!ready) return false;
    if (ecMode === "case_number") return !!(lkType && lkNumber.trim() && lkYear);
    if (ecMode === "party_name") return pName.trim().length >= 3 && !!ecYear;
    if (ecMode === "filing_number") return !!filingNo.trim() && !!ecYear;
    if (ecMode === "advocate") {
      if (advSubMode === "1") return advName.trim().length >= 3;
      // High Courts only ever collect a single bar-registration field.
      if (isHc) return advSubMode === "2" ? !!barCode.trim() : (!!barCode.trim() && !!caselistDate.trim());
      if (advSubMode === "2") return !!barCode.trim() && !!barYear.trim();
      return !!barCode.trim() && !!caselistDate.trim();
    }
    if (ecMode === "fir_number") return !!firPolice && !!firNo.trim() && !!ecYear;
    if (ecMode === "act") return !!actCode;
    if (ecMode === "case_type") return !!(lkType && ecYear);
    return false;
  })();

  const statusField = () => (
    <div className="ac-field">
      <label>Status</label>
      <div className="ac-status">
        {["Pending", "Disposed", "Both"].map((s) => (
          <label key={s}><input type="radio" name="ecStatus" checked={ecStatus === s} onChange={() => setEcStatus(s)} /> {s}</label>
        ))}
      </div>
    </div>
  );

  // The 16-digit rule is Madras HC's CNR format; eCourts / manual cases use other formats.
  const requires16 = selectedCourt?.id === "madras_hc";

  const onField = (e) => {
    const { name, value } = e.target;
    setNewCase((p) => ({ ...p, [name]: value }));
    if (name === "caseNumber") {
      if (requires16) setCaseNumberError(value.length !== 16 ? "Case Number must be exactly 16 digits." : "");
      else setCaseNumberError(value.trim() ? "" : "Case Number is required.");
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaveError("");
    if (!newCase.clientId) { setSaveError("Please choose a client for this case."); return; }
    if (!newCase.caseNumber.trim()) { setCaseNumberError("Case Number is required."); return; }
    if (requires16 && newCase.caseNumber.length !== 16) { setCaseNumberError("Case Number must be exactly 16 digits."); return; }
    // The cases table caps these columns at varchar(255); the full record is kept separately.
    const cap = (v) => (typeof v === "string" && v.length > 255 ? v.slice(0, 255) : v);
    const payload = {
      ...newCase,
      caseNumber: cap(newCase.caseNumber),
      caseTitle: cap(newCase.caseTitle),
      caseType: cap(newCase.caseType),
      courtLevel: cap(newCase.courtLevel),
      status: cap(newCase.status),
      description: cap(newCase.description),
      amount: newCase.amount ? parseFloat(newCase.amount) : 0,
      client: { id: Number(newCase.clientId) },
    };
    setSaving(true);
    try {
      const res = await axios.post("/api/cases/create", payload, authHeaders);
      const caseId = res.data?.id ?? null;
      // SCI keeps its fetched record in sciDetail rather than fetchedRecord
      // (its shape differs from the eCourts one CourtRecordView renders), but
      // it still has to be persisted like every other imported record. Its
      // dropdown sections are lazy-loaded, so the on-screen copy holds only
      // the ones the user happened to expand - re-fetch with expand=true so
      // the STORED record is complete (Listing Dates, Judgement/Orders,
      // Notices, ...). That costs ~20s, hence only at save time.
      let courtRecord = fetchedRecord;
      if (!courtRecord && selectedCourt?.id === "sci" && sciDetail) {
        courtRecord = sciDetail;
        if (fetchedQuery?.diary_no && fetchedQuery?.diary_year) {
          try {
            const full = await axios.post("/api/courtsearch/sci/case-detail", {
              diary_no: fetchedQuery.diary_no, diary_year: fetchedQuery.diary_year, expand: true,
            }, authHeaders);
            if (full.data) courtRecord = full.data;
          } catch { /* keep the on-screen record if the full fetch fails */ }
        }
      }
      if (courtRecord && caseId) {
        // Persist the full court-API response (all fields/tables/orders) for later use.
        try {
          await axios.post("/api/courtsearch/imported-records", {
            caseId, courtId: selectedCourt?.id || "", query: fetchedQuery || {}, raw: courtRecord,
          }, authHeaders);
        } catch { /* case is saved regardless; record storage is best-effort */ }
        // Populate the case's Parties from the court record (petitioners/respondents + counsel).
        for (const p of buildParties(courtRecord, selectedCourt?.id)) {
          try {
            await axios.post(`/api/workspace/cases/${caseId}/parties`, {
              name: p.name, role: p.role, counsel: p.counsel, isOpponent: p.isOpponent,
            }, authHeaders);
          } catch { /* best-effort */ }
        }
        // Populate Hearings as dated case events (orders handled by a dedicated section later).
        for (const ev of buildEvents(courtRecord, selectedCourt?.id)) {
          try {
            await axios.post("/api/events/create", {
              caseId, title: ev.title, eventType: ev.eventType, description: ev.description, date: ev.date,
            }, authHeaders);
          } catch { /* best-effort */ }
        }
      }
      success && success("Case added to workspace.");
      navigate("/dashboard/cases");
    } catch (err) {
      if (err.response?.status === 409) setCaseNumberError("Case number already exists.");
      else setSaveError(typeof err.response?.data?.message === "string" ? err.response.data.message : "Failed to save case.");
      error && error("Could not save the case.");
    } finally {
      setSaving(false);
    }
  };

  const clientOptions = clients.map((c) => ({ value: c.id, label: `${c.name} — ${c.email}` }));

  // ---- render the editable case form (shared by manual + review) ----
  const renderCaseForm = () => (
    <form className="ac-form" onSubmit={handleSave}>
      <div className="ac-form-grid">
        <div className="ac-field">
          <label>Case Number{requires16 ? " (16 digits)" : ""}</label>
          <input name="caseNumber" value={newCase.caseNumber} onChange={onField} required
                 className={caseNumberError ? "ac-input-error" : ""}
                 placeholder={requires16 ? "16-digit CNR" : "Case number"} />
          {caseNumberError && <span className="ac-field-error">{caseNumberError}</span>}
        </div>
        <div className="ac-field">
          <label>Case Title</label>
          <input name="caseTitle" value={newCase.caseTitle} onChange={onField} required placeholder="Petitioner vs Respondent" />
        </div>
        <div className="ac-field">
          <label>Case Type</label>
          <input name="caseType" value={newCase.caseType} onChange={onField} required placeholder="e.g. WP" />
        </div>
        <div className="ac-field">
          <label>Court Level</label>
          <select name="courtLevel" value={newCase.courtLevel} onChange={onField} required>
            <option value="">Select Court Level</option>
            <option value="District">District</option>
            <option value="High Court">High Court</option>
            <option value="Supreme Court">Supreme Court</option>
          </select>
        </div>
        <div className="ac-field">
          <label>Status</label>
          <select name="status" value={newCase.status} onChange={onField} required>
            <option value="">Select Status</option>
            <option value="Active">Active</option>
            <option value="Pending">Pending</option>
            <option value="Closed">Closed</option>
          </select>
        </div>
        <div className="ac-field">
          <label>Amount</label>
          <input type="number" name="amount" value={newCase.amount} onChange={onField} placeholder="0" />
        </div>
        <div className="ac-field">
          <label>Client</label>
          <Select
            options={clientOptions}
            value={clientOptions.find((o) => o.value === Number(newCase.clientId)) || null}
            onChange={(sel) => setNewCase((p) => ({ ...p, clientId: sel ? sel.value : "" }))}
            isClearable placeholder="Select Client" styles={customSelectStyles}
          />
        </div>
        <div className="ac-field ac-field-full">
          <label>Description</label>
          <textarea name="description" value={newCase.description} onChange={onField} rows={4} placeholder="Description" />
        </div>
      </div>
      {saveError && <p className="ac-error">{saveError}</p>}
      <div className="ac-actions">
        <button type="submit" className="ac-save" disabled={saving}>{saving ? "Saving…" : "Save Case to Workspace"}</button>
      </div>
    </form>
  );

  return (
    <div className="ac-page">
      <div className="ac-topbar">
        <button className="ac-link" onClick={() => navigate("/dashboard/cases")}>
          <FiChevronLeft /> Back to Workspace
        </button>
        <h2>Add Case to Workspace</h2>
      </div>

      {/* STEP 1 — choose forum / source */}
      {step === "select" && (
       <>
        {courtsError && (
          <div className="ac-banner">
            <span>{courtsError}</span>
          </div>
        )}
        <div className="ac-select-grid">
          <div className="ac-panel">
            <div className="ac-panel-head">Quick Select</div>
            <div className="ac-panel-body">
              <div className="ac-search">
                <FiSearch />
                <input value={forumQuery} onChange={(e) => setForumQuery(e.target.value)}
                       placeholder="Start typing to search for a court…" />
              </div>
              <ul className="ac-forum-list">
                {filteredForums.map((f) => (
                  <li key={f.id}>
                    <button className="ac-forum-item" onClick={() => chooseForum(f)}>
                      {f.kind === "manual" ? <FiEdit3 /> : f.kind === "cnr" ? <FiSearch /> : <FiHome />}
                      <span>{f.name}</span>
                    </button>
                  </li>
                ))}
                {filteredForums.length === 0 && <li className="ac-empty">No match.</li>}
              </ul>
            </div>
          </div>

          <div className="ac-panel">
            <div className="ac-panel-head">Available Courts</div>
            <div className="ac-panel-body">
              {courtsLoading && <p className="ac-hint">Loading courts…</p>}
              <ul className="ac-forum-list plain">
                {forums.map((f) => (
                  <li key={f.id}>
                    <button className="ac-forum-item" onClick={() => chooseForum(f)}>
                      {f.kind === "manual" ? <FiEdit3 /> : f.kind === "cnr" ? <FiSearch /> : <FiHome />}
                      <span>{f.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {courtsError
                ? <p className="ac-hint">Online courts are unavailable until the lookup service is running. You can still choose “Offline / Manual Entry”.</p>
                : <p className="ac-hint">More courts appear here automatically as they’re added. Choose “Offline / Manual Entry” to type a case in yourself.</p>}
            </div>
          </div>
        </div>
       </>
      )}

      {/* STEP 2 — search the court record */}
      {/* Madras HC — flat lookup */}
      {step === "search" && selectedCourt && !["ecourts_dc", "ecourts_hc", "sci"].includes(selectedCourt.id) && (
        <div className="ac-card">
          <div className="ac-selected">
            <span>Selected: <strong>{selectedCourt.name}</strong></span>
            <button className="ac-clear" onClick={() => setStep("select")} title="Change court"><FiX /></button>
          </div>
          <div className="ac-search-form">
            <div className="ac-field">
              <label>Case Type</label>
              <Select
                options={caseTypeOptions} value={lkType} onChange={setLkType}
                isLoading={typesLoading} placeholder={typesLoading ? "Loading types…" : "Select case type"}
                styles={customSelectStyles}
              />
            </div>
            <div className="ac-field">
              <label>Case Number</label>
              <input value={lkNumber} onChange={(e) => setLkNumber(e.target.value)} placeholder="Enter case number" />
            </div>
            <div className="ac-field">
              <label>Case Year</label>
              <input type="number" value={lkYear} onChange={(e) => setLkYear(e.target.value)} min="1900" max="2100" placeholder="e.g. 2024" />
            </div>
          </div>
          {searchError && <p className="ac-error">{searchError}</p>}
          <div className="ac-actions">
            <button className="ac-search-btn"
                    onClick={runSearch}
                    disabled={searching || !lkType || !lkNumber.trim() || !lkYear}>
              <FiSearch /> {searching ? "Searching… (up to 30s)" : "Search For Case"}
            </button>
          </div>
        </div>
      )}

      {/* Supreme Court of India — search-type tabs */}
      {step === "search" && selectedCourt && selectedCourt.id === "sci" && (
        <div className="ac-card">
          <div className="ac-selected">
            <span>Selected: <strong>{selectedCourt.name}</strong></span>
            <button className="ac-clear" onClick={() => setStep("select")} title="Change court"><FiX /></button>
          </div>

          <div className="ac-tabs">
            {SCI_TABS.map(([key, label]) => (
              <button key={key} type="button" className={sciMode === key ? "active" : ""} onClick={() => onSciTab(key)}>{label}</button>
            ))}
          </div>

          {sciMode === "case_number" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Case Type</label>
                <Select options={caseTypeOptions} value={lkType} onChange={setLkType} isLoading={typesLoading}
                  placeholder={typesLoading ? "Loading types…" : "Select case type"} styles={customSelectStyles} /></div>
              <div className="ac-field"><label>Case Number</label><input value={lkNumber} onChange={(e) => setLkNumber(e.target.value)} placeholder="Enter case number" /></div>
              <div className="ac-field"><label>Case Year</label><input type="number" value={lkYear} onChange={(e) => setLkYear(e.target.value)} placeholder="e.g. 2024" /></div>
            </div>
          )}
          {sciMode === "diary_no" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Diary Number</label><input value={lkNumber} onChange={(e) => setLkNumber(e.target.value)} placeholder="Diary number" /></div>
              <div className="ac-field"><label>Year</label><input type="number" value={sciYear} onChange={(e) => setSciYear(e.target.value)} placeholder="e.g. 2024" /></div>
            </div>
          )}
          {sciMode === "cnr" && (
            <div className="ac-search-form">
              <div className="ac-field ac-field-full"><label>CNR Number</label>
                <input value={cnrInput} onChange={(e) => setCnrInput(e.target.value)} maxLength={16} placeholder="16-char CNR" /></div>
            </div>
          )}
          {sciMode === "aor_code" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>AOR Code</label><input value={sciAorCode} onChange={(e) => setSciAorCode(e.target.value)} placeholder="Advocate-on-Record code" /></div>
              <div className="ac-field"><label>Year</label><input type="number" value={sciYear} onChange={(e) => setSciYear(e.target.value)} placeholder="e.g. 2024" /></div>
              <div className="ac-field"><label>Party Type</label>
                <div className="ac-status">
                  {[["any", "Any"], ["P", "Petitioner"], ["R", "Respondent"]].map(([v, l]) => (
                    <label key={v}><input type="radio" name="sciAorPartyType" checked={sciAorPartyType === v} onChange={() => setSciAorPartyType(v)} /> {l}</label>
                  ))}
                </div></div>
              <div className="ac-field"><label>Status</label>
                <div className="ac-status">
                  {[["P", "Pending"], ["D", "Disposed"]].map(([v, l]) => (
                    <label key={v}><input type="radio" name="sciAorStatus" checked={sciAorStatus === v} onChange={() => setSciAorStatus(v)} /> {l}</label>
                  ))}
                </div></div>
            </div>
          )}
          {sciMode === "party_name" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Party Name</label><input value={sciPartyName} onChange={(e) => setSciPartyName(e.target.value)} placeholder="Party name (min 3 chars)" /></div>
              <div className="ac-field"><label>Year (optional)</label><input type="number" value={sciYear} onChange={(e) => setSciYear(e.target.value)} placeholder="e.g. 2024" /></div>
              <div className="ac-field"><label>Party Type</label>
                <div className="ac-status">
                  {[["any", "Any"], ["P", "Petitioner"], ["R", "Respondent"]].map(([v, l]) => (
                    <label key={v}><input type="radio" name="sciPartyType" checked={sciPartyType === v} onChange={() => setSciPartyType(v)} /> {l}</label>
                  ))}
                </div></div>
              <div className="ac-field"><label>Status (optional)</label>
                <div className="ac-status">
                  {[["", "Any"], ["P", "Pending"], ["D", "Disposed"]].map(([v, l]) => (
                    <label key={v || "sci-any"}><input type="radio" name="sciPartyStatus" checked={sciPartyStatus === v} onChange={() => setSciPartyStatus(v)} /> {l}</label>
                  ))}
                </div></div>
            </div>
          )}
          <div className="ac-actions">
            <button className="ac-search-btn" onClick={onSciSearch} disabled={searching || !sciSearchEnabled}>
              <FiSearch /> {searching ? "Searching… (solving CAPTCHA, up to 2 min)" : "Search For Case"}
            </button>
          </div>

          {searchError && <p className="ac-error">{searchError}</p>}
        </div>
      )}

      {/* eCourts District Courts — stateful cascade */}
      {step === "search" && selectedCourt && selectedCourt.id === "ecourts_dc" && (
        <div className="ac-card">
          <div className="ac-selected">
            <span>Selected: <strong>{selectedCourt.name}</strong></span>
            <button className="ac-clear" onClick={() => setStep("select")} title="Change court"><FiX /></button>
          </div>
          {/* Cascade selectors — every mode except CNR needs the court location */}
          {ecMode !== "cnr" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>State</label>
                <Select options={mapToOptions(ecStates)} value={mapToOptions(ecStates).find((o) => o.value === ecStateCode) || null}
                  onChange={onSelectState} isLoading={cascadeBusy === "states"} placeholder="Select state" styles={customSelectStyles} /></div>
              <div className="ac-field"><label>District</label>
                <Select options={mapToOptions(ecDistricts)} value={mapToOptions(ecDistricts).find((o) => o.value === ecDistCode) || null}
                  onChange={onSelectDistrict} isDisabled={!ecStateCode} isLoading={cascadeBusy === "districts"} placeholder="Select district" styles={customSelectStyles} /></div>
              <div className="ac-field"><label>Court Complex</label>
                <Select options={mapToOptions(ecComplexes)} value={mapToOptions(ecComplexes).find((o) => o.value === ecComplexVal) || null}
                  onChange={onSelectComplex} isDisabled={!ecDistCode} isLoading={cascadeBusy === "complexes"} placeholder="Select court complex" styles={customSelectStyles} /></div>
              {needsEst && (
                <div className="ac-field"><label>Establishment</label>
                  <Select options={mapToOptions(ecEstabs)} value={mapToOptions(ecEstabs).find((o) => o.value === ecEstCode) || null}
                    onChange={onSelectEst} isLoading={cascadeBusy === "establishments"} placeholder="Select establishment" styles={customSelectStyles} /></div>
              )}
            </div>
          )}

          {/* Search-type tabs */}
          <div className="ac-tabs">
            {EC_TABS.map(([key, label]) => (
              <button key={key} type="button" className={ecMode === key ? "active" : ""} onClick={() => onEcTab(key)}>{label}</button>
            ))}
          </div>

          {/* Per-mode fields */}
          {ecMode === "cnr" && (
            <div className="ac-search-form"><div className="ac-field ac-field-full"><label>CNR Number</label>
              <input value={cnrInput} onChange={(e) => setCnrInput(e.target.value)} maxLength={16} placeholder="16-digit CNR, e.g. KLML170000832024" /></div></div>
          )}
          {ecMode === "case_number" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Case Type</label>
                <Select options={caseTypeOptions} value={lkType} onChange={setLkType} isDisabled={!cascadeReady} isLoading={cascadeBusy === "case-types"}
                  placeholder={cascadeBusy === "case-types" ? "Loading types…" : "Select case type"} styles={customSelectStyles} /></div>
              <div className="ac-field"><label>Case Number</label><input value={lkNumber} onChange={(e) => setLkNumber(e.target.value)} placeholder="Enter case number" /></div>
              <div className="ac-field"><label>Case Year</label><input type="number" value={lkYear} onChange={(e) => setLkYear(e.target.value)} placeholder="e.g. 2024" /></div>
            </div>
          )}
          {ecMode === "party_name" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Petitioner / Respondent</label><input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Party name (min 3 chars)" /></div>
              <div className="ac-field"><label>Registration Year</label><input type="number" value={ecYear} onChange={(e) => setEcYear(e.target.value)} placeholder="e.g. 2024" /></div>
              {statusField()}
            </div>
          )}
          {ecMode === "filing_number" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Filing Number</label><input value={filingNo} onChange={(e) => setFilingNo(e.target.value)} placeholder="Filing number" /></div>
              <div className="ac-field"><label>Filing Year</label><input type="number" value={ecYear} onChange={(e) => setEcYear(e.target.value)} placeholder="e.g. 2024" /></div>
            </div>
          )}
          {ecMode === "advocate" && (
            <>
              <div className="ac-status" style={{ marginBottom: 12 }}>
                {[["1", "Advocate Name"], ["2", "Bar Code"], ["3", "Date Case List"]].map(([v, l]) => (
                  <label key={v}><input type="radio" name="advSubMode" checked={advSubMode === v} onChange={() => setAdvSubMode(v)} /> {l}</label>
                ))}
              </div>
              <div className="ac-search-form">
                {advSubMode === "1" && (
                  <>
                    <div className="ac-field"><label>Advocate Name</label><input value={advName} onChange={(e) => setAdvName(e.target.value)} placeholder="Advocate name (min 3 chars)" /></div>
                    {statusField()}
                  </>
                )}
                {advSubMode === "2" && (
                  <>
                    <div className="ac-field"><label>State Code</label><input value={barState} onChange={(e) => setBarState(e.target.value)} placeholder="e.g. KL" /></div>
                    <div className="ac-field"><label>Bar Code Number</label><input value={barCode} onChange={(e) => setBarCode(e.target.value)} placeholder="Bar registration no." /></div>
                    <div className="ac-field"><label>Bar Year</label><input type="number" value={barYear} onChange={(e) => setBarYear(e.target.value)} placeholder="e.g. 1998" /></div>
                    {statusField()}
                  </>
                )}
                {advSubMode === "3" && (
                  <>
                    <div className="ac-field"><label>State Code</label><input value={barState} onChange={(e) => setBarState(e.target.value)} placeholder="e.g. KL" /></div>
                    <div className="ac-field"><label>Bar Code Number</label><input value={barCode} onChange={(e) => setBarCode(e.target.value)} placeholder="Bar registration no." /></div>
                    <div className="ac-field"><label>Bar Year</label><input type="number" value={barYear} onChange={(e) => setBarYear(e.target.value)} placeholder="e.g. 1998" /></div>
                    <div className="ac-field"><label>Cause List Date</label><input value={caselistDate} onChange={(e) => setCaselistDate(e.target.value)} placeholder="dd-mm-yyyy" /></div>
                  </>
                )}
              </div>
            </>
          )}
          {ecMode === "fir_number" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Police Station</label>
                <Select options={mapToOptions(policeStations)} value={mapToOptions(policeStations).find((o) => o.value === firPolice) || null}
                  onChange={(o) => setFirPolice(o ? o.value : "")} isDisabled={!cascadeReady} isLoading={cascadeBusy === "police"} placeholder="Select police station" styles={customSelectStyles} /></div>
              <div className="ac-field"><label>FIR Number</label><input value={firNo} onChange={(e) => setFirNo(e.target.value)} placeholder="FIR number" /></div>
              <div className="ac-field"><label>Year</label><input type="number" value={ecYear} onChange={(e) => setEcYear(e.target.value)} placeholder="e.g. 2024" /></div>
              {statusField()}
            </div>
          )}
          {ecMode === "act" && (
            <div className="ac-search-form">
              <div className="ac-field ac-field-full"><label>Search Act</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={actSearch} onChange={(e) => setActSearch(e.target.value)} placeholder="Type ≥3 characters, then Find" />
                  <button type="button" className="ac-search-btn" style={{ padding: "0 16px" }} onClick={() => loadActTypes(actSearch)} disabled={!cascadeReady || actSearch.trim().length < 3}>Find</button>
                </div></div>
              <div className="ac-field"><label>Act Type</label>
                <Select options={mapToOptions(actTypes)} value={mapToOptions(actTypes).find((o) => o.value === actCode) || null}
                  onChange={(o) => setActCode(o ? o.value : "")} isLoading={cascadeBusy === "acts"} placeholder="Select act" styles={customSelectStyles} /></div>
              <div className="ac-field"><label>Under Section</label><input value={actSection} onChange={(e) => setActSection(e.target.value)} placeholder="Section (optional)" /></div>
              {statusField()}
            </div>
          )}
          {ecMode === "case_type" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Case Type</label>
                <Select options={caseTypeOptions} value={lkType} onChange={setLkType} isDisabled={!cascadeReady} isLoading={cascadeBusy === "case-types"}
                  placeholder={cascadeBusy === "case-types" ? "Loading types…" : "Select case type"} styles={customSelectStyles} /></div>
              <div className="ac-field"><label>Registration Year</label><input type="number" value={ecYear} onChange={(e) => setEcYear(e.target.value)} placeholder="e.g. 2024" /></div>
              {statusField()}
            </div>
          )}

          <div className="ac-actions">
            <button className="ac-search-btn" onClick={onEcSearch} disabled={searching || !ecSearchEnabled}>
              <FiSearch /> {searching ? "Searching… (up to 30s)" : "Search For Case"}
            </button>
          </div>

          {searchError && <p className="ac-error">{searchError}</p>}
        </div>
      )}

      {/* eCourts High Courts — High Court -> bench -> case type cascade */}
      {step === "search" && selectedCourt && selectedCourt.id === "ecourts_hc" && (
        <div className="ac-card">
          <div className="ac-selected">
            <span>Selected: <strong>{selectedCourt.name}</strong></span>
            <button className="ac-clear" onClick={() => setStep("select")} title="Change court"><FiX /></button>
          </div>
          {/* Bench selectors — every HC search mode needs the High Court + bench */}
          <div className="ac-search-form">
            <div className="ac-field"><label>High Court</label>
              <Select options={mapToOptions(hcCourts)} value={mapToOptions(hcCourts).find((o) => o.value === hcStateCode) || null}
                onChange={onSelectHcCourt} isLoading={cascadeBusy === "hc-courts"} placeholder="Select High Court" styles={customSelectStyles} /></div>
            <div className="ac-field"><label>Bench</label>
              <Select options={mapToOptions(hcBenchList)} value={mapToOptions(hcBenchList).find((o) => o.value === hcBenchCode) || null}
                onChange={(opt) => onSelectHcBench(opt)} isDisabled={!hcStateCode} isLoading={cascadeBusy === "hc-benches"} placeholder="Select bench" styles={customSelectStyles} /></div>
          </div>

          {/* Search-type tabs */}
          <div className="ac-tabs">
            {EC_TABS.map(([key, label]) => (
              <button key={key} type="button" className={ecMode === key ? "active" : ""} onClick={() => onEcTab(key)}>{label}</button>
            ))}
          </div>

          {/* Per-mode fields */}
          {ecMode === "case_number" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Case Type</label>
                <Select options={caseTypeOptions} value={lkType} onChange={setLkType} isDisabled={!hcReady} isLoading={cascadeBusy === "case-types"}
                  placeholder={cascadeBusy === "case-types" ? "Loading types…" : "Select case type"} styles={customSelectStyles} /></div>
              <div className="ac-field"><label>Case Number</label><input value={lkNumber} onChange={(e) => setLkNumber(e.target.value)} placeholder="Enter case number" /></div>
              <div className="ac-field"><label>Case Year</label><input type="number" value={lkYear} onChange={(e) => setLkYear(e.target.value)} placeholder="e.g. 2024" /></div>
            </div>
          )}
          {ecMode === "party_name" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Petitioner / Respondent</label><input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Party name (min 3 chars)" /></div>
              <div className="ac-field"><label>Registration Year</label><input type="number" value={ecYear} onChange={(e) => setEcYear(e.target.value)} placeholder="e.g. 2024" /></div>
              {statusField()}
            </div>
          )}
          {ecMode === "filing_number" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Filing Number</label><input value={filingNo} onChange={(e) => setFilingNo(e.target.value)} placeholder="Filing number" /></div>
              <div className="ac-field"><label>Filing Year</label><input type="number" value={ecYear} onChange={(e) => setEcYear(e.target.value)} placeholder="e.g. 2024" /></div>
            </div>
          )}
          {ecMode === "advocate" && (
            <>
              <div className="ac-status" style={{ marginBottom: 12 }}>
                {[["1", "Advocate Name"], ["2", "Bar Code"], ["3", "Date Case List"]].map(([v, l]) => (
                  <label key={v}><input type="radio" name="advSubModeHc" checked={advSubMode === v} onChange={() => setAdvSubMode(v)} /> {l}</label>
                ))}
              </div>
              <div className="ac-search-form">
                {advSubMode === "1" && (
                  <>
                    <div className="ac-field"><label>Advocate Name</label><input value={advName} onChange={(e) => setAdvName(e.target.value)} placeholder="Advocate name (min 3 chars)" /></div>
                    {statusField()}
                  </>
                )}
                {advSubMode !== "1" && (
                  <>
                    <div className="ac-field"><label>Bar Registration No.</label><input value={barCode} onChange={(e) => setBarCode(e.target.value)} placeholder="Bar registration no." /></div>
                    {advSubMode === "2" && statusField()}
                    {advSubMode === "3" && (
                      <div className="ac-field"><label>Case List Date</label><input value={caselistDate} onChange={(e) => setCaselistDate(e.target.value)} placeholder="dd-mm-yyyy" /></div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
          {ecMode === "fir_number" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Police Station</label>
                <Select options={mapToOptions(policeStations)} value={mapToOptions(policeStations).find((o) => o.value === firPolice) || null}
                  onChange={(o) => setFirPolice(o ? o.value : "")} isDisabled={!hcReady} isLoading={cascadeBusy === "police"} placeholder="Select police station" styles={customSelectStyles} /></div>
              <div className="ac-field"><label>FIR Number</label><input value={firNo} onChange={(e) => setFirNo(e.target.value)} placeholder="FIR number" /></div>
              <div className="ac-field"><label>Year</label><input type="number" value={ecYear} onChange={(e) => setEcYear(e.target.value)} placeholder="e.g. 2024" /></div>
              {statusField()}
            </div>
          )}
          {ecMode === "act" && (
            <div className="ac-search-form">
              <div className="ac-field ac-field-full"><label>Search Act</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={actSearch} onChange={(e) => setActSearch(e.target.value)} placeholder="Type ≥3 characters, then Find" />
                  <button type="button" className="ac-search-btn" style={{ padding: "0 16px" }} onClick={() => loadActTypes(actSearch)} disabled={!hcReady || actSearch.trim().length < 3}>Find</button>
                </div></div>
              <div className="ac-field"><label>Act Type</label>
                <Select options={mapToOptions(actTypes)} value={mapToOptions(actTypes).find((o) => o.value === actCode) || null}
                  onChange={(o) => setActCode(o ? o.value : "")} isLoading={cascadeBusy === "acts"} placeholder="Select act" styles={customSelectStyles} /></div>
              <div className="ac-field"><label>Under Section</label><input value={actSection} onChange={(e) => setActSection(e.target.value)} placeholder="Section (optional)" /></div>
              {statusField()}
            </div>
          )}
          {ecMode === "case_type" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Case Type</label>
                <Select options={caseTypeOptions} value={lkType} onChange={setLkType} isDisabled={!hcReady} isLoading={cascadeBusy === "case-types"}
                  placeholder={cascadeBusy === "case-types" ? "Loading types…" : "Select case type"} styles={customSelectStyles} /></div>
              <div className="ac-field"><label>Registration Year</label><input type="number" value={ecYear} onChange={(e) => setEcYear(e.target.value)} placeholder="e.g. 2024" /></div>
              {statusField()}
            </div>
          )}

          <div className="ac-actions">
            <button className="ac-search-btn" onClick={onEcSearch} disabled={searching || !ecSearchEnabled}>
              <FiSearch /> {searching ? "Searching… (solving CAPTCHA, up to 60s)" : "Search For Case"}
            </button>
          </div>

          {searchError && <p className="ac-error">{searchError}</p>}
        </div>
      )}

      {/* Results list (list-returning modes) — pick one to fetch its full detail */}
      {step === "results" && (
        <div className="ac-card">
          <div className="ac-selected">
            <span>{resultRows.length} matching case{resultRows.length === 1 ? "" : "s"} — pick one to import</span>
            <button className="ac-clear" onClick={() => setStep("search")} title="Back to search"><FiX /></button>
          </div>
          <div className="ac-rtable-wrap">
            <table className="ac-rtable">
              <thead><tr><th>#</th><th>Case Number</th><th>Parties</th><th></th></tr></thead>
              <tbody>
                {resultRows.map((row, i) => (
                  <tr key={i}>
                    <td>{row.sr_no || i + 1}</td>
                    <td>{row.case_number}</td>
                    <td>{row.parties}</td>
                    <td>
                      <button type="button" className="ac-search-btn" style={{ padding: "6px 14px" }}
                        onClick={() => pickResult(row, i)} disabled={picking !== -1}>
                        {picking === i ? "Fetching…" : "Select"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {searchError && <p className="ac-error">{searchError}</p>}
        </div>
      )}

      {/* STEP 3 — review the fetched record + save */}
      {step === "review" && (
        <div className="ac-card">
          <div className="ac-selected">
            <span>{fetchedRecord ? <>Fetched from <strong>{selectedCourt?.name}</strong> — review and save</>
                                  : <>From <strong>{selectedCourt?.name}</strong> — review and save</>}</span>
            <button className="ac-clear" onClick={() => setStep(resultRows.length ? "results" : "search")} title="Back"><FiX /></button>
          </div>

          {fetchedRecord ? (
            <>
              <div className="ac-record">
                <div className="ac-record-head">Case details from the court</div>
                <CourtRecordView record={fetchedRecord} courtComplex={ecComplexVal} courtId={selectedCourt?.id} />
              </div>

              <div className="ac-savebar">
                <div className="ac-field">
                  <label>Assign to client</label>
                  <Select
                    options={clientOptions}
                    value={clientOptions.find((o) => o.value === Number(newCase.clientId)) || null}
                    onChange={(sel) => setNewCase((p) => ({ ...p, clientId: sel ? sel.value : "" }))}
                    isClearable placeholder="Select client" styles={customSelectStyles}
                  />
                </div>
                {caseNumberError && <p className="ac-error">{caseNumberError}</p>}
                {saveError && <p className="ac-error">{saveError}</p>}
                <div className="ac-actions">
                  <button type="button" className="ac-save" onClick={handleSave} disabled={saving}>
                    {saving ? "Saving…" : "Save Case to Workspace"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              {sciDetail && (
                <div className="ac-record">
                  <div className="ac-record-head">
                    Case details from the Supreme Court
                    {sciDetail.diaryNo ? ` — Diary No. ${sciDetail.diaryNo}` : ""}
                  </div>
                  {sciDetail.parties && <p className="ac-sci-parties">{sciDetail.parties}</p>}
                  <div className="ac-rtable-wrap">
                    <table className="ac-rtable ac-sci-detail">
                      <tbody>
                        {Object.entries(sciDetail.fields || {}).map(([k, v]) => (
                          <tr key={k}>
                            <th style={{ width: "28%", textAlign: "left", verticalAlign: "top" }}>{k}</th>
                            <td style={{ whiteSpace: "pre-line" }}>{v}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {(sciDetail.sections || []).length > 0 && (
                    <div className="ac-sci-sections">
                      {sciDetail.sections.map((sec) => {
                        const isOpen = sciSectionsOpen.has(sec.tabName);
                        return (
                          <div key={sec.tabName} className={`ac-sci-section ${isOpen ? "open" : ""}`}>
                            <button type="button" className="ac-sci-section-toggle" onClick={() => toggleSciSection(sec)}>
                              <span>{sec.label}</span>
                              <FiChevronDown className="ac-sci-section-chevron" />
                            </button>
                            {isOpen && (
                              <div className="ac-sci-section-body">
                                {sciSectionLoading === sec.tabName && <p className="ac-record-note">Loading…</p>}
                                {sec.loaded && sec.empty && <p className="ac-record-note">No records.</p>}
                                {sec.loaded && !sec.empty && sec.columns?.length > 0 && (
                                  <div className="ac-rtable-wrap">
                                    <table className="ac-rtable">
                                      <thead><tr>{sec.columns.map((c, ci) => <th key={ci}>{c}</th>)}</tr></thead>
                                      <tbody>
                                        {(sec.rows || []).map((row, ri) => (
                                          <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                                {sec.loaded && !sec.empty && !(sec.columns?.length > 0) && sec.links?.length > 0 && (
                                  <ul className="ac-sci-links">
                                    {sec.links.map((l, li) => (
                                      <li key={li}><a href={l.href} target="_blank" rel="noreferrer">{l.text}</a></li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <div className="ac-savebar">
                <div className="ac-field">
                  <label>Assign to client</label>
                  <Select
                    options={clientOptions}
                    value={clientOptions.find((o) => o.value === Number(newCase.clientId)) || null}
                    onChange={(sel) => setNewCase((p) => ({ ...p, clientId: sel ? sel.value : "" }))}
                    isClearable placeholder="Select client" styles={customSelectStyles}
                  />
                </div>
                {caseNumberError && <p className="ac-error">{caseNumberError}</p>}
                {saveError && <p className="ac-error">{saveError}</p>}
                <div className="ac-actions">
                  <button type="button" className="ac-save" onClick={handleSave} disabled={saving}>
                    {saving ? "Saving…" : "Save Case to Workspace"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Manual entry */}
      {step === "manual" && (
        <div className="ac-card">
          <div className="ac-selected">
            <span>Manual entry</span>
            <button className="ac-clear" onClick={() => setStep("select")} title="Back"><FiX /></button>
          </div>
          {renderCaseForm()}
        </div>
      )}

      {/* Standalone CNR lookup (no court selection needed) */}
      {/* Unified CNR lookup - the backend tries District Courts and High
          Courts concurrently, so there's just the one box regardless of which
          portal actually has the case. */}
      {step === "cnr" && (
        <div className="ac-card">
          <div className="ac-selected">
            <span>Search by CNR Number</span>
            <button className="ac-clear" onClick={() => setStep("select")} title="Back"><FiX /></button>
          </div>
          <div className="ac-search-form">
            <div className="ac-field ac-field-full">
              <label>CNR Number</label>
              <input value={cnrInput} onChange={(e) => setCnrInput(e.target.value)} maxLength={16}
                placeholder="16-char CNR, e.g. KLML170000832024" />
            </div>
          </div>
          <div className="ac-actions">
            <button className="ac-search-btn" onClick={runSearchCnr} disabled={searching || !cnrInput.trim()}>
              <FiSearch /> {searching ? "Searching… (checking District & High Court records, up to 60s)" : "Search For Case"}
            </button>
          </div>
          {searchError && <p className="ac-error">{searchError}</p>}
        </div>
      )}
    </div>
  );
}
