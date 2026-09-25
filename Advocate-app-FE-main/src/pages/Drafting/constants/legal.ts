import type { SlotField, Template } from '../api/drafting'

// Indian States + Union Territories — for the "Governing State" dropdown. South Indian
// states/UTs are listed first (primary user base), the rest follow alphabetically.
export const INDIAN_STATES = [
  // South India (most common for our users)
  'Tamil Nadu', 'Karnataka', 'Kerala', 'Andhra Pradesh', 'Telangana', 'Puducherry',
  // Other states
  'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  // Other Union Territories
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep',
]

// Legal entity types a party to an Indian agreement can be (ordered by common use).
export const ENTITY_TYPES = [
  'Individual',
  'Sole Proprietorship',
  'Partnership Firm',
  'Limited Liability Partnership (LLP)',
  'Private Limited Company',
  'Public Limited Company',
  'One Person Company (OPC)',
  'Hindu Undivided Family (HUF)',
  'Trust',
  'Society',
  'Non-Profit Company (Section 8)',
  'Cooperative Society',
  'Government Body / PSU',
  'Foreign Company',
]

// Named option lists a select field can reference by `option_set`.
export const OPTION_SETS: Record<string, string[]> = {
  states: INDIAN_STATES,
  entity_types: ENTITY_TYPES,
}

/** Resolve the options a select field should show. */
export const fieldOptions = (f: SlotField): string[] =>
  f.options ?? (f.option_set ? OPTION_SETS[f.option_set] ?? [] : [])

// ── Document families ────────────────────────────────────────────────────────
// Legal documents split into two families with different field needs:
//  - 'agreement' — contracts: parties, effective date, term, governing law, notice.
//  - 'court'     — court / declaration instruments (vakalatnama, affidavit, PoA, petition…):
//                  NOT term-based; no term/notice/confidentiality — just parties/deponent,
//                  a date, and jurisdiction. Their specific fields come from the template.
// Court keywords are matched with word boundaries so 'will' won't hit 'goodwill', etc.
export const COURT_TYPE_RE =
  /\b(vakalatnama|vakalathnama|vakalat|affidavit|power\s*of\s*attorney|poa|plaint|written\s*statement|petition|writ|legal\s*notice|notice|will|testament|codicil|bail|surety|bond|complaint|charge\s*sheet|rejoinder|counter\s*affidavit|caveat|appeal|revision|review|undertaking|deposition|summons|warrant|memo(?:randum)?\s*of\s*(?:appeal|parties)|application)\b/i

/** Classify a document by its type label. Defaults to 'agreement' (the common case, and safe
 *  for unknown / blank types). */
export const docFamily = (documentType?: string | null): 'agreement' | 'court' =>
  COURT_TYPE_RE.test((documentType || '').trim()) ? 'court' : 'agreement'

// Party fields — shown in the flat form (Mode 1). Mode 3 collects parties via its own
// repeatable widget, so it skips these (see resolveFormFields `includeParties`).
export const BASELINE_PARTY_FIELDS: SlotField[] = [
  { key: 'party_a_name', label: 'Party A Name', required: false, type: 'text',
    hint: 'Full legal name of the first party' },
  { key: 'party_a_type', label: 'Party A Entity Type', required: false, type: 'select',
    option_set: 'entity_types', hint: 'Legal form of the first party' },
  { key: 'party_b_name', label: 'Party B Name', required: false, type: 'text',
    hint: 'Full legal name of the second party' },
  { key: 'party_b_type', label: 'Party B Entity Type', required: false, type: 'select',
    option_set: 'entity_types', hint: 'Legal form of the second party' },
]

// Terms for the AGREEMENT family — effective date, term, governing law, and a notice period
// (common to most term-based contracts).
export const AGREEMENT_TERMS_FIELDS: SlotField[] = [
  { key: 'effective_date', label: 'Effective Date', required: false, type: 'date',
    hint: 'The date this document takes effect' },
  { key: 'term_years', label: 'Term (years)', required: false, type: 'text',
    hint: 'Duration of the agreement, e.g. 2' },
  { key: 'termination_notice_days', label: 'Termination notice period (days)', required: false,
    type: 'text', hint: 'Notice required to terminate early, e.g. 30' },
  { key: 'governing_state', label: 'Governing State', required: false, type: 'select',
    option_set: 'states', hint: 'Whose state law governs this document' },
]

// Terms for the COURT family — a date and jurisdiction only. No term / notice / confidentiality.
export const COURT_TERMS_FIELDS: SlotField[] = [
  { key: 'effective_date', label: 'Date', required: false, type: 'date',
    hint: 'Date of execution / swearing / filing' },
  { key: 'governing_state', label: 'Jurisdiction (State)', required: false, type: 'select',
    option_set: 'states', hint: 'State whose courts have jurisdiction' },
]

// Document-type-specific extra fields, keyed by normalised document_type. Shown on top of the
// family baseline for ANY template of that type (uploaded or seeded). Keep these genuinely
// type-specific — e.g. confidentiality survival belongs only to an NDA.
export const TYPE_EXTRA_FIELDS: Record<string, SlotField[]> = {
  nda: [
    { key: 'survival_years', label: 'Confidentiality survives for (years after termination)',
      required: false, type: 'text', hint: 'How long confidentiality lasts after the NDA ends, e.g. 3' },
  ],
}

/** The full field set to render for a draft: the template's own fields first, then its family
 *  baseline (agreement vs court), then its document-type extras (all deduped by key).
 *  `includeParties: false` drops the party baseline fields (Mode 3 has its own widget). */
export const resolveFormFields = (
  template?: Template | null,
  opts: { includeParties?: boolean } = {},
): SlotField[] => {
  const { includeParties = true } = opts
  const type = (template?.document_type || '').trim().toLowerCase()
  const own = template?.slot_schema ?? []
  const typeExtras = TYPE_EXTRA_FIELDS[type] ?? []
  const terms = docFamily(type) === 'court' ? COURT_TERMS_FIELDS : AGREEMENT_TERMS_FIELDS
  const baseline = includeParties ? [...BASELINE_PARTY_FIELDS, ...terms] : terms
  const out: SlotField[] = []
  const seen = new Set<string>()
  // Order: the template's own fields, then the family baseline, then type-specific extras.
  for (const f of [...own, ...baseline, ...typeExtras]) {
    if (seen.has(f.key)) continue
    seen.add(f.key)
    out.push(f)
  }
  return out
}
