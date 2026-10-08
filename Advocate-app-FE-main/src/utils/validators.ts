// Format checks for structured form values (GSTIN, PAN, PIN code, phone,
// email). The same rules as the backend's core/validators.py, so a form can
// say what's wrong before submitting; the server checks again regardless.
// Each check returns an error message, or "" when the value is fine. An empty
// value is always fine: whether a field is required is the form's decision.

// GST state codes (first two digits of a GSTIN) -> state / UT, spelled as in
// INDIAN_STATES (pages/Drafting/constants/legal.ts) so a state dropdown can select it.
export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan",
  "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
  "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha",
  "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "25": "Dadra and Nagar Haveli and Daman and Diu",
  "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra",
  "28": "Andhra Pradesh", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep",
  "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh",
  "38": "Ladakh", "97": "Other Territory", "99": "Centre Jurisdiction",
};

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PIN_RE = /^[1-9][0-9]{5}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/** Uppercase with spaces and dashes removed, as GSTIN / PAN are stored. */
export const normaliseCode = (v: unknown) => String(v ?? "").replace(/[\s-]+/g, "").toUpperCase();

function gstinCheckChar(first14: string) {
  let total = 0;
  for (let i = 0; i < first14.length; i++) {
    const v = CHARS.indexOf(first14[i]) * (i % 2 ? 2 : 1);
    total += Math.floor(v / 36) + (v % 36);
  }
  return CHARS[(36 - (total % 36)) % 36];
}

export function gstinError(value: unknown): string {
  const g = normaliseCode(value);
  if (!g) return "";
  if (g.length !== 15) return `A GSTIN has 15 characters (you entered ${g.length}).`;
  if (!GSTIN_RE.test(g)) return "Not a GSTIN. Format: 2-digit state code, 10-character PAN, one character, Z, check character (e.g. 33ABCDE1234F1Z7).";
  if (!GST_STATE_CODES[g.slice(0, 2)]) return `${g.slice(0, 2)} is not a GST state code.`;
  if (gstinCheckChar(g.slice(0, 14)) !== g[14]) return "This GSTIN fails its check digit; one of the characters is mistyped.";
  return "";
}

/** The state a GSTIN's first two digits belong to, or "". */
export const gstinState = (value: unknown) => GST_STATE_CODES[normaliseCode(value).slice(0, 2)] || "";

const normState = (s: unknown) => String(s ?? "").toLowerCase().replace(/\s+/g, "");

/** A warning when a valid GSTIN belongs to a different state than the one chosen. */
export function gstinStateMismatch(gstin: unknown, state: unknown): string {
  if (gstinError(gstin) || !state) return "";
  const fromGstin = gstinState(gstin);
  return fromGstin && normState(fromGstin) !== normState(state)
    ? `This GSTIN is registered in ${fromGstin} (code ${normaliseCode(gstin).slice(0, 2)}), not ${state}.`
    : "";
}

export function panError(value: unknown): string {
  const p = normaliseCode(value);
  if (!p) return "";
  return PAN_RE.test(p) ? "" : "A PAN is 10 characters: 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F).";
}

export function pincodeError(value: unknown): string {
  const p = String(value ?? "").replace(/\s+/g, "");
  if (!p) return "";
  return PIN_RE.test(p) ? "" : "A PIN code is 6 digits and does not start with 0.";
}

// A person's phone: an Indian mobile, exactly 10 digits starting with 6-9. AMS is
// used in India only, so there is no country code (core/validators.clean_phone).
export function phoneError(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/[^0-9+\s()-]/.test(raw)) return "A mobile number can only contain digits.";
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length !== 10) return "A mobile number has 10 digits.";
  return /^[6-9]/.test(digits) ? "" : "A mobile number starts with 6, 7, 8 or 9.";
}

/** Keep a mobile-number box to what can be valid while typing or pasting:
 *  digits only, "+91" / "0" prefixes removed, starting 6-9, at most 10 digits. */
export function mobileInput(value: string): string {
  let d = String(value ?? "").replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("91")) d = d.slice(2);
  d = d.replace(/^0+/, "").replace(/^[^6-9]+/, "");
  return d.slice(0, 10);
}

// An office phone: a mobile or a landline with STD code, or an international number.
export function landlineError(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/[^0-9+\s()-]/.test(raw)) return "A phone number can only contain digits, spaces, +, - and brackets.";
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && !raw.startsWith("+91")) {
    return digits.length >= 8 && digits.length <= 15 ? "" : "An international number has 8 to 15 digits including the country code.";
  }
  const national = digits.startsWith("91") && digits.length === 12 ? digits.slice(2) : digits.replace(/^0+/, "");
  return national.length === 10 ? "" : "An Indian phone number has 10 digits (+91 or a leading 0 optional).";
}

export function emailError(value: unknown): string {
  const e = String(value ?? "").trim();
  if (!e) return "";
  return EMAIL_RE.test(e) && e.length <= 254 ? "" : "That is not a valid email address.";
}

export function ifscError(value: unknown): string {
  const i = normaliseCode(value);
  if (!i) return "";
  return IFSC_RE.test(i) ? "" : "An IFSC is 11 characters: 4 letters, 0, then 6 letters or digits (e.g. SBIN0001234).";
}

export type FieldKind = "gstin" | "pan" | "pincode" | "phone" | "landline" | "email" | "ifsc";
const CHECKS: Record<FieldKind, (v: unknown) => string> = {
  gstin: gstinError, pan: panError, pincode: pincodeError, phone: phoneError, landline: landlineError, email: emailError, ifsc: ifscError,
};

/** {field: message} for every field in `spec` whose value is malformed. */
export function formatErrors(values: Record<string, unknown>, spec: Record<string, FieldKind>) {
  const out: Record<string, string> = {};
  for (const [key, kind] of Object.entries(spec)) {
    const msg = CHECKS[kind](values[key]);
    if (msg) out[key] = msg;
  }
  return out;
}
