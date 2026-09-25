import { useEffect, useState } from 'react'
import { DRAFTING } from './routes'
import { useNavigate } from 'react-router-dom'
import { Steps } from 'primereact/steps'
import { Dropdown } from 'primereact/dropdown'
import { InputText } from 'primereact/inputtext'
import { InputTextarea } from 'primereact/inputtextarea'
import { Button } from 'primereact/button'
import { FileUpload } from 'primereact/fileupload'
import { Message } from 'primereact/message'
import { Tag } from 'primereact/tag'
import { ProgressSpinner } from 'primereact/progressspinner'
import { Checkbox } from 'primereact/checkbox'
import { draftingApi, type Template } from './api/drafting'
import { amsApi, type AmsCase, type AmsLink } from './api/ams'
import CaseField from './components/CaseField'
import { resolveFormFields, ENTITY_TYPES } from './constants/legal'
import SlotFieldInput from './components/SlotFieldInput'

const STEPS = [{ label: 'Setup' }, { label: 'Key Terms' }, { label: 'Review' }]

/** A small "?" icon that shows its hint on hover (used beside field labels). */
const HelpIcon = ({ text }: { text: string }) => (
  <i className="pi pi-question-circle" title={text}
    style={{ fontSize: '0.8rem', color: 'var(--pp-slate-400)', cursor: 'help' }} />
)

/** Mode 3 — "from scratch" wizard. The user optionally picks an AMS case (its
 *  client and parties become suggestions and prefill) and a document type, enters key terms and a model; the draft is assembled from the
 *  firm's clause library. The underlying template (structure) is resolved from
 *  the chosen document type behind the scenes — never surfaced, so it feels
 *  from-scratch, not template-driven. */
export default function NewDraftScratch() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Step 0 — optional AMS case / document type. The case supplies the drafting
  // client + project (via /api/drafting/link-case/) and prefill values.
  const [amsCase, setAmsCase] = useState<AmsCase | null>(null)
  const [amsLink, setAmsLink] = useState<AmsLink | null>(null)
  const [linking, setLinking] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [docType, setDocType] = useState<string | null>(null)
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null) // optional specific template
  const [uploadingTpl, setUploadingTpl] = useState(false) // parsing an inline-uploaded template

  // Step 1 — key terms + model.
  const [facts, setFacts] = useState<Record<string, string>>({})
  const [title, setTitle] = useState('')   // drafting brief: the document's own title
  // Parties to the document — default two rows; each name is selectable (client +
  // its members) or free-typed, with a role. Add/remove rows for 1, 2, or more.
  const [parties, setParties] = useState<{ name: string; entity: string; role: string; address: string; representative: string }[]>([
    { name: '', entity: '', role: '', address: '', representative: '' },
    { name: '', entity: '', role: '', address: '', representative: '' },
  ])
  const [purpose, setPurpose] = useState('')   // drafting brief: what the document should achieve (required)
  const [prompt, setPrompt] = useState('')
  const [llm] = useState('gemini')  // Gemini-only for now
  const [applyBnsCodes, setApplyBnsCodes] = useState(false)

  useEffect(() => {
    draftingApi.getTemplates().then(setTemplates)
  }, [])

  // Picking a case links it (gets/creates its drafting client + project) and
  // fills the first two parties from the case's client and opponent.
  const pickCase = (c: AmsCase | null) => {
    setAmsCase(c); setAmsLink(null)
    if (!c) return
    setLinking(true); setError('')
    amsApi.linkCase(c.id)
      .then(link => {
        setAmsLink(link)
        const names = [link.prefill.party_a_name, link.prefill.party_b_name]
        setParties(ps => ps.map((row, i) => (names[i] && !row.name ? { ...row, name: names[i] as string } : row)))
        if (link.prefill.purpose) setPurpose(pv => pv || (link.prefill.purpose as string))
      })
      .catch(() => { setError('Could not load that AMS case. You can continue without it.'); setAmsCase(null) })
      .finally(() => setLinking(false))
  }

  // Document types come from the templates' type column. The structure template is
  // the user's optional pick, else the first template of that type (resolved silently).
  const docTypes = Array.from(
    new Set(templates.map(t => (t.document_type || '').trim()).filter(Boolean)),
  )
  const templatesOfType = templates.filter(t => (t.document_type || '').trim() === docType)
  const resolvedTemplate = selectedTemplate ?? templatesOfType[0] ?? null

  // Suggested party names: the case's client and opponent (still free-typeable).
  const partyOptions = [amsLink?.prefill.party_a_name, amsLink?.prefill.party_b_name,
    amsCase?.clientName].filter((v, i, a): v is string => !!v && a.indexOf(v) === i)
  const setParty = (i: number, key: 'name' | 'entity' | 'role' | 'address' | 'representative', val: string) =>
    setParties(ps => ps.map((p, idx) => (idx === i ? { ...p, [key]: val } : p)))
  const addParty = () => setParties(ps => [...ps, { name: '', entity: '', role: '', address: '', representative: '' }])
  const removeParty = (i: number) =>
    setParties(ps => (ps.length > 1 ? ps.filter((_, idx) => idx !== i) : ps))
  // Each party → one readable line for the brief (name + any details provided).
  const partyList = parties
    .map(p => {
      if (!p.name.trim()) return ''
      const bits = [p.name.trim()]
      if (p.entity.trim()) bits.push(`entity type: ${p.entity.trim()}`)
      if (p.role.trim()) bits.push(`role: ${p.role.trim()}`)
      if (p.address.trim()) bits.push(`address: ${p.address.trim()}`)
      if (p.representative.trim()) bits.push(`represented by: ${p.representative.trim()}`)
      return bits.join(', ')
    })
    .filter(Boolean)

  // Upload a template inline, tagged with the chosen document type, then select it.
  // Parsing + LLM naming run server-side, so this can take a few seconds.
  const handleTemplateUpload = async (event: { files: File[] }) => {
    if (!docType) { setError('Choose a document type first.'); return }
    const file = event.files[0]
    const fd = new FormData()
    fd.append('file', file)
    fd.append('name', file.name)
    fd.append('document_type', docType)
    setUploadingTpl(true); setError('')
    try {
      const created = await draftingApi.uploadTemplate(fd)
      // Parsing runs in the background — wait until it's ready, then select it.
      const tpl = await draftingApi.waitForTemplate(created.id)
      const refreshed = await draftingApi.getTemplates()
      setTemplates(refreshed)
      setSelectedTemplate(refreshed.find(t => t.id === tpl.id) ?? tpl)
    } catch {
      setError('Could not process that template — use a clause-structured PDF or DOCX.')
    } finally {
      setUploadingTpl(false)
    }
  }

  // The case-facts form: baseline terms + the template's own extras. Parties are collected
  // by the dedicated widget above, so the party baseline fields are excluded here.
  const slotFields = resolveFormFields(resolvedTemplate, { includeParties: false })
  // Purpose is the one required brief field; the prompt box is now optional.
  const requiredMissing =
    slotFields.filter(f => f.required).some(f => !facts[f.key]?.trim()) ||
    !purpose.trim()

  const handleSubmit = async () => {
    if (!resolvedTemplate) return
    setSubmitting(true); setError('')
    const mergedFacts: Record<string, string> = { ...facts }
    if (title.trim()) mergedFacts.document_title = title.trim()
    if (partyList.length) mergedFacts.parties = partyList.join('\n')
    if (purpose.trim()) mergedFacts.purpose = purpose.trim()
    if (prompt.trim()) mergedFacts.instructions = prompt.trim()
    try {
      const session = await draftingApi.createSession({
        template: resolvedTemplate.id,
        samples: [],
        project: amsLink?.projectId,
        facts: mergedFacts,
        llm,
        mode: 'library',
        apply_bns_codes: applyBnsCodes,
      })
      navigate(DRAFTING.draft(session.id))
    } catch {
      setError('Failed to create draft session.')
      setSubmitting(false)
    }
  }

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div className="pp-card">
        <Steps model={STEPS} activeIndex={step} className="mb-5" />
        {error && <Message severity="error" text={error} className="mb-3 w-full" />}

        {/* Step 0 — Setup */}
        {step === 0 && (
          <div className="flex flex-column gap-4">
            <CaseField value={amsCase} onChange={pickCase} disabled={linking} />

            <div className="flex flex-column gap-2">
              <label className="font-medium">Agreement type</label>
              <small className="text-color-secondary">What kind of agreement you want to draft.</small>
              <Dropdown value={docType} options={docTypes} placeholder="Select an agreement type"
                onChange={e => { setDocType(e.value); setSelectedTemplate(null) }} className="w-full" />
              {docTypes.length === 0 && (
                <Message severity="warn" className="w-full"
                  text="No agreement types available yet — set an agreement type on a template first." />
              )}
            </div>

            {/* Optional: follow a specific template of this type (else the default is used). */}
            {docType && (
              <div className="flex flex-column gap-2">
                <label className="font-medium">
                  Follow a specific template? <span className="text-color-secondary font-normal">(optional)</span>
                </label>
                {selectedTemplate ? (
                  // A template is chosen (picked or uploaded) — show it clearly with a way to change.
                  <div className="flex align-items-center gap-2 flex-wrap">
                    <Tag icon="pi pi-check" severity="success" value={selectedTemplate.name} />
                    <Button label="Change" icon="pi pi-times" size="small" text
                      onClick={() => setSelectedTemplate(null)} />
                  </div>
                ) : uploadingTpl ? (
                  <div className="flex align-items-center gap-2 text-color-secondary">
                    <ProgressSpinner style={{ width: 22, height: 22 }} strokeWidth="5" />
                    <span className="text-sm">Processing template…</span>
                  </div>
                ) : (
                  <>
                    <Dropdown value={selectedTemplate} options={templatesOfType} optionLabel="name" dataKey="id" showClear
                      placeholder="Use the default for this type"
                      onChange={e => setSelectedTemplate(e.value)} className="w-full" />
                    <div className="text-color-secondary text-sm text-center">— or upload a new one —</div>
                    <FileUpload mode="basic" accept=".pdf,.docx" maxFileSize={10000000}
                      customUpload uploadHandler={handleTemplateUpload} auto chooseLabel="Upload template (PDF/DOCX)"
                      className="w-full" />
                  </>
                )}
              </div>
            )}


            <div className="flex justify-content-end pt-2">
              <Button label="Next" icon="pi pi-arrow-right" iconPos="right"
                disabled={!resolvedTemplate || linking} onClick={() => setStep(1)} />
            </div>
          </div>
        )}

        {/* Step 1 — Key Terms */}
        {step === 1 && (
          <div className="flex flex-column gap-4">
            <div className="flex flex-column gap-2">
              <label className="font-medium flex align-items-center gap-1">
                <span>Document title</span>
                <HelpIcon text="The title this specific document should carry. E.g. NDA — Acme Pvt Ltd" />
              </label>
              <InputText value={title} onChange={e => setTitle(e.target.value)} className="w-full" />
            </div>

            <div className="flex flex-column gap-2">
              <label className="font-medium flex align-items-center gap-1">
                <span>Parties</span>
                <HelpIcon text="Pick the client or a member, or type a name; add each party's entity type and role." />
              </label>
              {parties.map((p, i) => (
                <div key={i} className="pp-party">
                  <div className="flex align-items-center justify-content-between mb-2">
                    <span className="text-sm font-semibold text-color-secondary">Party {i + 1}</span>
                    <Button icon="pi pi-times" text rounded severity="secondary" type="button"
                      tooltip="Remove" tooltipOptions={{ position: 'top' }}
                      disabled={parties.length <= 1} onClick={() => removeParty(i)} />
                  </div>
                  <div className="grid formgrid">
                    <div className="field col-12 md:col-6 mb-2">
                      <Dropdown editable value={p.name} options={partyOptions}
                        onChange={e => setParty(i, 'name', e.value)}
                        placeholder="Party name" className="w-full" />
                    </div>
                    <div className="field col-12 md:col-6 mb-2">
                      <Dropdown value={p.entity || null} options={ENTITY_TYPES} showClear
                        onChange={e => setParty(i, 'entity', e.value ?? '')}
                        placeholder="Entity type" className="w-full" />
                    </div>
                    <div className="field col-12 md:col-6 mb-2">
                      <InputText value={p.role} onChange={e => setParty(i, 'role', e.target.value)}
                        placeholder="Role (e.g. Disclosing Party)" className="w-full" />
                    </div>
                    <div className="field col-12 md:col-6 mb-0">
                      <InputText value={p.address} onChange={e => setParty(i, 'address', e.target.value)}
                        placeholder="Address (optional)" className="w-full" />
                    </div>
                    <div className="field col-12 md:col-6 mb-0">
                      <InputText value={p.representative} onChange={e => setParty(i, 'representative', e.target.value)}
                        placeholder="Represented by (optional)" className="w-full" />
                    </div>
                  </div>
                </div>
              ))}
              <div>
                <Button label="Add party" icon="pi pi-plus" size="small" text type="button" onClick={addParty} />
              </div>
            </div>

            <div className="flex flex-column gap-2">
              <label className="font-medium flex align-items-center gap-1">
                <span>Purpose <span style={{ color: '#dc2626' }}>*</span></span>
                <HelpIcon text="What is this document meant to achieve? E.g. Appoint Mr. Ravi as Managing Director for a five-year term; or lease commercial office premises for three years with a security deposit." />
              </label>
              <InputTextarea value={purpose} onChange={e => setPurpose(e.target.value)} rows={3} autoResize className="w-full" />
            </div>

            {slotFields.map(field => (
              <SlotFieldInput key={field.key} field={field} value={facts[field.key] ?? ''}
                onChange={v => setFacts(prev => ({ ...prev, [field.key]: v }))} />
            ))}

            <div className="flex flex-column gap-2">
              <label className="font-medium flex align-items-center gap-1">
                <span>Extra instructions <span className="text-color-secondary font-normal">(optional)</span></span>
                <HelpIcon text="Any specific clauses or requirements — e.g. add an arbitration clause, exclude limitation of liability, mention DPDP compliance." />
              </label>
              <InputTextarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={5} autoResize className="w-full" />
            </div>

            <div className="flex align-items-center gap-3 p-3"
              style={{ border: '1px solid var(--surface-300, #e5e7eb)', borderRadius: 8 }}>
              <Checkbox inputId="applyBnsScratch" checked={applyBnsCodes} onChange={e => setApplyBnsCodes(!!e.checked)} />
              <label htmlFor="applyBnsScratch" className="cursor-pointer" style={{ userSelect: 'none' }}>
                Apply new BNS/BNSS codes
                <div className="text-color-secondary text-sm font-normal mt-1">
                  Automatically replace IPC / CrPC / Evidence Act references with the updated BNS, BNSS and BSA sections (effective July 2024).
                </div>
              </label>
            </div>

            <div className="flex gap-2 justify-content-between mt-3">
              <Button label="Back" icon="pi pi-arrow-left" severity="secondary" onClick={() => setStep(0)} />
              <Button label="Review" icon="pi pi-arrow-right" iconPos="right" disabled={requiredMissing} onClick={() => setStep(2)} />
            </div>
          </div>
        )}

        {/* Step 2 — Review */}
        {step === 2 && (
          <div className="flex flex-column gap-3">
            <div className="grid">
              {title.trim() && (
                <div className="col-12"><span className="pp-stat-label">Document title</span><div className="font-medium">{title}</div></div>
              )}
              <div className="col-6"><span className="pp-stat-label">Agreement type</span><div className="font-medium">{docType}</div></div>
              <div className="col-6"><span className="pp-stat-label">AMS case</span><div className="font-medium">{amsCase ? `${amsCase.caseNumber}${amsCase.clientName ? ` — ${amsCase.clientName}` : ''}` : '—'}</div></div>
              <div className="col-6">
                <span className="pp-stat-label">Template</span>
                <div className="font-medium">
                  {resolvedTemplate?.name ?? '—'}
                  {resolvedTemplate && !selectedTemplate && <span className="text-color-secondary font-normal"> (default for type)</span>}
                </div>
              </div>
              <div className="col-12">
                <span className="pp-stat-label">BNS/BNSS codes</span>
                <div className="font-medium">{applyBnsCodes ? 'Yes — replace IPC/CrPC/Evidence Act references' : 'No'}</div>
              </div>
            </div>
            <hr style={{ border: 'none', borderTop: '1px solid var(--pp-border)', width: '100%', margin: '0.5rem 0' }} />
            {partyList.length > 0 && (
              <>
                <span className="pp-stat-label">Parties</span>
                <div className="flex flex-column gap-1">
                  {partyList.map((p, i) => (
                    <div key={i} className="text-sm" style={{ color: 'var(--pp-slate-700)' }}>• {p}</div>
                  ))}
                </div>
              </>
            )}
            {purpose.trim() && (
              <>
                <span className="pp-stat-label">Purpose</span>
                <div className="pp-source-quote" style={{ fontFamily: 'inherit' }}>{purpose}</div>
              </>
            )}
            {slotFields.length > 0 && (
              <>
                <span className="pp-stat-label">Key terms</span>
                <div className="flex flex-wrap gap-2">
                  {slotFields.map(f => (
                    <Tag key={f.key} value={`${f.label}: ${facts[f.key] || '—'}`}
                      style={{ background: 'var(--pp-slate-100)', color: 'var(--pp-slate-700)' }} />
                  ))}
                </div>
              </>
            )}
            {prompt.trim() && (
              <>
                <span className="pp-stat-label">Extra instructions</span>
                <div className="pp-source-quote" style={{ fontFamily: 'inherit' }}>{prompt}</div>
              </>
            )}
            <div className="flex gap-2 justify-content-between mt-3">
              <Button label="Back" icon="pi pi-arrow-left" severity="secondary" onClick={() => setStep(1)} />
              <Button label="Generate Draft" icon="pi pi-bolt" iconPos="right"
                loading={submitting} onClick={handleSubmit} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
