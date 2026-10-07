import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/client";
import { useToast } from "../contexts/ToastContext";
import CourtRecordView from "../components/CourtRecordView";
import { Button, PageHead, Panel, Skel, Icon, StatusChip } from "../ui/kit";
import type { IconName } from "../ui/Icon";
import { TextField, TextArea, SelectField, Segmented, Tabs } from "../ui/forms";
import { DataTable } from "../ui/DataTable";
import "../ui/pages/cases.css";

// A react-select-shaped wrapper over a native select, so the (many) cascade
// selectors below keep their option-object value / onChange(option) contract.
// While options load the control is disabled and says so.
function Select({ label, options, value, onChange, placeholder, isLoading, isDisabled, full }: any) {
  const opts: any[] = options || [];
  return (
    <SelectField
      label={label}
      full={full}
      options={opts.map((o) => ({ value: String(o.value), label: o.label }))}
      value={value ? String(value.value) : ""}
      placeholder={isLoading ? "Loading…" : (placeholder || "Select")}
      disabled={!!isDisabled || !!isLoading}
      onChange={(e) => onChange(e.target.value === "" ? null : (opts.find((o) => String(o.value) === e.target.value) || null))}
    />
  );
}

// A labelled single choice (was a radio group): a segmented control.
function Choice({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="field cs-choice">
      <span className="label">{label}</span>
      <Segmented label={label} value={value} onChange={onChange} options={options.map(([v, l]) => ({ value: v, label: l }))} />
    </div>
  );
}

const COURT_LEVELS = ["District", "High Court", "Supreme Court", "Tribunal"].map((v) => ({ value: v, label: v === "Tribunal" ? "Tribunal / other forum" : v }));

// Manual entry (backend: workspace/case_profile.py). An unfiled suit or
// non-litigation work has no court number yet; the server assigns PRE/... or MAT/...
const MATTER_TYPES = [
  { value: "litigation", label: "Litigation (filed in a court or tribunal)" },
  { value: "pre_filing", label: "Not filed yet (drafting / notice stage)" },
  { value: "non_litigation", label: "Non-litigation (advisory, contract, notice)" },
];
// Which side the client is on, and what the other side is then called.
const SIDES: Record<string, string> = {
  Plaintiff: "Defendant", Petitioner: "Respondent", Appellant: "Respondent", Applicant: "Respondent",
  Complainant: "Accused", Defendant: "Plaintiff", Respondent: "Petitioner", Accused: "Complainant",
};
const SIDE_OPTIONS = Object.keys(SIDES).map((v) => ({ value: v, label: v }));
const CASE_STATUSES = ["Active", "Pending", "Closed"].map((v) => ({ value: v, label: v }));

/**
 * Save a fetched court record onto a case: the full record, its parties, and
 * its upcoming hearings as events. Used when importing a case (Add Case) and
 * when linking an existing manual case to its court record (Case Detail).
 * `skipPartyNames` leaves out parties the case already has, so linking a
 * manual case doesn't list the client twice. Every step is best-effort: the
 * case is saved regardless.
 */
export async function persistCourtRecord(caseId: number, courtId: string, query: any, courtRecord: any,
                                         skipPartyNames: string[] = []) {
  const known = new Set(skipPartyNames.map((n) => n.trim().toLowerCase()));
  // Persist the full court-API response (all fields/tables/orders) for later use.
  try {
    await api.post("/api/courtsearch/imported-records", {
      caseId, courtId, query, raw: courtRecord,
    });
  } catch { /* case is saved regardless; record storage is best-effort */ }
  // Populate the case's Parties from the court record (petitioners/respondents + counsel).
  for (const p of buildParties(courtRecord, courtId).filter((p) => !known.has(String(p.name || "").trim().toLowerCase()))) {
    try {
      await api.post(`/api/workspace/cases/${caseId}/parties`, {
        name: p.name, role: p.role, counsel: p.counsel, isOpponent: p.isOpponent,
      });
    } catch { /* best-effort */ }
  }
  // Populate only UPCOMING hearings as case events (so "Next Hearing" works).
  // Past court hearings are NOT imported as events — they live, in full, in
  // the case's read-only Court Hearing History, so importing them here would
  // just duplicate that with messier calendar rows.
  const _todayISO = new Date().toISOString().slice(0, 10);
  for (const ev of buildEvents(courtRecord, courtId).filter((ev) => ev.date && ev.date >= _todayISO)) {
    try {
      await api.post("/api/events/create", {
        caseId, title: ev.title, eventType: ev.eventType, description: ev.description, date: ev.date,
      });
    } catch { /* best-effort */ }
  }
}

const EMPTY_CASE = {
  caseNumber: "", caseTitle: "", caseType: "", courtLevel: "",
  status: "", amount: "", description: "", clientId: "",
  // Manual entry only (an import gets these from the court record).
  matterType: "litigation", courtName: "", courtHall: "", judge: "", ourSide: "",
  filingDate: "", caseYear: "", cnr: "", actsSections: "",
  opponentName: "", opponentCounsel: "", nextHearingDate: "", nextHearingPurpose: "",
};


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
// eCourts CNR = 16 chars: 4 letters (state+district+establishment) + 12 digits.
// e.g. KLML170000832024. Case-insensitive — users may type lowercase.
const CNR_RE = /^[A-Za-z]{4}\d{12}$/;
const isValidCnr = (v) => CNR_RE.test(String(v || "").trim());
const CNR_WARNING = "CNR must be 16 characters: 4 letters + 12 digits (e.g. KLML170000832024).";

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


export default function AddCase() {
  const navigate = useNavigate();
  const { success, error } = useToast();

  const [step, setStep] = useState("select"); // select | search | review | manual
  const [courts, setCourts] = useState([]);
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
        const res = await api.get("/api/clients/my-clients");
        setClients(res.data || []);
      } catch { /* client list optional here */ }
    })();
    (async () => {
      setCourtsLoading(true);
      try {
        const res = await api.get("/api/courtsearch/courts");
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

  // CNR validity — shared by the three online CNR search inputs (all use cnrInput).
  const cnrTrimmed = cnrInput.trim();
  const cnrValid = isValidCnr(cnrTrimmed);
  const cnrWarn = cnrTrimmed.length > 0 && !cnrValid;  // show only after typing

  const loadCaseTypes = useCallback(async (courtId) => {
    setTypesLoading(true); setCaseTypes({}); setLkType(null);
    try {
      const res = await api.get(`/api/courtsearch/courts/${courtId}/case-types`);
      setCaseTypes(res.data || {});
    } catch { /* ignore */ } finally { setTypesLoading(false); }
  }, []);

  // ---- eCourts cascade fetchers ----
  const ecGet = useCallback(async (stepName: string, params: any = undefined) => {
    setSearchError("");
    const res = await api.get(`/api/courtsearch/ecourts/${stepName}`, { params });
    return res.data || {};
  }, []);

  // Same shape as ecGet, but for the High Court cascade (police-stations/act-types).
  const hcGet = useCallback(async (stepName: string, params: any = undefined) => {
    setSearchError("");
    const res = await api.get(`/api/courtsearch/hc/${stepName}`, { params });
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
      const res = await api.get("/api/courtsearch/sci/case-types");
      setCaseTypes(res.data || {});
    } catch { /* ignore */ } finally { setTypesLoading(false); }
  }, []);

  const mapSciStatus = (s) => (/dispos/i.test(s) ? "Closed" : "Pending");

  // Shared by every SCI search mode: same request/response shape
  // ({ cases: [...] }), just a different endpoint + body per mode.
  const runSearchSciMode = async (url, body) => {
    setSearching(true); setSearchError(""); setResultRows([]);
    try {
      const res = await api.post(url, body);
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
    if (sciMode === "cnr") return cnrValid;
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
      const res = await api.get("/api/courtsearch/hc/high-courts");
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
      const res = await api.get("/api/courtsearch/hc/benches", { params: { state_code: code } });
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

  const onSelectHcBench = async (opt: any, stateCodeOverride = "") => {
    const code = opt ? opt.value : "";
    const stateCode = stateCodeOverride || hcStateCode;
    setHcBenchCode(code);
    setCaseTypes({}); setLkType(null); setSearchError("");
    if (!code) return;
    setCascadeBusy("case-types");
    try {
      const res = await api.get("/api/courtsearch/hc/case-types", { params: { state_code: stateCode, court_complex: code } });
      setCaseTypes(res.data || {});
    } catch (e) { setSearchError(e?.response?.data?.error || "Couldn’t load case types."); }
    finally { setCascadeBusy(""); }
  };

  const hcReady = !!(hcStateCode && hcBenchCode);

  const runSearchHc = async () => {
    if (!hcReady || !lkType || !lkNumber.trim() || !lkYear) return;
    setSearching(true); setSearchError("");
    try {
      const res = await api.post("/api/courtsearch/hc/search", {
        state_code: hcStateCode,
        court_complex: hcBenchCode,
        case_type: lkType.value,
        case_number: lkNumber.trim(),
        case_year: Number(lkYear),
      });
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
      const res = await api.post("/api/courtsearch/search", {
        court_id: selectedCourt.id,
        case_type: lkType.value,
        case_number: lkNumber.trim(),
        case_year: Number(lkYear),
      });
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
      const res = await api.post("/api/courtsearch/cnr", { cnr });
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
      const res = await api.post("/api/courtsearch/ecourts/search", {
        state_code: Number(ecStateCode),
        dist_code: Number(ecDistCode),
        court_complex: ecComplexVal,
        est_code: ecEstCode || null,
        case_type: lkType.value,
        case_number: lkNumber.trim(),
        case_year: Number(lkYear),
      });
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
      const res = await api.post(url, body);
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
        const res = await api.post("/api/courtsearch/sci/case-detail",
          { diary_no: tok.diaryNo, diary_year: tok.diaryYear });
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
        const res = await api.post("/api/courtsearch/hc/case-detail",
          { view_token: row.view_token });
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
      const res = await api.post("/api/courtsearch/ecourts/case-detail",
        { court_complex: ecComplexVal, view_token: row.view_token });
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
    api.post("/api/courtsearch/sci/case-section", {
      diary_no: fetchedQuery.diary_no, diary_year: fetchedQuery.diary_year,
      tab_name: sec.tabName, label: sec.label,
    }).then((res) => {
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
    if (ecMode === "cnr") return cnrValid;
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
    <Choice label="Status" value={ecStatus} onChange={setEcStatus} options={[["Pending", "Pending"], ["Disposed", "Disposed"], ["Both", "Both"]]} />
  );

  // The 16-digit rule is Madras HC's CNR format; eCourts / manual cases use other formats.
  const requires16 = selectedCourt?.id === "madras_hc";
  const isManual = step === "manual";
  const isLitigation = !isManual || newCase.matterType === "litigation";
  // An unfiled or non-litigation matter has no court number; the server assigns one.
  const numberRequired = isLitigation;

  // Soft, non-blocking CNR hint for the manual Case Number: only when the value
  // looks like an attempted CNR (16 chars) but breaks the pattern. Skipped when
  // requires16 (Madras HC keeps its own rule) to avoid double messaging.
  const caseNumberCnrHint =
    !requires16 &&
    newCase.caseNumber.trim().length === 16 &&
    !isValidCnr(newCase.caseNumber)
      ? "Doesn't match CNR format (4 letters + 12 digits) — save anyway if this isn't a CNR."
      : "";

  const onField = (e) => {
    const { name, value } = e.target;
    setNewCase((p) => ({ ...p, [name]: value }));
    if (name === "caseNumber") {
      if (requires16) setCaseNumberError(value.length !== 16 ? "Case Number must be exactly 16 digits." : "");
      else setCaseNumberError(value.trim() || !numberRequired ? "" : "Case Number is required.");
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaveError("");
    if (!newCase.clientId) { setSaveError("Please choose a client for this case."); return; }
    if (numberRequired && !newCase.caseNumber.trim()) { setCaseNumberError("Case Number is required."); return; }
    // The court-level / status Dropdowns carry no native `required`, so check them here.
    // A matter that isn't in a court yet has no court level.
    if ((isLitigation && !newCase.courtLevel) || !newCase.status) {
      setSaveError(isLitigation ? "Please select the court level and status." : "Please select the status.");
      return;
    }
    if (isManual && newCase.cnr && !/^[A-Za-z]{4}\d{12}$/.test(newCase.cnr.trim())) {
      setSaveError("A CNR is 16 characters: 4 letters then 12 digits. Leave it blank if you don't have it.");
      return;
    }
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
      ...(isManual ? {
        matterType: newCase.matterType, courtName: newCase.courtName, courtHall: newCase.courtHall,
        judge: newCase.judge, ourSide: newCase.ourSide, filingDate: newCase.filingDate || null,
        caseYear: newCase.caseYear || null, cnr: newCase.cnr.trim(), actsSections: newCase.actsSections,
      } : {}),
    };
    setSaving(true);
    try {
      const res = await api.post("/api/cases/create", payload);
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
            const full = await api.post("/api/courtsearch/sci/case-detail", {
              diary_no: fetchedQuery.diary_no, diary_year: fetchedQuery.diary_year, expand: true,
            });
            if (full.data) courtRecord = full.data;
          } catch { /* keep the on-screen record if the full fetch fails */ }
        }
      }
      if (isManual && caseId) {
        // What an import takes from the court record, a manual entry takes from
        // the form: our client and the other side on the Parties tab, and the
        // next hearing as an event, so reminders and "Next hearing" work.
        const clientName = clients.find((c) => c.id === Number(newCase.clientId))?.name;
        const parties = [
          clientName && { name: clientName, role: newCase.ourSide || null, counsel: null, isOpponent: false },
          newCase.opponentName.trim() && {
            name: newCase.opponentName.trim(), role: SIDES[newCase.ourSide] || null,
            counsel: newCase.opponentCounsel.trim() || null, isOpponent: true,
          },
        ].filter(Boolean);
        for (const p of parties) {
          try { await api.post(`/api/workspace/cases/${caseId}/parties`, p); } catch { /* best-effort */ }
        }
        if (isLitigation && newCase.nextHearingDate) {
          try {
            await api.post("/api/events/create", {
              caseId, eventType: "HEARING", date: newCase.nextHearingDate,
              title: newCase.nextHearingPurpose ? `Hearing - ${newCase.nextHearingPurpose}` : "Hearing",
              description: [newCase.courtName, newCase.courtHall && `Hall ${newCase.courtHall}`, newCase.judge]
                .filter(Boolean).join(" · "),
            });
          } catch { /* best-effort */ }
        }
      }
      if (courtRecord && caseId) {
        await persistCourtRecord(caseId, selectedCourt?.id || "", fetchedQuery || {}, courtRecord);
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
  const clientValue = clientOptions.find((o) => o.value === Number(newCase.clientId)) || null;
  const setClient = (sel: any) => setNewCase((p) => ({ ...p, clientId: sel ? sel.value : "" }));

  // Small field helpers so the long search forms stay readable.
  const tf = (label: string, value: string, set: (v: string) => void, extra: any = {}) => (
    <TextField label={label} value={value} onChange={(e) => set(e.target.value)} {...extra} />
  );
  const yearField = (label: string, value: string, set: (v: string) => void) =>
    tf(label, value, set, { type: "number", placeholder: "e.g. 2024", min: 1900, max: 2100 });
  const cnrField = (placeholder: string) => (
    <TextField label="CNR number" full value={cnrInput} onChange={(e) => setCnrInput(e.target.value)} maxLength={16}
      className="mono" style={{ textTransform: "uppercase" }} placeholder={placeholder}
      hint={cnrWarn ? undefined : "16 characters, printed on every order sheet."}
      error={cnrWarn ? CNR_WARNING : undefined} />
  );
  const searchError_ = searchError && (
    <div className="callout bad" role="alert" style={{ marginTop: "var(--s4)" }}><Icon name="warn" size="sm" /><div>{searchError}</div></div>
  );
  const searchBtn = (onClick: () => void, enabled: boolean) => (
    <>
      {searching && <p className="faint small" style={{ marginTop: "var(--s3)" }}>Contacting the court website… this can take up to 30 seconds.</p>}
      <div className="row" style={{ marginTop: "var(--s4)" }}>
        <span className="grow" />
        <Button variant="primary" icon="search" loading={searching} onClick={onClick} disabled={searching || !enabled}>
          {searching ? "Searching…" : "Search court records"}
        </Button>
      </div>
    </>
  );
  const changeCourt = <Button variant="ghost" size="sm" onClick={() => setStep("select")}>Change court</Button>;

  // ---- render the editable case form (manual entry) ----
  const renderCaseForm = () => (
    <form className="form-grid" onSubmit={handleSave}>
      <div className="fieldset-title">Case</div>
      {isManual && (
        <SelectField label="Matter type" full value={newCase.matterType} options={MATTER_TYPES}
          onChange={(e) => { setNewCase((p) => ({ ...p, matterType: e.target.value })); setCaseNumberError(""); }} />
      )}
      <TextField label={`Case number${requires16 ? " (16 digits)" : ""}${!numberRequired ? " (optional)" : ""}`}
        name="caseNumber" value={newCase.caseNumber} onChange={onField} required={numberRequired} className="mono"
        error={caseNumberError || undefined} hint={!caseNumberError && caseNumberCnrHint ? caseNumberCnrHint : undefined}
        placeholder={requires16 ? "16-digit CNR" : numberRequired ? "e.g. O.S. No. 412/2025, OA 31/2026"
          : `Leave blank: assigned as ${newCase.matterType === "pre_filing" ? "PRE" : "MAT"}/${new Date().getFullYear()}/…`} />
      <TextField label="Case type" name="caseType" value={newCase.caseType} onChange={onField} required placeholder="e.g. WP" />
      <TextField label="Title" full name="caseTitle" value={newCase.caseTitle} onChange={onField} required placeholder="Petitioner vs Respondent"
        hint='Write the parties as "Petitioner vs Respondent".' />
      <Select label="Court level" options={COURT_LEVELS} value={COURT_LEVELS.find((o) => o.value === newCase.courtLevel) || null}
        placeholder="Select court level" onChange={(o: any) => setNewCase((p) => ({ ...p, courtLevel: o ? o.value : "" }))} />
      <Select label="Status" options={CASE_STATUSES} value={CASE_STATUSES.find((o) => o.value === newCase.status) || null}
        placeholder="Select status" onChange={(o: any) => setNewCase((p) => ({ ...p, status: o ? o.value : "" }))} />
      {isManual && isLitigation && (<>
        <div className="fieldset-title">Court</div>
        <TextField label="Court / tribunal / forum" name="courtName" value={newCase.courtName} onChange={onField} placeholder="e.g. DRT-II Chennai, City Civil Court" />
        <TextField label="Court hall / bench" name="courtHall" value={newCase.courtHall} onChange={onField} placeholder="e.g. Court 28" />
        <TextField label="Judge / presiding officer" name="judge" value={newCase.judge} onChange={onField} placeholder="Optional" />
        <TextField label="Filing date" type="date" name="filingDate" value={newCase.filingDate} onChange={onField} />
        <TextField label="Case year" type="number" name="caseYear" value={newCase.caseYear} onChange={onField} placeholder="e.g. 2025" />
        <TextField label="CNR (optional)" name="cnr" value={newCase.cnr} onChange={onField} maxLength={16} className="mono"
          placeholder="16 characters, if known" hint="With a CNR, the case can be linked to its court record later." />
        <TextField label="Next hearing date" type="date" name="nextHearingDate" value={newCase.nextHearingDate} onChange={onField} />
        <TextField label="Next hearing purpose" name="nextHearingPurpose" value={newCase.nextHearingPurpose} onChange={onField} placeholder="e.g. Counter, Arguments" />
      </>)}
      <div className="fieldset-title">People and fees</div>
      <Select label="Client" options={clientOptions} value={clientValue} onChange={setClient} placeholder="Select client" />
      <TextField label="Agreed fee (₹)" type="number" name="amount" value={newCase.amount} onChange={onField} placeholder="0" min={0}
        hint={'What the client is to pay; "pending from client" is worked out from it.'} />
      {isManual && (<>
        <Select label="Our client is the" options={SIDE_OPTIONS} value={SIDE_OPTIONS.find((o) => o.value === newCase.ourSide) || null}
          placeholder="Select side" onChange={(o: any) => setNewCase((p) => ({ ...p, ourSide: o ? o.value : "" }))} />
        <TextField label="Opposite party" name="opponentName" value={newCase.opponentName} onChange={onField} placeholder="Other side" />
        <TextField label="Opposite party's counsel" name="opponentCounsel" value={newCase.opponentCounsel} onChange={onField} placeholder="Optional" />
        {newCase.matterType !== "non_litigation" && (
          <TextField label="Acts / sections" name="actsSections" value={newCase.actsSections} onChange={onField} placeholder="e.g. CPC Order VII; SARFAESI Act s.17" />
        )}
      </>)}
      <TextArea label="Description" full name="description" value={newCase.description} onChange={onField} rows={4}
        placeholder="Relief sought, background, anything the team should know" />
      {saveError && <div className="callout bad full" role="alert"><Icon name="warn" size="sm" /><div>{saveError}</div></div>}
      <div className="row full">
        <span className="grow" />
        <Button variant="ghost" onClick={() => navigate("/dashboard/cases")}>Cancel</Button>
        <Button variant="primary" type="submit" loading={saving} disabled={saving}>{saving ? "Saving…" : "Save case"}</Button>
      </div>
    </form>
  );

  // The import path walks Court > Search > Results > Review, like the prototype.
  const stepNo = step === "select" ? 1 : step === "search" || step === "cnr" ? 2 : step === "results" ? 3 : 4;
  const steps = (
    <ol className="cs-steps" aria-label="Import steps">
      {["Court", "Search", "Results", "Review"].map((s, i) => (
        <li key={s} aria-current={stepNo === i + 1 ? "step" : undefined} className={stepNo > i + 1 ? "done" : undefined}>
          <b>{stepNo > i + 1 ? <Icon name="check" size="sm" /> : i + 1}</b>{s}
        </li>
      ))}
    </ol>
  );
  const forumIcon = (f: any): IconName => (f.kind === "cnr" ? "search" : f.id === "sci" ? "scale" : "gavel");
  const forumSub = (f: any) => (f.kind === "cnr" ? "District and High Courts, no court selection needed"
    : f.id === "ecourts_dc" ? "eCourts: state, district and court complex"
    : f.id === "ecourts_hc" ? "eCourts: every High Court and bench"
    : f.id === "sci" ? "New Delhi" : "Court records lookup");

  // The client picker and save button shown beside a fetched record.
  const saveRail = (
    <Panel title="Add to your workspace">
      <div className="stack" style={{ gap: "var(--s3)" }}>
        <Select label="Client" options={clientOptions} value={clientValue} onChange={setClient} placeholder="Select a client" />
        {caseNumberError && <div className="callout bad" role="alert"><Icon name="warn" size="sm" /><div>{caseNumberError}</div></div>}
        {saveError && <div className="callout bad" role="alert"><Icon name="warn" size="sm" /><div>{saveError}</div></div>}
        <div className="callout info"><Icon name="info" size="sm" /><div>Parties and upcoming hearings from the court record are saved with the case.</div></div>
        <Button variant="primary" loading={saving} onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save case to workspace"}</Button>
      </div>
    </Panel>
  );

  const ecFields = (isHc: boolean) => {
    const ready = isHc ? hcReady : cascadeReady;
    return (
      <>
        {ecMode === "case_number" && (
          <div className="form-grid">
            <Select label="Case type" options={caseTypeOptions} value={lkType} onChange={setLkType} isDisabled={!ready}
              isLoading={cascadeBusy === "case-types"} placeholder="Select case type" />
            {tf("Case number", lkNumber, setLkNumber, { placeholder: "Case number" })}
            {yearField("Case year", lkYear, setLkYear)}
          </div>
        )}
        {ecMode === "party_name" && (
          <div className="form-grid">
            {tf("Petitioner / respondent", pName, setPName, { placeholder: "Party name (min 3 letters)" })}
            {yearField("Registration year", ecYear, setEcYear)}
            {statusField()}
          </div>
        )}
        {ecMode === "filing_number" && (
          <div className="form-grid">
            {tf("Filing number", filingNo, setFilingNo, { placeholder: "Filing number" })}
            {yearField("Filing year", ecYear, setEcYear)}
          </div>
        )}
        {ecMode === "advocate" && (
          <div className="form-grid">
            <Choice label="Search by" value={advSubMode} onChange={setAdvSubMode}
              options={[["1", "Advocate name"], ["2", "Bar code"], ["3", "Date case list"]]} />
            <span />
            {advSubMode === "1" && (<>
              {tf("Advocate name", advName, setAdvName, { placeholder: "Advocate name (min 3 letters)" })}
              {statusField()}
            </>)}
            {/* High Courts take a single bar-registration string. */}
            {isHc && advSubMode !== "1" && (<>
              {tf("Bar registration no.", barCode, setBarCode, { placeholder: "Bar registration no." })}
              {advSubMode === "2" && statusField()}
              {advSubMode === "3" && tf("Case list date", caselistDate, setCaselistDate, { placeholder: "dd-mm-yyyy" })}
            </>)}
            {!isHc && advSubMode !== "1" && (<>
              {tf("State code", barState, setBarState, { placeholder: "e.g. KL" })}
              {tf("Bar code number", barCode, setBarCode, { placeholder: "Bar registration no." })}
              {tf("Bar year", barYear, setBarYear, { type: "number", placeholder: "e.g. 1998" })}
              {advSubMode === "2" ? statusField() : tf("Cause list date", caselistDate, setCaselistDate, { placeholder: "dd-mm-yyyy" })}
            </>)}
          </div>
        )}
        {ecMode === "fir_number" && (
          <div className="form-grid">
            <Select label="Police station" options={mapToOptions(policeStations)} value={mapToOptions(policeStations).find((o) => o.value === firPolice) || null}
              onChange={(o: any) => setFirPolice(o ? o.value : "")} isDisabled={!ready} isLoading={cascadeBusy === "police"} placeholder="Select police station" />
            {tf("FIR number", firNo, setFirNo, { placeholder: "FIR number" })}
            {yearField("Year", ecYear, setEcYear)}
            {statusField()}
          </div>
        )}
        {ecMode === "act" && (
          <div className="form-grid">
            <div className="row full" style={{ alignItems: "flex-end" }}>
              {tf("Search act", actSearch, setActSearch, { placeholder: "Type 3 or more letters, then Find", fieldClass: "grow" })}
              <Button onClick={() => loadActTypes(actSearch)} disabled={!ready || actSearch.trim().length < 3}>Find</Button>
            </div>
            <Select label="Act" options={mapToOptions(actTypes)} value={mapToOptions(actTypes).find((o) => o.value === actCode) || null}
              onChange={(o: any) => setActCode(o ? o.value : "")} isLoading={cascadeBusy === "acts"} placeholder="Select act" />
            {tf("Under section", actSection, setActSection, { placeholder: "Section (optional)" })}
            {statusField()}
          </div>
        )}
        {ecMode === "case_type" && (
          <div className="form-grid">
            <Select label="Case type" options={caseTypeOptions} value={lkType} onChange={setLkType} isDisabled={!ready}
              isLoading={cascadeBusy === "case-types"} placeholder="Select case type" />
            {yearField("Registration year", ecYear, setEcYear)}
            {statusField()}
          </div>
        )}
        {ecMode === "cnr" && <div className="form-grid">{cnrField("16-character CNR, e.g. KLML170000832024")}</div>}
      </>
    );
  };

  const ecTabs = (
    <div style={{ margin: "var(--s4) 0" }}>
      <Tabs label="Search by" value={ecMode} onChange={onEcTab} tabs={EC_TABS.map(([k, l]) => ({ value: k, label: l }))} />
    </div>
  );

  return (
    <div className="cs-root">
      <PageHead
        title="Add case"
        sub="Import the case from court records to fill in parties and hearings automatically, or enter it by hand."
        actions={<>
          <Segmented label="How to add" value={step === "manual" ? "manual" : "import"}
            onChange={(v) => { if (v === "manual") chooseForum({ id: "__manual__", kind: "manual" }); else { setStep("select"); setSaveError(""); } }}
            options={[{ value: "import", label: "Import from court records", icon: "download" }, { value: "manual", label: "Enter manually", icon: "edit" }]} />
        </>}
      />
      <div style={{ marginTop: "calc(-1 * var(--s3))", marginBottom: "var(--s4)" }}>
        <Button variant="ghost" size="sm" icon="chevronLeft" onClick={() => navigate("/dashboard/cases")}>Back to cases</Button>
      </div>

      {step !== "manual" && steps}

      {/* STEP 1 — choose forum / source */}
      {step === "select" && (
        <Panel title="1. Choose the court">
          <div className="stack" style={{ gap: "var(--s4)" }}>
            {courtsError && (
              <div className="callout warn" role="alert"><Icon name="warn" size="sm" />
                <div>{courtsError} <button type="button" className="link" onClick={() => chooseForum({ id: "__manual__", kind: "manual" })}>Enter manually</button></div>
              </div>
            )}
            {courtsLoading ? (
              <div className="cs-pick">{[0, 1, 2, 3].map((i) => <Skel key={i} h={72} />)}</div>
            ) : (
              <div className="cs-pick">
                {forums.filter((f) => f.kind !== "manual").map((f) => (
                  <button type="button" key={f.id} aria-pressed={selectedCourt?.id === f.id} onClick={() => chooseForum(f)}>
                    <Icon name={forumIcon(f)} />
                    <span><b>{f.name}</b><div className="cs-sub">{forumSub(f)}</div></span>
                  </button>
                ))}
                {!courtsError && forums.filter((f) => f.kind !== "manual").length === 0 && <p className="faint small">No courts available.</p>}
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* STEP 2 — search: Madras HC flat lookup */}
      {step === "search" && selectedCourt && !["ecourts_dc", "ecourts_hc", "sci"].includes(selectedCourt.id) && (
        <Panel title={`2. Search ${selectedCourt.name}`} actions={changeCourt}>
          <div className="form-grid">
            <Select label="Case type" options={caseTypeOptions} value={lkType} onChange={setLkType} isLoading={typesLoading} placeholder="Select case type" />
            {tf("Case number", lkNumber, setLkNumber, { placeholder: "Case number" })}
            {yearField("Case year", lkYear, setLkYear)}
          </div>
          {searchError_}
          {searchBtn(runSearch, !!(lkType && lkNumber.trim() && lkYear))}
        </Panel>
      )}

      {/* Supreme Court of India — search-type tabs */}
      {step === "search" && selectedCourt && selectedCourt.id === "sci" && (
        <Panel title={`2. Search ${selectedCourt.name}`} actions={changeCourt}>
          <div style={{ marginBottom: "var(--s4)" }}>
            <Tabs label="Search by" value={sciMode} onChange={onSciTab} tabs={SCI_TABS.map(([k, l]) => ({ value: k, label: l }))} />
          </div>
          {sciMode === "case_number" && (
            <div className="form-grid">
              <Select label="Case type" options={caseTypeOptions} value={lkType} onChange={setLkType} isLoading={typesLoading} placeholder="Select case type" />
              {tf("Case number", lkNumber, setLkNumber, { placeholder: "Case number" })}
              {yearField("Case year", lkYear, setLkYear)}
            </div>
          )}
          {sciMode === "diary_no" && (
            <div className="form-grid">
              {tf("Diary number", lkNumber, setLkNumber, { placeholder: "Diary number" })}
              {yearField("Year", sciYear, setSciYear)}
            </div>
          )}
          {sciMode === "cnr" && <div className="form-grid">{cnrField("16-character CNR")}</div>}
          {sciMode === "aor_code" && (
            <div className="form-grid">
              {tf("AOR code", sciAorCode, setSciAorCode, { placeholder: "Advocate-on-Record code" })}
              {yearField("Year", sciYear, setSciYear)}
              <Choice label="Party type" value={sciAorPartyType} onChange={setSciAorPartyType} options={[["any", "Any"], ["P", "Petitioner"], ["R", "Respondent"]]} />
              <Choice label="Status" value={sciAorStatus} onChange={setSciAorStatus} options={[["P", "Pending"], ["D", "Disposed"]]} />
            </div>
          )}
          {sciMode === "party_name" && (
            <div className="form-grid">
              {tf("Party name", sciPartyName, setSciPartyName, { placeholder: "Party name (min 3 letters)" })}
              {yearField("Year (optional)", sciYear, setSciYear)}
              <Choice label="Party type" value={sciPartyType} onChange={setSciPartyType} options={[["any", "Any"], ["P", "Petitioner"], ["R", "Respondent"]]} />
              <Choice label="Status (optional)" value={sciPartyStatus} onChange={setSciPartyStatus} options={[["", "Any"], ["P", "Pending"], ["D", "Disposed"]]} />
            </div>
          )}
          {searchError_}
          {searchBtn(onSciSearch, sciSearchEnabled)}
        </Panel>
      )}

      {/* eCourts District Courts — stateful cascade */}
      {step === "search" && selectedCourt && selectedCourt.id === "ecourts_dc" && (
        <Panel title={`2. Search ${selectedCourt.name}`} actions={changeCourt}>
          {ecMode !== "cnr" && (
            <div className="form-grid">
              <Select label="State" options={mapToOptions(ecStates)} value={mapToOptions(ecStates).find((o) => o.value === ecStateCode) || null}
                onChange={onSelectState} isLoading={cascadeBusy === "states"} placeholder="Select state" />
              <Select label="District" options={mapToOptions(ecDistricts)} value={mapToOptions(ecDistricts).find((o) => o.value === ecDistCode) || null}
                onChange={onSelectDistrict} isDisabled={!ecStateCode} isLoading={cascadeBusy === "districts"} placeholder={ecStateCode ? "Select district" : "Select a state first"} />
              <Select label="Court complex" options={mapToOptions(ecComplexes)} value={mapToOptions(ecComplexes).find((o) => o.value === ecComplexVal) || null}
                onChange={onSelectComplex} isDisabled={!ecDistCode} isLoading={cascadeBusy === "complexes"} placeholder={ecDistCode ? "Select court complex" : "Select a district first"} />
              {needsEst && (
                <Select label="Establishment" options={mapToOptions(ecEstabs)} value={mapToOptions(ecEstabs).find((o) => o.value === ecEstCode) || null}
                  onChange={onSelectEst} isLoading={cascadeBusy === "establishments"} placeholder="Select establishment" />
              )}
            </div>
          )}
          {ecTabs}
          {ecFields(false)}
          {searchError_}
          {searchBtn(onEcSearch, ecSearchEnabled)}
        </Panel>
      )}

      {/* eCourts High Courts — High Court -> bench -> case type cascade */}
      {step === "search" && selectedCourt && selectedCourt.id === "ecourts_hc" && (
        <Panel title={`2. Search ${selectedCourt.name}`} actions={changeCourt}>
          <div className="form-grid">
            <Select label="High Court" options={mapToOptions(hcCourts)} value={mapToOptions(hcCourts).find((o) => o.value === hcStateCode) || null}
              onChange={onSelectHcCourt} isLoading={cascadeBusy === "hc-courts"} placeholder="Select High Court" />
            <Select label="Bench" options={mapToOptions(hcBenchList)} value={mapToOptions(hcBenchList).find((o) => o.value === hcBenchCode) || null}
              onChange={(opt: any) => onSelectHcBench(opt)} isDisabled={!hcStateCode} isLoading={cascadeBusy === "hc-benches"} placeholder={hcStateCode ? "Select bench" : "Select a High Court first"} />
          </div>
          {ecTabs}
          {ecFields(true)}
          {searchError_}
          {searchBtn(onEcSearch, ecSearchEnabled)}
        </Panel>
      )}

      {/* Standalone CNR lookup: the backend tries District Courts and High
          Courts concurrently, so there's one box whichever portal has the case. */}
      {step === "cnr" && (
        <Panel title="2. Search by CNR number" actions={changeCourt}>
          <div className="form-grid">{cnrField("16-character CNR, e.g. KLML170000832024")}</div>
          {searchError_}
          {searchBtn(runSearchCnr, cnrValid)}
        </Panel>
      )}

      {/* Results list (list-returning modes) — pick one to fetch its full detail */}
      {step === "results" && (
        <Panel flush title="3. Matching court records" sub={`${resultRows.length} found`}
          actions={<Button variant="ghost" size="sm" onClick={() => setStep("search")}>Edit search</Button>}>
          <DataTable
            flush
            rows={resultRows.map((row: any, i: number) => ({ ...row, __i: i }))}
            rowKey={(r: any) => r.__i}
            pageSize={25}
            caption="Matching court records"
            columns={[
              { key: "n", label: "#", hideSm: true, render: (r: any) => r.sr_no || r.__i + 1 },
              { key: "case_number", label: "Case", render: (r: any) => (
                <><div className="mono small">{r.case_number}</div><div className="cs-sub">{r.parties}</div></>
              ) },
              ...(selectedCourt?.id === "sci" ? [{ key: "st", label: "Status", hideSm: true, render: (r: any) => <StatusChip status={r._sci?.status} /> }] : []),
              { key: "pick", label: <span className="sr-only">Select</span>, align: "right" as const, render: (r: any) => (
                <Button size="sm" loading={picking === r.__i} disabled={picking !== -1}
                  onClick={() => pickResult(resultRows[r.__i], r.__i)}>{picking === r.__i ? "Fetching…" : "Select"}</Button>
              ) },
            ]}
          />
          {searchError_ && <div style={{ padding: "0 var(--s5) var(--s4)" }}>{searchError_}</div>}
          <p className="faint xs" style={{ padding: "var(--s3) var(--s5)" }}>Not listed? Try the CNR, or enter the case manually.</p>
        </Panel>
      )}

      {/* STEP 4 — review the fetched record + save */}
      {step === "review" && (
        <div className="split">
          <Panel title="4. Review the court record" sub={selectedCourt?.name}
            actions={<Button variant="ghost" size="sm" onClick={() => setStep(resultRows.length ? "results" : "search")}>Back</Button>}>
            <div className="stack" style={{ gap: "var(--s4)" }}>
              <div>
                {newCase.caseNumber && <div className="mono small faint">{newCase.caseNumber}</div>}
                {newCase.caseTitle && <h2 style={{ fontSize: "var(--t-xl)", marginTop: 4 }}>{newCase.caseTitle}</h2>}
              </div>
              {fetchedRecord && <CourtRecordView record={fetchedRecord} courtComplex={ecComplexVal} courtId={selectedCourt?.id} />}
              {!fetchedRecord && sciDetail && (
                <>
                  {sciDetail.diaryNo && <div className="small faint">Diary No. {sciDetail.diaryNo}</div>}
                  {sciDetail.parties && <p className="cr-prayer">{sciDetail.parties}</p>}
                  <dl className="cr-kv">
                    {Object.entries(sciDetail.fields || {}).map(([k, v]: any) => (
                      <div className="cr-kv-row" key={k}><dt>{k}</dt><dd>{v}</dd></div>
                    ))}
                  </dl>
                  {(sciDetail.sections || []).length > 0 && (
                    <div>
                      {sciDetail.sections.map((sec: any) => {
                        const isOpen = sciSectionsOpen.has(sec.tabName);
                        return (
                          <div key={sec.tabName} className={`cs-sci-sec${isOpen ? " open" : ""}`}>
                            <button type="button" aria-expanded={isOpen} onClick={() => toggleSciSection(sec)}>
                              <span>{sec.label}</span><Icon name="chevronDown" size="sm" />
                            </button>
                            {isOpen && (
                              <div className="body">
                                {sciSectionLoading === sec.tabName && <p className="cr-note">Loading…</p>}
                                {sec.loaded && sec.empty && <p className="cr-note">No records.</p>}
                                {sec.loaded && !sec.empty && sec.columns?.length > 0 && (
                                  <DataTable
                                    rows={(sec.rows || []).map((row: any, ri: number) => ({ __i: ri, __r: row }))}
                                    rowKey={(r: any) => r.__i}
                                    pageSize={0}
                                    columns={sec.columns.map((c: any, ci: number) => ({
                                      key: `c${ci}`, label: c, render: (r: any) => (Array.isArray(r.__r) ? r.__r[ci] : ""),
                                    }))}
                                  />
                                )}
                                {sec.loaded && !sec.empty && !(sec.columns?.length > 0) && sec.links?.length > 0 && (
                                  <ul className="cr-links">
                                    {sec.links.map((l: any, li: number) => (
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
                </>
              )}
            </div>
          </Panel>
          {saveRail}
        </div>
      )}

      {/* Manual entry */}
      {step === "manual" && <Panel>{renderCaseForm()}</Panel>}
    </div>
  );
}
