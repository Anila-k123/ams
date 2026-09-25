import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { RadioButton } from "primereact/radiobutton";
import { Button } from "primereact/button";
import { TabMenu } from "primereact/tabmenu";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import api from "../api/client";
import { useToast } from "../contexts/ToastContext";
import CourtRecordView from "../components/CourtRecordView";
import "../assets/styles/AddCase.css";

// A react-select-shaped wrapper over PrimeReact's Dropdown, so the (many) cascade
// selectors below keep their option-object value / onChange(option) contract.
function Select({ options, value, onChange, placeholder, isLoading, isDisabled, isClearable, isSearchable = true }: any) {
  const opts: any[] = options || [];
  return (
    <Dropdown
      className="w-full"
      options={opts}
      optionLabel="label"
      optionValue="value"
      value={value ? value.value : null}
      onChange={(e) => onChange(e.value == null ? null : (opts.find((o) => o.value === e.value) || null))}
      placeholder={placeholder}
      loading={!!isLoading}
      disabled={!!isDisabled}
      showClear={!!isClearable}
      filter={isSearchable && opts.length > 8}
      emptyMessage="No options"
    />
  );
}

const COURT_LEVELS = ["District", "High Court", "Supreme Court"].map((v) => ({ value: v, label: v }));
const CASE_STATUSES = ["Active", "Pending", "Closed"].map((v) => ({ value: v, label: v }));

const EMPTY_CASE = {
  caseNumber: "", caseTitle: "", caseType: "", courtLevel: "",
  status: "", amount: "", description: "", clientId: "",
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

  const forumOptions = useMemo(
    () => forums.map((f) => ({ value: f.id, label: f.name, forum: f })),
    [forums]
  );

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
    <div className="ac-field">
      <label>Status</label>
      <div className="ac-status">
        {["Pending", "Disposed", "Both"].map((s) => (
          <label key={s}><RadioButton name="ecStatus" checked={ecStatus === s} onChange={() => setEcStatus(s)} /> {s}</label>
        ))}
      </div>
    </div>
  );

  // The 16-digit rule is Madras HC's CNR format; eCourts / manual cases use other formats.
  const requires16 = selectedCourt?.id === "madras_hc";

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
      else setCaseNumberError(value.trim() ? "" : "Case Number is required.");
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaveError("");
    if (!newCase.clientId) { setSaveError("Please choose a client for this case."); return; }
    if (!newCase.caseNumber.trim()) { setCaseNumberError("Case Number is required."); return; }
    // The court-level / status Dropdowns carry no native `required`, so check them here.
    if (!newCase.courtLevel || !newCase.status) { setSaveError("Please select the court level and status."); return; }
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
      if (courtRecord && caseId) {
        // Persist the full court-API response (all fields/tables/orders) for later use.
        try {
          await api.post("/api/courtsearch/imported-records", {
            caseId, courtId: selectedCourt?.id || "", query: fetchedQuery || {}, raw: courtRecord,
          });
        } catch { /* case is saved regardless; record storage is best-effort */ }
        // Populate the case's Parties from the court record (petitioners/respondents + counsel).
        for (const p of buildParties(courtRecord, selectedCourt?.id)) {
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
        for (const ev of buildEvents(courtRecord, selectedCourt?.id).filter((ev) => ev.date && ev.date >= _todayISO)) {
          try {
            await api.post("/api/events/create", {
              caseId, title: ev.title, eventType: ev.eventType, description: ev.description, date: ev.date,
            });
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
          <InputText name="caseNumber" value={newCase.caseNumber} onChange={onField} required
                 className={caseNumberError ? "ac-input-error" : ""}
                 placeholder={requires16 ? "16-digit CNR" : "Case number"} />
          {caseNumberError && <span className="ac-field-error">{caseNumberError}</span>}
          {!caseNumberError && caseNumberCnrHint && <span className="ac-field-warning">{caseNumberCnrHint}</span>}
        </div>
        <div className="ac-field">
          <label>Case Title</label>
          <InputText name="caseTitle" value={newCase.caseTitle} onChange={onField} required placeholder="Petitioner vs Respondent" />
        </div>
        <div className="ac-field">
          <label>Case Type</label>
          <InputText name="caseType" value={newCase.caseType} onChange={onField} required placeholder="e.g. WP" />
        </div>
        <div className="ac-field">
          <label>Court Level</label>
          <Dropdown value={newCase.courtLevel || null} options={COURT_LEVELS} placeholder="Select Court Level" className="w-full"
            onChange={(e) => setNewCase((p) => ({ ...p, courtLevel: e.value || "" }))} />
        </div>
        <div className="ac-field">
          <label>Status</label>
          <Dropdown value={newCase.status || null} options={CASE_STATUSES} placeholder="Select Status" className="w-full"
            onChange={(e) => setNewCase((p) => ({ ...p, status: e.value || "" }))} />
        </div>
        <div className="ac-field">
          <label>Amount</label>
          <InputText type="number" name="amount" value={newCase.amount} onChange={onField} placeholder="0" />
        </div>
        <div className="ac-field">
          <label>Client</label>
          <Select
            options={clientOptions}
            value={clientOptions.find((o) => o.value === Number(newCase.clientId)) || null}
            onChange={(sel) => setNewCase((p) => ({ ...p, clientId: sel ? sel.value : "" }))}
            isClearable placeholder="Select Client"
          />
        </div>
        <div className="ac-field ac-field-full">
          <label>Description</label>
          <InputTextarea name="description" value={newCase.description} onChange={onField} rows={4} autoResize placeholder="Description" />
        </div>
      </div>
      {saveError && <p className="ac-error">{saveError}</p>}
      <div className="ac-actions">
        <Button type="submit" icon="pi pi-save" label={saving ? "Saving…" : "Save Case to Workspace"} loading={saving} disabled={saving} />
      </div>
    </form>
  );

  return (
    <div className="ac-page">
      <div className="ac-topbar">
        <Button text icon="pi pi-chevron-left" label="Back to Workspace" className="ac-link" onClick={() => navigate("/dashboard/cases")} />
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
              <ul className="ac-forum-list">
                {forums.map((f) => (
                  <li key={f.id}>
                    <button className="ac-forum-item" onClick={() => chooseForum(f)}>
                      <i className={f.kind === "manual" ? "pi pi-pencil" : f.kind === "cnr" ? "pi pi-search" : "pi pi-building-columns"} />
                      <span>{f.name}</span>
                    </button>
                  </li>
                ))}
                {forums.length === 0 && <li className="ac-empty">No courts available.</li>}
              </ul>
            </div>
          </div>

          <div className="ac-panel">
            <div className="ac-panel-head">Available Courts</div>
            <div className="ac-panel-body">
              {courtsLoading && <p className="ac-hint">Loading courts…</p>}
              <div className="ac-field">
                <label>Select a court</label>
                <Select
                  options={forumOptions}
                  value={null}
                  onChange={(opt) => opt && chooseForum(opt.forum)}
                  isLoading={courtsLoading}
                  placeholder={courtsLoading ? "Loading courts…" : "Select a court to proceed…"}
                 
                  isSearchable
                />
              </div>
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
            <Button icon="pi pi-times" rounded text severity="secondary" onClick={() => setStep("select")} tooltip="Change court" tooltipOptions={{ position: "left" }} aria-label="Change court" />
          </div>
          <div className="ac-search-form">
            <div className="ac-field">
              <label>Case Type</label>
              <Select
                options={caseTypeOptions} value={lkType} onChange={setLkType}
                isLoading={typesLoading} placeholder={typesLoading ? "Loading types…" : "Select case type"}
               
              />
            </div>
            <div className="ac-field">
              <label>Case Number</label>
              <InputText value={lkNumber} onChange={(e) => setLkNumber(e.target.value)} placeholder="Enter case number" />
            </div>
            <div className="ac-field">
              <label>Case Year</label>
              <InputText type="number" value={lkYear} onChange={(e) => setLkYear(e.target.value)} min="1900" max="2100" placeholder="e.g. 2024" />
            </div>
          </div>
          {searchError && <p className="ac-error">{searchError}</p>}
          <div className="ac-actions">
            <Button icon="pi pi-search" label={searching ? "Searching case…" : "Search For Case"} loading={searching} onClick={runSearch} disabled={searching || !lkType || !lkNumber.trim() || !lkYear} />
          </div>
        </div>
      )}

      {/* Supreme Court of India — search-type tabs */}
      {step === "search" && selectedCourt && selectedCourt.id === "sci" && (
        <div className="ac-card">
          <div className="ac-selected">
            <span>Selected: <strong>{selectedCourt.name}</strong></span>
            <Button icon="pi pi-times" rounded text severity="secondary" onClick={() => setStep("select")} tooltip="Change court" tooltipOptions={{ position: "left" }} aria-label="Change court" />
          </div>

          <TabMenu className="ac-tabs" model={SCI_TABS.map(([, label]) => ({ label }))} activeIndex={SCI_TABS.findIndex(([k]) => k === sciMode)} onTabChange={(e) => onSciTab(SCI_TABS[e.index][0])} />

          {sciMode === "case_number" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Case Type</label>
                <Select options={caseTypeOptions} value={lkType} onChange={setLkType} isLoading={typesLoading}
                  placeholder={typesLoading ? "Loading types…" : "Select case type"} /></div>
              <div className="ac-field"><label>Case Number</label><InputText value={lkNumber} onChange={(e) => setLkNumber(e.target.value)} placeholder="Enter case number" /></div>
              <div className="ac-field"><label>Case Year</label><InputText type="number" value={lkYear} onChange={(e) => setLkYear(e.target.value)} placeholder="e.g. 2024" /></div>
            </div>
          )}
          {sciMode === "diary_no" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Diary Number</label><InputText value={lkNumber} onChange={(e) => setLkNumber(e.target.value)} placeholder="Diary number" /></div>
              <div className="ac-field"><label>Year</label><InputText type="number" value={sciYear} onChange={(e) => setSciYear(e.target.value)} placeholder="e.g. 2024" /></div>
            </div>
          )}
          {sciMode === "cnr" && (
            <div className="ac-search-form">
              <div className="ac-field ac-field-full"><label>CNR Number</label>
                <InputText value={cnrInput} onChange={(e) => setCnrInput(e.target.value)} maxLength={16} placeholder="16-char CNR" />
                {cnrWarn && <p className="ac-warning">{CNR_WARNING}</p>}</div>
            </div>
          )}
          {sciMode === "aor_code" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>AOR Code</label><InputText value={sciAorCode} onChange={(e) => setSciAorCode(e.target.value)} placeholder="Advocate-on-Record code" /></div>
              <div className="ac-field"><label>Year</label><InputText type="number" value={sciYear} onChange={(e) => setSciYear(e.target.value)} placeholder="e.g. 2024" /></div>
              <div className="ac-field"><label>Party Type</label>
                <div className="ac-status">
                  {[["any", "Any"], ["P", "Petitioner"], ["R", "Respondent"]].map(([v, l]) => (
                    <label key={v}><RadioButton name="sciAorPartyType" checked={sciAorPartyType === v} onChange={() => setSciAorPartyType(v)} /> {l}</label>
                  ))}
                </div></div>
              <div className="ac-field"><label>Status</label>
                <div className="ac-status">
                  {[["P", "Pending"], ["D", "Disposed"]].map(([v, l]) => (
                    <label key={v}><RadioButton name="sciAorStatus" checked={sciAorStatus === v} onChange={() => setSciAorStatus(v)} /> {l}</label>
                  ))}
                </div></div>
            </div>
          )}
          {sciMode === "party_name" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Party Name</label><InputText value={sciPartyName} onChange={(e) => setSciPartyName(e.target.value)} placeholder="Party name (min 3 chars)" /></div>
              <div className="ac-field"><label>Year (optional)</label><InputText type="number" value={sciYear} onChange={(e) => setSciYear(e.target.value)} placeholder="e.g. 2024" /></div>
              <div className="ac-field"><label>Party Type</label>
                <div className="ac-status">
                  {[["any", "Any"], ["P", "Petitioner"], ["R", "Respondent"]].map(([v, l]) => (
                    <label key={v}><RadioButton name="sciPartyType" checked={sciPartyType === v} onChange={() => setSciPartyType(v)} /> {l}</label>
                  ))}
                </div></div>
              <div className="ac-field"><label>Status (optional)</label>
                <div className="ac-status">
                  {[["", "Any"], ["P", "Pending"], ["D", "Disposed"]].map(([v, l]) => (
                    <label key={v || "sci-any"}><RadioButton name="sciPartyStatus" checked={sciPartyStatus === v} onChange={() => setSciPartyStatus(v)} /> {l}</label>
                  ))}
                </div></div>
            </div>
          )}
          <div className="ac-actions">
            <Button icon="pi pi-search" label={searching ? "Searching case…" : "Search For Case"} loading={searching} onClick={onSciSearch} disabled={searching || !sciSearchEnabled} />
          </div>

          {searchError && <p className="ac-error">{searchError}</p>}
        </div>
      )}

      {/* eCourts District Courts — stateful cascade */}
      {step === "search" && selectedCourt && selectedCourt.id === "ecourts_dc" && (
        <div className="ac-card">
          <div className="ac-selected">
            <span>Selected: <strong>{selectedCourt.name}</strong></span>
            <Button icon="pi pi-times" rounded text severity="secondary" onClick={() => setStep("select")} tooltip="Change court" tooltipOptions={{ position: "left" }} aria-label="Change court" />
          </div>
          {/* Cascade selectors — every mode except CNR needs the court location */}
          {ecMode !== "cnr" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>State</label>
                <Select options={mapToOptions(ecStates)} value={mapToOptions(ecStates).find((o) => o.value === ecStateCode) || null}
                  onChange={onSelectState} isLoading={cascadeBusy === "states"} placeholder="Select state" /></div>
              <div className="ac-field"><label>District</label>
                <Select options={mapToOptions(ecDistricts)} value={mapToOptions(ecDistricts).find((o) => o.value === ecDistCode) || null}
                  onChange={onSelectDistrict} isDisabled={!ecStateCode} isLoading={cascadeBusy === "districts"} placeholder="Select district" /></div>
              <div className="ac-field"><label>Court Complex</label>
                <Select options={mapToOptions(ecComplexes)} value={mapToOptions(ecComplexes).find((o) => o.value === ecComplexVal) || null}
                  onChange={onSelectComplex} isDisabled={!ecDistCode} isLoading={cascadeBusy === "complexes"} placeholder="Select court complex" /></div>
              {needsEst && (
                <div className="ac-field"><label>Establishment</label>
                  <Select options={mapToOptions(ecEstabs)} value={mapToOptions(ecEstabs).find((o) => o.value === ecEstCode) || null}
                    onChange={onSelectEst} isLoading={cascadeBusy === "establishments"} placeholder="Select establishment" /></div>
              )}
            </div>
          )}

          {/* Search-type tabs */}
          <TabMenu className="ac-tabs" model={EC_TABS.map(([, label]) => ({ label }))} activeIndex={EC_TABS.findIndex(([k]) => k === ecMode)} onTabChange={(e) => onEcTab(EC_TABS[e.index][0])} />

          {/* Per-mode fields */}
          {ecMode === "cnr" && (
            <div className="ac-search-form"><div className="ac-field ac-field-full"><label>CNR Number</label>
              <InputText value={cnrInput} onChange={(e) => setCnrInput(e.target.value)} maxLength={16} placeholder="16-digit CNR, e.g. KLML170000832024" />
              {cnrWarn && <p className="ac-warning">{CNR_WARNING}</p>}</div></div>
          )}
          {ecMode === "case_number" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Case Type</label>
                <Select options={caseTypeOptions} value={lkType} onChange={setLkType} isDisabled={!cascadeReady} isLoading={cascadeBusy === "case-types"}
                  placeholder={cascadeBusy === "case-types" ? "Loading types…" : "Select case type"} /></div>
              <div className="ac-field"><label>Case Number</label><InputText value={lkNumber} onChange={(e) => setLkNumber(e.target.value)} placeholder="Enter case number" /></div>
              <div className="ac-field"><label>Case Year</label><InputText type="number" value={lkYear} onChange={(e) => setLkYear(e.target.value)} placeholder="e.g. 2024" /></div>
            </div>
          )}
          {ecMode === "party_name" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Petitioner / Respondent</label><InputText value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Party name (min 3 chars)" /></div>
              <div className="ac-field"><label>Registration Year</label><InputText type="number" value={ecYear} onChange={(e) => setEcYear(e.target.value)} placeholder="e.g. 2024" /></div>
              {statusField()}
            </div>
          )}
          {ecMode === "filing_number" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Filing Number</label><InputText value={filingNo} onChange={(e) => setFilingNo(e.target.value)} placeholder="Filing number" /></div>
              <div className="ac-field"><label>Filing Year</label><InputText type="number" value={ecYear} onChange={(e) => setEcYear(e.target.value)} placeholder="e.g. 2024" /></div>
            </div>
          )}
          {ecMode === "advocate" && (
            <>
              <div className="ac-status" style={{ marginBottom: 12 }}>
                {[["1", "Advocate Name"], ["2", "Bar Code"], ["3", "Date Case List"]].map(([v, l]) => (
                  <label key={v}><RadioButton name="advSubMode" checked={advSubMode === v} onChange={() => setAdvSubMode(v)} /> {l}</label>
                ))}
              </div>
              <div className="ac-search-form">
                {advSubMode === "1" && (
                  <>
                    <div className="ac-field"><label>Advocate Name</label><InputText value={advName} onChange={(e) => setAdvName(e.target.value)} placeholder="Advocate name (min 3 chars)" /></div>
                    {statusField()}
                  </>
                )}
                {advSubMode === "2" && (
                  <>
                    <div className="ac-field"><label>State Code</label><InputText value={barState} onChange={(e) => setBarState(e.target.value)} placeholder="e.g. KL" /></div>
                    <div className="ac-field"><label>Bar Code Number</label><InputText value={barCode} onChange={(e) => setBarCode(e.target.value)} placeholder="Bar registration no." /></div>
                    <div className="ac-field"><label>Bar Year</label><InputText type="number" value={barYear} onChange={(e) => setBarYear(e.target.value)} placeholder="e.g. 1998" /></div>
                    {statusField()}
                  </>
                )}
                {advSubMode === "3" && (
                  <>
                    <div className="ac-field"><label>State Code</label><InputText value={barState} onChange={(e) => setBarState(e.target.value)} placeholder="e.g. KL" /></div>
                    <div className="ac-field"><label>Bar Code Number</label><InputText value={barCode} onChange={(e) => setBarCode(e.target.value)} placeholder="Bar registration no." /></div>
                    <div className="ac-field"><label>Bar Year</label><InputText type="number" value={barYear} onChange={(e) => setBarYear(e.target.value)} placeholder="e.g. 1998" /></div>
                    <div className="ac-field"><label>Cause List Date</label><InputText value={caselistDate} onChange={(e) => setCaselistDate(e.target.value)} placeholder="dd-mm-yyyy" /></div>
                  </>
                )}
              </div>
            </>
          )}
          {ecMode === "fir_number" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Police Station</label>
                <Select options={mapToOptions(policeStations)} value={mapToOptions(policeStations).find((o) => o.value === firPolice) || null}
                  onChange={(o) => setFirPolice(o ? o.value : "")} isDisabled={!cascadeReady} isLoading={cascadeBusy === "police"} placeholder="Select police station" /></div>
              <div className="ac-field"><label>FIR Number</label><InputText value={firNo} onChange={(e) => setFirNo(e.target.value)} placeholder="FIR number" /></div>
              <div className="ac-field"><label>Year</label><InputText type="number" value={ecYear} onChange={(e) => setEcYear(e.target.value)} placeholder="e.g. 2024" /></div>
              {statusField()}
            </div>
          )}
          {ecMode === "act" && (
            <div className="ac-search-form">
              <div className="ac-field ac-field-full"><label>Search Act</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <InputText value={actSearch} onChange={(e) => setActSearch(e.target.value)} placeholder="Type ≥3 characters, then Find" />
                  <Button type="button" label="Find" onClick={() => loadActTypes(actSearch)} disabled={!cascadeReady || actSearch.trim().length < 3} />
                </div></div>
              <div className="ac-field"><label>Act Type</label>
                <Select options={mapToOptions(actTypes)} value={mapToOptions(actTypes).find((o) => o.value === actCode) || null}
                  onChange={(o) => setActCode(o ? o.value : "")} isLoading={cascadeBusy === "acts"} placeholder="Select act" /></div>
              <div className="ac-field"><label>Under Section</label><InputText value={actSection} onChange={(e) => setActSection(e.target.value)} placeholder="Section (optional)" /></div>
              {statusField()}
            </div>
          )}
          {ecMode === "case_type" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Case Type</label>
                <Select options={caseTypeOptions} value={lkType} onChange={setLkType} isDisabled={!cascadeReady} isLoading={cascadeBusy === "case-types"}
                  placeholder={cascadeBusy === "case-types" ? "Loading types…" : "Select case type"} /></div>
              <div className="ac-field"><label>Registration Year</label><InputText type="number" value={ecYear} onChange={(e) => setEcYear(e.target.value)} placeholder="e.g. 2024" /></div>
              {statusField()}
            </div>
          )}

          <div className="ac-actions">
            <Button icon="pi pi-search" label={searching ? "Searching case…" : "Search For Case"} loading={searching} onClick={onEcSearch} disabled={searching || !ecSearchEnabled} />
          </div>

          {searchError && <p className="ac-error">{searchError}</p>}
        </div>
      )}

      {/* eCourts High Courts — High Court -> bench -> case type cascade */}
      {step === "search" && selectedCourt && selectedCourt.id === "ecourts_hc" && (
        <div className="ac-card">
          <div className="ac-selected">
            <span>Selected: <strong>{selectedCourt.name}</strong></span>
            <Button icon="pi pi-times" rounded text severity="secondary" onClick={() => setStep("select")} tooltip="Change court" tooltipOptions={{ position: "left" }} aria-label="Change court" />
          </div>
          {/* Bench selectors — every HC search mode needs the High Court + bench */}
          <div className="ac-search-form">
            <div className="ac-field"><label>High Court</label>
              <Select options={mapToOptions(hcCourts)} value={mapToOptions(hcCourts).find((o) => o.value === hcStateCode) || null}
                onChange={onSelectHcCourt} isLoading={cascadeBusy === "hc-courts"} placeholder="Select High Court" /></div>
            <div className="ac-field"><label>Bench</label>
              <Select options={mapToOptions(hcBenchList)} value={mapToOptions(hcBenchList).find((o) => o.value === hcBenchCode) || null}
                onChange={(opt) => onSelectHcBench(opt)} isDisabled={!hcStateCode} isLoading={cascadeBusy === "hc-benches"} placeholder="Select bench" /></div>
          </div>

          {/* Search-type tabs */}
          <TabMenu className="ac-tabs" model={EC_TABS.map(([, label]) => ({ label }))} activeIndex={EC_TABS.findIndex(([k]) => k === ecMode)} onTabChange={(e) => onEcTab(EC_TABS[e.index][0])} />

          {/* Per-mode fields */}
          {ecMode === "case_number" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Case Type</label>
                <Select options={caseTypeOptions} value={lkType} onChange={setLkType} isDisabled={!hcReady} isLoading={cascadeBusy === "case-types"}
                  placeholder={cascadeBusy === "case-types" ? "Loading types…" : "Select case type"} /></div>
              <div className="ac-field"><label>Case Number</label><InputText value={lkNumber} onChange={(e) => setLkNumber(e.target.value)} placeholder="Enter case number" /></div>
              <div className="ac-field"><label>Case Year</label><InputText type="number" value={lkYear} onChange={(e) => setLkYear(e.target.value)} placeholder="e.g. 2024" /></div>
            </div>
          )}
          {ecMode === "party_name" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Petitioner / Respondent</label><InputText value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Party name (min 3 chars)" /></div>
              <div className="ac-field"><label>Registration Year</label><InputText type="number" value={ecYear} onChange={(e) => setEcYear(e.target.value)} placeholder="e.g. 2024" /></div>
              {statusField()}
            </div>
          )}
          {ecMode === "filing_number" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Filing Number</label><InputText value={filingNo} onChange={(e) => setFilingNo(e.target.value)} placeholder="Filing number" /></div>
              <div className="ac-field"><label>Filing Year</label><InputText type="number" value={ecYear} onChange={(e) => setEcYear(e.target.value)} placeholder="e.g. 2024" /></div>
            </div>
          )}
          {ecMode === "advocate" && (
            <>
              <div className="ac-status" style={{ marginBottom: 12 }}>
                {[["1", "Advocate Name"], ["2", "Bar Code"], ["3", "Date Case List"]].map(([v, l]) => (
                  <label key={v}><RadioButton name="advSubModeHc" checked={advSubMode === v} onChange={() => setAdvSubMode(v)} /> {l}</label>
                ))}
              </div>
              <div className="ac-search-form">
                {advSubMode === "1" && (
                  <>
                    <div className="ac-field"><label>Advocate Name</label><InputText value={advName} onChange={(e) => setAdvName(e.target.value)} placeholder="Advocate name (min 3 chars)" /></div>
                    {statusField()}
                  </>
                )}
                {advSubMode !== "1" && (
                  <>
                    <div className="ac-field"><label>Bar Registration No.</label><InputText value={barCode} onChange={(e) => setBarCode(e.target.value)} placeholder="Bar registration no." /></div>
                    {advSubMode === "2" && statusField()}
                    {advSubMode === "3" && (
                      <div className="ac-field"><label>Case List Date</label><InputText value={caselistDate} onChange={(e) => setCaselistDate(e.target.value)} placeholder="dd-mm-yyyy" /></div>
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
                  onChange={(o) => setFirPolice(o ? o.value : "")} isDisabled={!hcReady} isLoading={cascadeBusy === "police"} placeholder="Select police station" /></div>
              <div className="ac-field"><label>FIR Number</label><InputText value={firNo} onChange={(e) => setFirNo(e.target.value)} placeholder="FIR number" /></div>
              <div className="ac-field"><label>Year</label><InputText type="number" value={ecYear} onChange={(e) => setEcYear(e.target.value)} placeholder="e.g. 2024" /></div>
              {statusField()}
            </div>
          )}
          {ecMode === "act" && (
            <div className="ac-search-form">
              <div className="ac-field ac-field-full"><label>Search Act</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <InputText value={actSearch} onChange={(e) => setActSearch(e.target.value)} placeholder="Type ≥3 characters, then Find" />
                  <Button type="button" label="Find" onClick={() => loadActTypes(actSearch)} disabled={!hcReady || actSearch.trim().length < 3} />
                </div></div>
              <div className="ac-field"><label>Act Type</label>
                <Select options={mapToOptions(actTypes)} value={mapToOptions(actTypes).find((o) => o.value === actCode) || null}
                  onChange={(o) => setActCode(o ? o.value : "")} isLoading={cascadeBusy === "acts"} placeholder="Select act" /></div>
              <div className="ac-field"><label>Under Section</label><InputText value={actSection} onChange={(e) => setActSection(e.target.value)} placeholder="Section (optional)" /></div>
              {statusField()}
            </div>
          )}
          {ecMode === "case_type" && (
            <div className="ac-search-form">
              <div className="ac-field"><label>Case Type</label>
                <Select options={caseTypeOptions} value={lkType} onChange={setLkType} isDisabled={!hcReady} isLoading={cascadeBusy === "case-types"}
                  placeholder={cascadeBusy === "case-types" ? "Loading types…" : "Select case type"} /></div>
              <div className="ac-field"><label>Registration Year</label><InputText type="number" value={ecYear} onChange={(e) => setEcYear(e.target.value)} placeholder="e.g. 2024" /></div>
              {statusField()}
            </div>
          )}

          <div className="ac-actions">
            <Button icon="pi pi-search" label={searching ? "Searching case…" : "Search For Case"} loading={searching} onClick={onEcSearch} disabled={searching || !ecSearchEnabled} />
          </div>

          {searchError && <p className="ac-error">{searchError}</p>}
        </div>
      )}

      {/* Results list (list-returning modes) — pick one to fetch its full detail */}
      {step === "results" && (
        <div className="ac-card">
          <div className="ac-selected">
            <span>{resultRows.length} matching case{resultRows.length === 1 ? "" : "s"} — pick one to import</span>
            <Button icon="pi pi-times" rounded text severity="secondary" onClick={() => setStep("search")} tooltip="Back to search" tooltipOptions={{ position: "left" }} aria-label="Back to search" />
          </div>
          <div className="ac-rtable-wrap">
            <DataTable value={resultRows.map((row, i) => ({ ...row, __i: i }))} dataKey="__i" size="small" stripedRows>
              <Column header="#" body={(row: any) => row.sr_no || row.__i + 1} />
              <Column header="Case Number" field="case_number" />
              <Column header="Parties" field="parties" />
              <Column header="" body={(row: any) => (
                <Button type="button" size="small" label={picking === row.__i ? "Fetching…" : "Select"}
                  loading={picking === row.__i} onClick={() => pickResult(resultRows[row.__i], row.__i)} disabled={picking !== -1} />
              )} />
            </DataTable>
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
            <Button icon="pi pi-times" rounded text severity="secondary" onClick={() => setStep(resultRows.length ? "results" : "search")} tooltip="Back" tooltipOptions={{ position: "left" }} aria-label="Back" />
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
                    isClearable placeholder="Select client"
                  />
                </div>
                {caseNumberError && <p className="ac-error">{caseNumberError}</p>}
                {saveError && <p className="ac-error">{saveError}</p>}
                <div className="ac-actions">
                  <Button type="button" icon="pi pi-save" label={saving ? "Saving…" : "Save Case to Workspace"} loading={saving} onClick={handleSave} disabled={saving} />
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
                  <dl className="ac-kv">
                    {Object.entries(sciDetail.fields || {}).map(([k, v]: any) => (
                      <div className="ac-kv-row" key={k}><dt>{k}</dt><dd style={{ whiteSpace: "pre-line" }}>{v}</dd></div>
                    ))}
                  </dl>

                  {(sciDetail.sections || []).length > 0 && (
                    <div className="ac-sci-sections">
                      {sciDetail.sections.map((sec) => {
                        const isOpen = sciSectionsOpen.has(sec.tabName);
                        return (
                          <div key={sec.tabName} className={`ac-sci-section ${isOpen ? "open" : ""}`}>
                            <button type="button" className="ac-sci-section-toggle" onClick={() => toggleSciSection(sec)}>
                              <span>{sec.label}</span>
                              <i className="pi pi-chevron-down ac-sci-section-chevron" />
                            </button>
                            {isOpen && (
                              <div className="ac-sci-section-body">
                                {sciSectionLoading === sec.tabName && <p className="ac-record-note">Loading…</p>}
                                {sec.loaded && sec.empty && <p className="ac-record-note">No records.</p>}
                                {sec.loaded && !sec.empty && sec.columns?.length > 0 && (
                                  <div className="ac-rtable-wrap">
                                    <DataTable value={(sec.rows || []).map((row: any, ri: number) => ({ __i: ri, __r: row }))} dataKey="__i" size="small" stripedRows>
                                      {sec.columns.map((c: any, ci: number) => (
                                        <Column key={ci} header={c} body={(r: any) => (Array.isArray(r.__r) ? r.__r[ci] : "")} />
                                      ))}
                                    </DataTable>
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
                    isClearable placeholder="Select client"
                  />
                </div>
                {caseNumberError && <p className="ac-error">{caseNumberError}</p>}
                {saveError && <p className="ac-error">{saveError}</p>}
                <div className="ac-actions">
                  <Button type="button" icon="pi pi-save" label={saving ? "Saving…" : "Save Case to Workspace"} loading={saving} onClick={handleSave} disabled={saving} />
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
            <Button icon="pi pi-times" rounded text severity="secondary" onClick={() => setStep("select")} tooltip="Back" tooltipOptions={{ position: "left" }} aria-label="Back" />
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
            <Button icon="pi pi-times" rounded text severity="secondary" onClick={() => setStep("select")} tooltip="Back" tooltipOptions={{ position: "left" }} aria-label="Back" />
          </div>
          <div className="ac-search-form">
            <div className="ac-field ac-field-full">
              <label>CNR Number</label>
              <InputText value={cnrInput} onChange={(e) => setCnrInput(e.target.value)} maxLength={16}
                placeholder="16-char CNR, e.g. KLML170000832024" />
              {cnrWarn && <p className="ac-warning">{CNR_WARNING}</p>}
            </div>
          </div>
          <div className="ac-actions">
            <Button icon="pi pi-search" label={searching ? "Searching case…" : "Search For Case"} loading={searching} onClick={runSearchCnr} disabled={searching || !cnrValid} />
          </div>
          {searchError && <p className="ac-error">{searchError}</p>}
        </div>
      )}
    </div>
  );
}
