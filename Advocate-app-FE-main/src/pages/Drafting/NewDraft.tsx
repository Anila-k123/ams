import { useEffect, useState } from 'react'
import { DRAFTING } from './routes'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, PageHead, Spinner } from '../../ui/kit'
import { Field } from '../../ui/forms'
import Icon from '../../ui/Icon'
import { draftingApi, type Template, type Sample } from './api/drafting'
import { fieldOptions, resolveFormFields } from './constants/legal'
import { amsApi, amsCaseLabel, type AmsCase, type AmsLink } from './api/ams'
import AmsCasePicker from './components/AmsCasePicker'
import SlotFieldInput from './components/SlotFieldInput'
import AddDocumentsDialog from './components/AddDocumentsDialog'
import NewDraftScratch from './NewDraftScratch'
import { BeginChoices } from './components/NewDraftDialog'
import FilePick from './components/FilePick'
import WizSteps from './components/WizSteps'

const STEPS = ['Documents', 'Template', 'Facts and instructions', 'Review']

/** New Draft wizard: pick reference document(s) → optionally follow a template →
 *  enter facts/prompt + model → review & generate. Documents are required; the
 *  template is optional (its presence selects Mode 1 vs Mode 2). */
export default function NewDraft() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // Every way into a new draft (sidebar +, Quick Actions, dashboard, case and task
  // buttons) lands here. Without a choice yet, ask first: reference files or
  // typing the facts. The chooser keeps any caseId/taskId and adds ?begin=.
  const begin = params.get('begin')
  if (begin === 'scratch') return <NewDraftScratch />
  if (begin === 'reference') return <NewDraftReference navigate={navigate} />
  return <BeginPage />
}

/** No starting point chosen yet: the prototype's inline chooser. Choosing keeps any
 *  caseId/taskId the entry point passed and adds ?begin=. */
function BeginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const choose = (c: 'reference' | 'scratch') => {
    const q = new URLSearchParams(params)
    q.set('begin', c)
    navigate(`${DRAFTING.newDraft}?${q.toString()}`)
  }
  return (
    <div>
      <PageHead title="New draft" sub="PactPro drafts from your documents and cites the source for every fact it uses."
        actions={<Button variant="ghost" onClick={() => navigate(DRAFTING.drafts)}>Cancel</Button>} />
      <div style={{ maxWidth: 860 }}><BeginChoices choice={null} onChoose={choose} /></div>
    </div>
  )
}

function NewDraftReference({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  const [params] = useSearchParams()
  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // AMS link — from the task button (?amsCaseId=&amsTaskId=) or the optional picker.
  // Supplies the draft's client/project, the task it belongs to, and prefill values.
  const [amsLink, setAmsLink] = useState<AmsLink | null>(null)
  const [amsLinking, setAmsLinking] = useState(false)
  const [amsError, setAmsError] = useState('')
  const [amsFilled, setAmsFilled] = useState<Set<string>>(new Set()) // fact keys filled from AMS

  // Step 0 — reference documents (one or more).
  const [selectedDocs, setSelectedDocs] = useState<Sample[]>([])
  const [showAddDocs, setShowAddDocs] = useState(false)

  // Step 1 — optional template (at most one).
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null)
  const [uploadingTpl, setUploadingTpl] = useState(false) // parsing an inline-uploaded template

  // Step 2 — generation inputs.
  const [facts, setFacts] = useState<Record<string, string>>({})
  const [prompt, setPrompt] = useState('')
  const [llm] = useState('gemini')  // Gemini-only for now
  const [applyBnsCodes, setApplyBnsCodes] = useState(false)

  const loadTemplates = () => draftingApi.getTemplates().then(setTemplates)
  useEffect(() => { loadTemplates() }, [])

  const linkAmsCase = (caseId: number, taskId?: number | null) => {
    setAmsLinking(true); setAmsError('')
    amsApi.linkCase(caseId, taskId)
      .then(link => { setAmsLink(link); setAmsFilled(new Set()) })
      .catch(() => setAmsError('Could not load the case details. You can continue without them, or try again.'))
      .finally(() => setAmsLinking(false))
  }
  const unlinkAms = () => { setAmsLink(null); setAmsFilled(new Set()) }

  // Arriving from an AMS task / case button.
  const urlCaseId = Number(params.get('caseId') || params.get('amsCaseId')) || null
  const urlTaskId = Number(params.get('taskId') || params.get('amsTaskId')) || null
  useEffect(() => { if (urlCaseId) linkAmsCase(urlCaseId, urlTaskId) }, [urlCaseId, urlTaskId])

  // Add newly picked/uploaded documents to the selection (de-duplicated by id).
  const addDocs = (docs: Sample[]) => setSelectedDocs(prev => {
    const byId = new Map(prev.map(d => [d.id, d]))
    docs.forEach(d => byId.set(d.id, d))
    return [...byId.values()]
  })
  const removeDoc = (id: number) => setSelectedDocs(prev => prev.filter(d => d.id !== id))

  // Poll any still-processing documents until they're ready (so Generate can unlock).
  const pendingKey = selectedDocs.filter(d => d.status === 'pending' || d.status === 'processing')
    .map(d => `${d.id}:${d.status}`).join(',')
  useEffect(() => {
    if (!pendingKey) return
    const id = setInterval(async () => {
      const ids = pendingKey.split(',').map(x => Number(x.split(':')[0]))
      const fresh = await Promise.all(ids.map(i => draftingApi.getSample(i).catch(() => null)))
      setSelectedDocs(prev => prev.map(d => fresh.find(f => f?.id === d.id) ?? d))
    }, 3000)
    return () => clearInterval(id)
  }, [pendingKey])

  const allReady = selectedDocs.length > 0 && selectedDocs.every(d => d.status === 'ready')
  const anyFailed = selectedDocs.some(d => d.status === 'failed')

  // Upload a template inline (step 1); reload the list and select the new one.
  const handleTemplateUpload = async (event: { files: File[] }) => {
    const file = event.files[0]
    const fd = new FormData()
    fd.append('file', file)
    fd.append('name', file.name)
    setUploadingTpl(true); setError('')
    try {
      const created = await draftingApi.uploadTemplate(fd)
      // Parsing runs in the background — wait until it's ready, then select it.
      const tpl = await draftingApi.waitForTemplate(created.id)
      await loadTemplates()
      setSelectedTemplate(tpl)
    } catch {
      setError('Could not process that template — use a clause-structured PDF or DOCX.')
    } finally {
      setUploadingTpl(false)
    }
  }

  // Create the draft session and open it. Client/project come from the linked AMS
  // case, else from the first selected document if it has them (documents prepared
  // from AMS don't); a draft may have neither. The free-text prompt folds into facts
  // under `instructions`.
  const handleSubmit = async () => {
    const first = selectedDocs[0]
    if (!first) { setError('Select at least one document.'); return }
    const project = amsLink?.projectId ?? first.project ?? undefined
    setSubmitting(true); setError('')
    const mergedFacts: Record<string, string> = { ...facts }
    if (prompt.trim()) mergedFacts.instructions = prompt.trim()
    try {
      const session = await draftingApi.createSession({
        template: selectedTemplate?.id ?? null,
        samples: selectedDocs.map(d => d.id),
        project,
        facts: mergedFacts,
        llm,
        apply_bns_codes: applyBnsCodes,
        ams_task_id: amsLink?.task?.id ?? null,
      })
      navigate(DRAFTING.draft(session.id))
    } catch {
      setError('Failed to create draft session.')
      setSubmitting(false)
    }
  }

  // The full case-facts form: baseline fields + the template's own extras.
  const slotFields = resolveFormFields(selectedTemplate)

  // Apply AMS prefill to the fields this form actually has (a select only if the
  // value is one of its options), never overwriting what the lawyer typed.
  const fieldKeys = slotFields.map(f => f.key).join(',')
  useEffect(() => {
    if (!amsLink) return
    // Decide from the current facts here, not inside a setFacts updater: React runs
    // updaters later, so `filled` would still be empty when the badges are set.
    const fill: Record<string, string> = {}
    const marked: string[] = []  // fields showing the AMS value (just filled, or already equal)
    for (const f of resolveFormFields(selectedTemplate)) {
      const v = amsLink.prefill[f.key]
      if (!v) continue
      if (facts[f.key] === v) { marked.push(f.key); continue }  // e.g. re-linked the same case
      if (facts[f.key]?.trim()) continue
      if (f.type === 'select' && !fieldOptions(f).includes(v)) continue
      fill[f.key] = v
      marked.push(f.key)
    }
    if (!marked.length) return
    if (Object.keys(fill).length) {
      setFacts(prev => {
        const next = { ...prev }
        for (const [k, v] of Object.entries(fill)) if (!next[k]?.trim()) next[k] = v
        return next
      })
    }
    setAmsFilled(prev => new Set([...prev, ...marked]))
  }, [amsLink, fieldKeys])  // eslint-disable-line react-hooks/exhaustive-deps
  // Still showing the AMS value (not edited since) -> mark it "from AMS".
  const fromAms = (key: string) => amsFilled.has(key) && !!amsLink && facts[key] === amsLink.prefill[key]
  const requiredMissing =
    slotFields.filter(f => f.required).some(f => !facts[f.key]?.trim()) ||
    // No template (Mode 2) → the free-text prompt is the primary input, so require it.
    (!selectedTemplate && !prompt.trim())

  const statusTone = (s: string) =>
    s === 'ready' ? 'ok' : s === 'failed' ? 'bad' : 'warn'

  const back = (to: number) => () => { setError(''); setStep(to) }
  // Back to the chooser, keeping any caseId/taskId.
  const changeStart = () => {
    const q = new URLSearchParams(params)
    q.delete('begin')
    const qs = q.toString()
    navigate(qs ? `${DRAFTING.newDraft}?${qs}` : DRAFTING.newDraft)
  }

  return (
    <div>
      <PageHead title="New draft" sub="Draft from reference documents. Facts are pulled from them and cited." />
      <WizSteps steps={STEPS} active={step} />
      <div className="panel" style={{ maxWidth: 860 }}>
        <div className="panel-body dr-wz-body">
          <h2 className="dr-wz-title">{STEPS[step]}</h2>
          <div className="stack" style={{ gap: 10, marginBottom: 12 }}>
            {error && <div className="callout bad" role="alert"><Icon name="warn" size="sm" /><div>{error}</div></div>}
            {amsLinking && <div className="callout info"><span className="pp-spin" aria-hidden="true" /><div>Loading the PactPro case…</div></div>}
            {amsError && <div className="callout warn"><Icon name="warn" size="sm" /><div>{amsError}</div></div>}
            {amsLink && (
              <div className="callout info">
                <Icon name="link" size="sm" />
                <div className="grow">
                  <div style={{ fontWeight: 500 }}>Linked to case <span className="mono">{amsCaseLabel(amsLink.case)}</span></div>
                  {amsLink.task && <div className="small">Task: {amsLink.task.title}</div>}
                </div>
                <button type="button" className="btn ghost sm" onClick={unlinkAms}>Unlink</button>
              </div>
            )}
          </div>

          {/* Step 0 — Documents */}
          {step === 0 && (
            <div className="stack" style={{ gap: 12 }}>
              {!amsLink && !amsLinking && (
                <div className="field">
                  <span className="label">Link a case <span className="faint" style={{ fontWeight: 400 }}>(optional)</span></span>
                  <AmsCasePicker onPick={(c: AmsCase) => linkAmsCase(c.id)} label="Link a case" />
                </div>
              )}
              <div className="row between">
                <span className="label">Reference documents</span>
                <Button size="sm" icon="plus" onClick={() => setShowAddDocs(true)}>Add documents</Button>
              </div>

              {selectedDocs.length === 0 && (
                <div className="dr-dashed faint small">
                  No documents yet. Choose <strong>Add documents</strong> to select or upload one or more.
                </div>
              )}

              {selectedDocs.length > 0 && (
                <div className="panel" style={{ padding: '4px 0' }}>
                  {selectedDocs.map(d => (
                    <div key={d.id} className="list-item">
                      <Icon name="file" size="sm" />
                      <span className="grow small" style={{ wordBreak: 'break-word', fontWeight: 500 }}>{d.name}</span>
                      <span className={`chip ${statusTone(d.status)}`}>
                        {(d.status === 'processing' || d.status === 'pending') && <span className="pp-spin" aria-hidden="true" />}
                        {d.status.charAt(0).toUpperCase() + d.status.slice(1)}
                      </span>
                      <button type="button" className="btn ghost sm icon" aria-label={`Remove ${d.name}`} title="Remove"
                        onClick={() => removeDoc(d.id)}><Icon name="x" size="sm" /></button>
                    </div>
                  ))}
                </div>
              )}

              {anyFailed && <div className="callout warn"><Icon name="warn" size="sm" /><div>A document failed processing. Remove it or re-upload before continuing.</div></div>}
            </div>
          )}

          {/* Step 1 — Template (optional) */}
          {step === 1 && (
            <div className="stack" style={{ gap: 12 }}>
              <p className="muted small">
                Optional. If you have a previously drafted document whose structure and format the draft should
                follow, choose it here. Otherwise skip this step and PactPro rewrites your documents' own clauses.
              </p>
              <div className="stack" role="radiogroup" aria-label="Template" style={{ gap: 8 }}>
                {[null, ...templates].map(t => (
                  <label key={t?.id ?? 'none'} className="panel row dr-radio">
                    <input type="radio" name="nd-tpl" checked={(selectedTemplate?.id ?? null) === (t?.id ?? null)}
                      onChange={() => setSelectedTemplate(t)} />
                    <span className="grow">
                      <b className="small">{t ? t.name : 'No template'}</b>
                      <span className="faint xs" style={{ display: 'block' }}>
                        {t ? [t.document_type, t.language?.toUpperCase()].filter(Boolean).join(', ') : 'PactPro picks a structure from the documents'}
                      </span>
                    </span>
                    {t && <span className="faint xs">{t.body_json.length} sections</span>}
                  </label>
                ))}
              </div>
              <FilePick label={uploadingTpl ? 'Processing template…' : 'Or upload a new template'} onUpload={handleTemplateUpload} disabled={uploadingTpl} />
              {uploadingTpl && <Spinner label="Processing template" />}
              {selectedTemplate && !uploadingTpl && (
                <div className="callout ok"><Icon name="ok" size="sm" /><div>Template: {selectedTemplate.name} · {selectedTemplate.body_json.length} clause sections</div></div>
              )}
            </div>
          )}

          {/* Step 2 — Facts & Prompt */}
          {step === 2 && (
            <div className="form-grid">
              {slotFields.map(field => (
                <SlotFieldInput key={field.key} field={field} value={facts[field.key] ?? ''}
                  badge={fromAms(field.key) ? 'from case details' : undefined}
                  onChange={v => setFacts(prev => ({ ...prev, [field.key]: v }))} />
              ))}

              <Field full required={!selectedTemplate}
                label="Instructions for the draft"
                hint="Describe the parties, purpose and any specifics the draft should reflect. For example: mutual NDA between Acme Pvt Ltd and Globex Pvt Ltd for a SaaS evaluation; 2-year term; governed by Maharashtra law.">
                {(id, d) => <textarea id={id} aria-describedby={d} className="input" rows={5} value={prompt} onChange={e => setPrompt(e.target.value)} />}
              </Field>

              <label className="check full dr-check-card">
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

          {/* Step 3 — Review */}
          {step === 3 && (
            <div className="stack" style={{ gap: 12 }}>
              <div className="panel tinted"><div className="panel-body">
                <dl className="kv">
                  {amsLink && <><dt>Case</dt><dd><span className="mono">{amsCaseLabel(amsLink.case)}</span>{amsLink.task && ` · Task: ${amsLink.task.title}`}</dd></>}
                  <dt>Reference documents</dt><dd>{selectedDocs.map(d => <div key={d.id}>{d.name}</div>)}</dd>
                  <dt>Template</dt><dd>{selectedTemplate ? selectedTemplate.name : 'No template (rewrite the documents)'}</dd>
                  {slotFields.map(f => <FactRow key={f.key} label={f.label} value={facts[f.key]} />)}
                  <dt>Instructions</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{prompt.trim() || 'None'}</dd>
                  <dt>Section numbers</dt><dd>{applyBnsCodes ? 'BNS/BNSS' : 'As in the documents'}</dd>
                </dl>
              </div></div>
              {!allReady && (
                <div className={`callout ${anyFailed ? 'bad' : 'warn'}`}>
                  {anyFailed ? <Icon name="warn" size="sm" /> : <span className="pp-spin" aria-hidden="true" />}
                  <div>{anyFailed
                    ? 'A document failed processing. Fix it before generating.'
                    : 'Documents are still being processed. Generate unlocks once they are ready.'}</div>
                </div>
              )}
              <p className="faint small">Drafting takes about a minute. The draft opens when it is ready.</p>
            </div>
          )}
        </div>

        <div className="row between dr-wz-foot">
          {step === 0
            ? <button type="button" className="btn ghost" onClick={changeStart}>Change starting point</button>
            : <button type="button" className="btn ghost" onClick={back(step - 1)}>Back</button>}
          <div className="row" style={{ gap: 6 }}>
            {step === 1 && <button type="button" className="btn" onClick={() => { setSelectedTemplate(null); setStep(2) }}>Skip, no template</button>}
            {step === 0 && <Button variant="primary" disabled={selectedDocs.length === 0} onClick={() => setStep(1)}>Continue</Button>}
            {step === 1 && <Button variant="primary" disabled={uploadingTpl} onClick={() => setStep(2)}>Continue</Button>}
            {step === 2 && <Button variant="primary" disabled={requiredMissing} onClick={() => setStep(3)}>Review</Button>}
            {step === 3 && (
              <Button variant="primary" icon={allReady ? 'sparkle' : undefined} loading={submitting} disabled={!allReady || submitting} onClick={handleSubmit}>
                {allReady ? 'Generate draft' : 'Waiting for documents…'}
              </Button>
            )}
          </div>
        </div>
      </div>

      <AddDocumentsDialog
        visible={showAddDocs}
        onHide={() => setShowAddDocs(false)}
        onAdd={addDocs}
        alreadySelected={selectedDocs.map(d => d.id)}
      />
    </div>
  )
}

function FactRow({ label, value }: { label: string; value?: string }) {
  return <><dt>{label}</dt><dd>{value?.trim() || <span className="faint">—</span>}</dd></>
}
