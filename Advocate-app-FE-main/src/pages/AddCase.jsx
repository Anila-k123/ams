import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import Select from "react-select";
import { FiSearch, FiX, FiChevronLeft, FiHome, FiEdit3 } from "react-icons/fi";
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

// Build case Party rows (name, role, counsel, opponent) from a fetched court record.
function buildParties(record, courtId) {
  const out = [];
  if (!record) return out;
  if (courtId === "ecourts_dc") {
    const d = (record.cases && record.cases[0] && record.cases[0].detail) || {};
    (d.petitioners || []).forEach((p) =>
      out.push({ name: p.name, role: "Petitioner", counsel: p.advocate || "", isOpponent: false }));
    (d.respondents || []).forEach((p) =>
      out.push({ name: p.name, role: "Respondent", counsel: p.advocate || "", isOpponent: true }));
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
    const list = (courts || []).map((c) => ({ id: c.court_id, name: c.name, kind: "court" }));
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

  const loadStates = useCallback(async () => {
    setCascadeBusy("states");
    try { setEcStates(await ecGet("states")); }
    catch (e) { setSearchError(e?.response?.data?.error || "Couldn’t load states."); }
    finally { setCascadeBusy(""); }
  }, [ecGet]);

  const needsEst = ecComplexVal.endsWith("@Y");

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
    if (f.kind === "manual") {
      setNewCase(EMPTY_CASE);
      setSelectedCourt(null);
      setStep("manual");
    } else {
      setSelectedCourt(f);
      setLkNumber(""); setLkYear(""); setLkType(null); setCaseTypes({});
      if (f.id === "ecourts_dc") {
        setEcStates({}); setEcDistricts({}); setEcComplexes({}); setEcEstabs({});
        setEcStateCode(""); setEcDistCode(""); setEcComplexVal(""); setEcEstCode("");
        loadStates();
      } else {
        loadCaseTypes(f.id);
      }
      setStep("search");
    }
  };

  // Case-type options: eCourts must submit the numeric CODE; Madras accepts the label key.
  const caseTypeOptions = useMemo(() => {
    if (selectedCourt?.id === "ecourts_dc") {
      return Object.entries(caseTypes)
        .map(([label, code]) => ({ value: String(code), label }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }
    return Object.keys(caseTypes).sort().map((k) => ({ value: k, label: k }));
  }, [caseTypes, selectedCourt]);

  const mapToOptions = (m) =>
    Object.entries(m || {})
      .map(([label, code]) => ({ value: String(code), label }))
      .sort((a, b) => a.label.localeCompare(b.label));

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
      if (fetchedRecord && caseId) {
        // Persist the full court-API response (all fields/tables/orders) for later use.
        try {
          await axios.post("/api/courtsearch/imported-records", {
            caseId, courtId: selectedCourt?.id || "", query: fetchedQuery || {}, raw: fetchedRecord,
          }, authHeaders);
        } catch { /* case is saved regardless; record storage is best-effort */ }
        // Populate the case's Parties from the court record (petitioners/respondents + counsel).
        for (const p of buildParties(fetchedRecord, selectedCourt?.id)) {
          try {
            await axios.post(`/api/workspace/cases/${caseId}/parties`, {
              name: p.name, role: p.role, counsel: p.counsel, isOpponent: p.isOpponent,
            }, authHeaders);
          } catch { /* best-effort */ }
        }
        // Populate Hearings as dated case events (orders handled by a dedicated section later).
        for (const ev of buildEvents(fetchedRecord, selectedCourt?.id)) {
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
                      {f.kind === "manual" ? <FiEdit3 /> : <FiHome />}
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
                      {f.kind === "manual" ? <FiEdit3 /> : <FiHome />}
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
      {step === "search" && selectedCourt && selectedCourt.id !== "ecourts_dc" && (
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
            <button className="ac-search-btn" onClick={runSearch}
                    disabled={searching || !lkType || !lkNumber.trim() || !lkYear}>
              <FiSearch /> {searching ? "Searching… (up to 30s)" : "Search For Case"}
            </button>
          </div>
        </div>
      )}

      {/* eCourts District Courts — stateful cascade */}
      {step === "search" && selectedCourt && selectedCourt.id === "ecourts_dc" && (
        <div className="ac-card">
          <div className="ac-selected">
            <span>Selected: <strong>{selectedCourt.name}</strong></span>
            <button className="ac-clear" onClick={() => setStep("select")} title="Change court"><FiX /></button>
          </div>
          <div className="ac-search-form">
            <div className="ac-field">
              <label>State</label>
              <Select options={mapToOptions(ecStates)}
                value={mapToOptions(ecStates).find((o) => o.value === ecStateCode) || null}
                onChange={onSelectState} isLoading={cascadeBusy === "states"}
                placeholder="Select state" styles={customSelectStyles} />
            </div>
            <div className="ac-field">
              <label>District</label>
              <Select options={mapToOptions(ecDistricts)}
                value={mapToOptions(ecDistricts).find((o) => o.value === ecDistCode) || null}
                onChange={onSelectDistrict} isDisabled={!ecStateCode} isLoading={cascadeBusy === "districts"}
                placeholder="Select district" styles={customSelectStyles} />
            </div>
            <div className="ac-field">
              <label>Court Complex</label>
              <Select options={mapToOptions(ecComplexes)}
                value={mapToOptions(ecComplexes).find((o) => o.value === ecComplexVal) || null}
                onChange={onSelectComplex} isDisabled={!ecDistCode} isLoading={cascadeBusy === "complexes"}
                placeholder="Select court complex" styles={customSelectStyles} />
            </div>
            {needsEst && (
              <div className="ac-field">
                <label>Establishment</label>
                <Select options={mapToOptions(ecEstabs)}
                  value={mapToOptions(ecEstabs).find((o) => o.value === ecEstCode) || null}
                  onChange={onSelectEst} isLoading={cascadeBusy === "establishments"}
                  placeholder="Select establishment" styles={customSelectStyles} />
              </div>
            )}
            <div className="ac-field">
              <label>Case Type</label>
              <Select options={caseTypeOptions} value={lkType} onChange={setLkType}
                isDisabled={!ecComplexVal || (needsEst && !ecEstCode)} isLoading={cascadeBusy === "case-types"}
                placeholder={cascadeBusy === "case-types" ? "Loading types…" : "Select case type"}
                styles={customSelectStyles} />
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
            <button className="ac-search-btn" onClick={runSearchEcourts}
                    disabled={searching || !ecStateCode || !ecDistCode || !ecComplexVal || (needsEst && !ecEstCode) || !lkType || !lkNumber.trim() || !lkYear}>
              <FiSearch /> {searching ? "Searching… (up to 30s)" : "Search For Case"}
            </button>
          </div>
        </div>
      )}

      {/* STEP 3 — review the fetched record + save */}
      {step === "review" && (
        <div className="ac-card">
          <div className="ac-selected">
            <span>Fetched from <strong>{selectedCourt?.name}</strong> — review and save</span>
            <button className="ac-clear" onClick={() => setStep("search")} title="Back to search"><FiX /></button>
          </div>

          <div className="ac-record">
            <div className="ac-record-head">Case details from the court</div>
            <CourtRecordView record={fetchedRecord} courtComplex={ecComplexVal} />
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
    </div>
  );
}
