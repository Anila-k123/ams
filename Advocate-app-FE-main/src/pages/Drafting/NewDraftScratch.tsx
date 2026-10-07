import { useEffect, useState } from 'react'
import { DRAFTING } from './routes'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, PageHead, Spinner } from '../../ui/kit'
import { Field, TextField } from '../../ui/forms'
import Icon from '../../ui/Icon'
import FilePick from './components/FilePick'
import WizSteps from './components/WizSteps'
import { draftingApi, type Template } from './api/drafting'
import { amsApi, type AmsCase, type AmsLink } from './api/ams'
import CaseField from './components/CaseField'
import { resolveFormFields, ENTITY_TYPES } from './constants/legal'
import SlotFieldInput from './components/SlotFieldInput'

const STEPS = ['Setup', 'Key terms', 'Review']

/** Mode 3 — "from scratch" wizard. The user optionally picks an AMS case (its
 *  client and parties become suggestions and prefill) and a document type, enters key terms and a model; the draft is assembled from the
 *  firm's clause library. The underlying template (structure) is resolved from
 *  the chosen document type behind the scenes — never surfaced, so it feels
 *  from-scratch, not template-driven. */
export default function NewDraftScratch() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
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
      .catch(() => { setError('Could not load that PactPro case. You can continue without it.'); setAmsCase(null) })
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
      setError('Could not process that template. Use a clause-structured PDF or DOCX.')
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

  // Back to the chooser, keeping any caseId/taskId.
  const changeStart = () => {
    const q = new URLSearchParams(params)
    q.delete('begin')
    const qs = q.toString()
    navigate(qs ? `${DRAFTING.newDraft}?${qs}` : DRAFTING.newDraft)
  }

  return (
    <div>
      <PageHead title="New draft" sub="Type the facts directly. The draft is assembled from your firm's clause library." />
      <WizSteps steps={STEPS} active={step} />
      <div className="panel" style={{ maxWidth: 860 }}>
        <div className="panel-body dr-wz-body">
          <h2 className="dr-wz-title">{STEPS[step]}</h2>
          {error && <div className="callout bad" role="alert" style={{ marginBottom: 12 }}><Icon name="warn" size="sm" /><div>{error}</div></div>}

          {/* Step 0 — Setup */}
          {step === 0 && (
            <div className="stack" style={{ gap: 16 }}>
              <CaseField value={amsCase} onChange={pickCase} disabled={linking} />
              {linking && <Spinner label="Linking the case" />}

              <Field label="Agreement type" hint="What kind of agreement you want to draft.">
                {(id, d) => (
                  <select id={id} aria-describedby={d} className="input" value={docType ?? ''}
                    onChange={e => { setDocType(e.target.value || null); setSelectedTemplate(null) }}>
                    <option value="">Select an agreement type</option>
                    {docTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
              </Field>
              {docTypes.length === 0 && (
                <div className="callout warn"><Icon name="warn" size="sm" /><div>No agreement types available yet. Set an agreement type on a template first.</div></div>
              )}

              {/* Optional: follow a specific template of this type (else the default is used). */}
              {docType && (
                <div className="stack" style={{ gap: 8 }}>
                  <span className="label">Follow a specific template? <span className="faint" style={{ fontWeight: 400 }}>(optional)</span></span>
                  {selectedTemplate ? (
                    // A template is chosen (picked or uploaded): show it clearly with a way to change.
                    <div className="row wrap" style={{ gap: 8 }}>
                      <span className="chip ok"><Icon name="check" size="sm" />{selectedTemplate.name}</span>
                      <button type="button" className="btn ghost sm" onClick={() => setSelectedTemplate(null)}><Icon name="x" size="sm" />Change</button>
                    </div>
                  ) : uploadingTpl ? (
                    <Spinner label="Processing template" />
                  ) : (
                    <>
                      <label className="sr-only" htmlFor="ns-tpl">Template</label>
                      <select id="ns-tpl" className="input" value=""
                        onChange={e => setSelectedTemplate(templatesOfType.find(t => String(t.id) === e.target.value) ?? null)}>
                        <option value="">Use the default for this type</option>
                        {templatesOfType.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                      <FilePick label="Or upload a new template" onUpload={handleTemplateUpload} />
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 1 — Key Terms */}
          {step === 1 && (
            <div className="stack" style={{ gap: 16 }}>
              <TextField label="Document title" value={title} onChange={e => setTitle(e.target.value)}
                hint="The title this document should carry. For example: NDA, Acme Pvt Ltd." />

              <div className="stack" style={{ gap: 10 }}>
                <span className="label">Parties</span>
                <datalist id="ns-party-names">{partyOptions.map(n => <option key={n} value={n} />)}</datalist>
                {parties.map((p, i) => (
                  <div key={i} className="panel tinted"><div className="panel-body" style={{ padding: '14px 16px' }}>
                    <div className="row between" style={{ marginBottom: 10 }}>
                      <b className="small">Party {i + 1}</b>
                      <button type="button" className="btn ghost sm" disabled={parties.length <= 1}
                        aria-label={`Remove party ${i + 1}`} onClick={() => removeParty(i)}><Icon name="trash" size="sm" />Remove</button>
                    </div>
                    <div className="form-grid">
                      <TextField label="Name" value={p.name} list="ns-party-names" onChange={e => setParty(i, 'name', e.target.value)} />
                      <Field label="Entity type">
                        {id => (
                          <select id={id} className="input" value={p.entity} onChange={e => setParty(i, 'entity', e.target.value)}>
                            <option value="">Select</option>
                            {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        )}
                      </Field>
                      <TextField label="Role" value={p.role} onChange={e => setParty(i, 'role', e.target.value)} placeholder="Disclosing Party" />
                      <TextField label="Represented by (optional)" value={p.representative} onChange={e => setParty(i, 'representative', e.target.value)} />
                      <TextField full label="Address (optional)" value={p.address} onChange={e => setParty(i, 'address', e.target.value)} />
                    </div>
                  </div></div>
                ))}
                <div><button type="button" className="btn ghost sm" onClick={addParty}><Icon name="plus" size="sm" />Add party</button></div>
              </div>

              <Field label="Purpose" required
                hint="What is this document meant to achieve? For example: appoint Mr. Ravi as Managing Director for a five-year term.">
                {(id, d) => <textarea id={id} aria-describedby={d} className="input" rows={3} value={purpose} onChange={e => setPurpose(e.target.value)} />}
              </Field>

              {slotFields.length > 0 && (
                <div className="form-grid">
                  {slotFields.map(field => (
                    <SlotFieldInput key={field.key} field={field} value={facts[field.key] ?? ''}
                      onChange={v => setFacts(prev => ({ ...prev, [field.key]: v }))} />
                  ))}
                </div>
              )}

              <Field label="Extra instructions (optional)"
                hint="Any specific clauses or requirements, such as an arbitration clause or DPDP compliance.">
                {(id, d) => <textarea id={id} aria-describedby={d} className="input" rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} />}
              </Field>

              <label className="check dr-check-card">
                <input type="checkbox" checked={applyBnsCodes} onChange={e => setApplyBnsCodes(e.target.checked)} />
                <span>
                  Use BNS/BNSS section numbers
                  <span className="faint small" style={{ display: 'block', marginTop: 2 }}>
                    Replace IPC / CrPC / Evidence Act references with the updated BNS, BNSS and BSA sections (effective July 2024).
                  </span>
                </span>
              </label>
            </div>
          )}

          {/* Step 2 — Review */}
          {step === 2 && (
            <div className="panel tinted"><div className="panel-body">
              <dl className="kv">
                {title.trim() && <><dt>Document title</dt><dd>{title}</dd></>}
                <dt>Case</dt><dd>{amsCase ? <><span className="mono">{amsCase.caseNumber}</span>{amsCase.clientName ? `, ${amsCase.clientName}` : ''}</> : '—'}</dd>
                <dt>Agreement type</dt><dd>{docType}</dd>
                <dt>Template</dt><dd>{resolvedTemplate?.name ?? '—'}{resolvedTemplate && !selectedTemplate && <span className="faint"> (default for type)</span>}</dd>
                {partyList.map((pl, i) => <PartyRow key={i} n={i + 1} text={pl} />)}
                <dt>Purpose</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{purpose}</dd>
                {slotFields.map(f => <KvRow key={f.key} k={f.label} v={facts[f.key]} />)}
                <dt>Extra instructions</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{prompt.trim() || 'None'}</dd>
                <dt>Section numbers</dt><dd>{applyBnsCodes ? 'BNS/BNSS' : 'As drafted'}</dd>
              </dl>
            </div></div>
          )}
        </div>

        <div className="row between dr-wz-foot">
          {step === 0
            ? <button type="button" className="btn ghost" onClick={changeStart}>Change starting point</button>
            : <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}>Back</button>}
          {step === 0 && <Button variant="primary" disabled={!resolvedTemplate || linking} onClick={() => setStep(1)}>Continue</Button>}
          {step === 1 && <Button variant="primary" disabled={requiredMissing} onClick={() => setStep(2)}>Review</Button>}
          {step === 2 && <Button variant="primary" icon="sparkle" loading={submitting} disabled={submitting} onClick={handleSubmit}>Generate draft</Button>}
        </div>
      </div>
    </div>
  )
}

function PartyRow({ n, text }: { n: number; text: string }) {
  return <><dt>Party {n}</dt><dd>{text}</dd></>
}
function KvRow({ k, v }: { k: string; v?: string }) {
  return <><dt>{k}</dt><dd>{v?.trim() || <span className="faint">—</span>}</dd></>
}
