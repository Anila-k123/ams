import { useEffect, useState } from 'react'
import { DRAFTING } from './routes'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Steps } from 'primereact/steps'
import { Dropdown } from 'primereact/dropdown'
import { InputTextarea } from 'primereact/inputtextarea'
import { Button } from 'primereact/button'
import { FileUpload } from 'primereact/fileupload'
import { Message } from 'primereact/message'
import { Tag } from 'primereact/tag'
import { Checkbox } from 'primereact/checkbox'
import { ProgressSpinner } from 'primereact/progressspinner'
import { draftingApi, type Template, type Sample } from './api/drafting'
import { fieldOptions, resolveFormFields } from './constants/legal'
import { amsApi, amsCaseLabel, type AmsCase, type AmsLink } from './api/ams'
import AmsCasePicker from './components/AmsCasePicker'
import SlotFieldInput from './components/SlotFieldInput'
import AddDocumentsDialog from './components/AddDocumentsDialog'
import NewDraftScratch from './NewDraftScratch'

const STEPS = [
  { label: 'Documents' },
  { label: 'Template' },
  { label: 'Facts & Prompt' },
  { label: 'Review' },
]

/** New Draft wizard: pick reference document(s) → optionally follow a template →
 *  enter facts/prompt + model → review & generate. Documents are required; the
 *  template is optional (its presence selects Mode 1 vs Mode 2). */
export default function NewDraft() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  // The "Type facts directly" chooser routes here with ?begin=scratch → Mode 3.
  if (params.get('begin') === 'scratch') return <NewDraftScratch />
  return <NewDraftReference navigate={navigate} />
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
      .catch(() => setAmsError('Could not load the AMS case. You can continue without it, or try again from AMS.'))
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

  const statusSeverity = (s: string) =>
    s === 'ready' ? 'success' : s === 'failed' ? 'danger' : 'warning'

  return (
    <div style={{ maxWidth: 820, margin: '0 auto' }}>
      <div className="pp-card">
        <Steps model={STEPS} activeIndex={step} className="mb-5" />
        {error && <Message severity="error" text={error} className="mb-3 w-full" />}
        {amsLinking && (
          <Message severity="info" className="mb-3 w-full" icon="pi pi-spin pi-spinner" text="Loading the AMS case…" />
        )}
        {amsError && <Message severity="warn" text={amsError} className="mb-3 w-full" />}
        {amsLink && (
          <Message severity="info" className="mb-3 w-full" content={
            <div className="flex align-items-center gap-3 w-full">
              <i className="pi pi-link" />
              <div className="flex-1">
                <div className="font-medium">Linked to AMS case {amsCaseLabel(amsLink.case)}</div>
                {amsLink.task && <div className="text-sm">Task: {amsLink.task.title}</div>}
              </div>
              <Button label="Unlink" size="small" text severity="secondary" onClick={unlinkAms} />
            </div>
          } />
        )}

        {/* Step 0 — Documents */}
        {step === 0 && (
          <div className="flex flex-column gap-3">
            {!amsLink && !amsLinking && (
              <div className="flex flex-column gap-2 mb-2">
                <label className="font-medium">Link an AMS case <span className="text-color-secondary font-normal">(optional)</span></label>
                <AmsCasePicker onPick={(c: AmsCase) => linkAmsCase(c.id)} />
              </div>
            )}
            <div className="flex align-items-center justify-content-between">
              <label className="font-medium">Reference documents</label>
              <Button label="Add Documents" icon="pi pi-plus" size="small" onClick={() => setShowAddDocs(true)} />
            </div>

            {selectedDocs.length === 0 && (
              <div className="text-color-secondary text-sm p-3 text-center"
                style={{ border: '1px dashed var(--surface-300, #e5e7eb)', borderRadius: 8 }}>
                No documents yet — click <strong>Add Documents</strong> to select or upload one or more.
              </div>
            )}

            {selectedDocs.map(d => (
              <div key={d.id} className="flex align-items-center gap-3 p-2"
                style={{ border: '1px solid var(--surface-300, #e5e7eb)', borderRadius: 8 }}>
                <i className="pi pi-file text-color-secondary" />
                <div className="flex-1" style={{ minWidth: 0 }}>
                  <div className="font-medium" style={{ wordBreak: 'break-word' }}>{d.name}</div>
                </div>
                <Tag value={d.status}
                  severity={statusSeverity(d.status)}
                  icon={d.status === 'processing' || d.status === 'pending' ? 'pi pi-spin pi-spinner' : undefined} />
                <Button icon="pi pi-times" text rounded severity="secondary" onClick={() => removeDoc(d.id)} tooltip="Remove" />
              </div>
            ))}

            {anyFailed && <Message severity="warn" className="w-full" text="A document failed processing — remove it or re-upload before continuing." />}

            <div className="flex justify-content-end mt-2">
              <Button label="Next" icon="pi pi-arrow-right" iconPos="right"
                disabled={selectedDocs.length === 0} onClick={() => setStep(1)} />
            </div>
          </div>
        )}

        {/* Step 1 — Template (optional) */}
        {step === 1 && (
          <div className="flex flex-column gap-3">
            <div>
              <Tag value="Step 2 — Optional" severity="warning" style={{ fontSize: '0.7rem' }} />
              <h2 className="mt-2 mb-1" style={{ fontSize: '1.2rem' }}>Follow a template?</h2>
              <p className="text-color-secondary m-0 text-sm">
                If you have a previously drafted document whose structure and format you'd like the draft
                to follow, add it here. Otherwise, skip this step and we'll rewrite your documents' own clauses.
              </p>
            </div>

            <label className="font-medium mt-2">Choose from your templates</label>
            <Dropdown value={selectedTemplate} options={templates} optionLabel="name" showClear
              placeholder="Select a template (optional)" onChange={e => setSelectedTemplate(e.value)} className="w-full" />
            <div className="text-color-secondary text-sm text-center">— or upload a new one —</div>
            <FileUpload mode="basic" accept=".pdf,.docx" maxFileSize={10000000} disabled={uploadingTpl}
              customUpload uploadHandler={handleTemplateUpload} auto chooseLabel="Upload template (PDF/DOCX)" />
            {uploadingTpl && (
              <div className="flex align-items-center gap-2 text-color-secondary">
                <ProgressSpinner style={{ width: 22, height: 22 }} strokeWidth="5" />
                <span className="text-sm">Processing template…</span>
              </div>
            )}
            {selectedTemplate && !uploadingTpl && (
              <Message severity="success" text={`Template: ${selectedTemplate.name} · ${selectedTemplate.body_json.length} clause sections`} />
            )}

            <div className="flex gap-2 justify-content-between mt-3">
              <Button label="Back" icon="pi pi-arrow-left" severity="secondary" onClick={() => setStep(0)} />
              <div className="flex gap-2">
                <Button label="Skip — no template" severity="secondary" outlined
                  onClick={() => { setSelectedTemplate(null); setStep(2) }} />
                <Button label="Continue" icon="pi pi-arrow-right" iconPos="right" onClick={() => setStep(2)} />
              </div>
            </div>
          </div>
        )}

        {/* Step 2 — Facts & Prompt */}
        {step === 2 && (
          <div className="flex flex-column gap-3">
            {slotFields.map(field => (
              <SlotFieldInput key={field.key} field={field} value={facts[field.key] ?? ''}
                badge={fromAms(field.key) ? 'from AMS' : undefined}
                onChange={v => setFacts(prev => ({ ...prev, [field.key]: v }))} />
            ))}

            <div className="flex flex-column gap-1">
              <label className="font-medium flex align-items-center gap-1">
                <span>Prompt / case facts
                  {!selectedTemplate && <span style={{ color: '#dc2626' }} className="ml-1">*</span>}
                </span>
                <i className="pi pi-question-circle" style={{ fontSize: '0.8rem', color: 'var(--pp-slate-400)', cursor: 'help' }}
                  title="Describe the parties, purpose, and any specifics the draft should reflect. E.g. Mutual NDA between Acme Pvt Ltd and Globex Pvt Ltd for a SaaS evaluation; 2-year term; governed by Maharashtra law." />
              </label>
              <InputTextarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={5} autoResize />
            </div>


            <div className="flex align-items-center gap-3 p-3"
              style={{ border: '1px solid var(--surface-300, #e5e7eb)', borderRadius: 8 }}>
              <Checkbox inputId="applyBns" checked={applyBnsCodes} onChange={e => setApplyBnsCodes(!!e.checked)} />
              <label htmlFor="applyBns" className="cursor-pointer" style={{ userSelect: 'none' }}>
                Apply new BNS/BNSS codes
                <div className="text-color-secondary text-sm font-normal mt-1">
                  Automatically replace IPC / CrPC / Evidence Act references with the updated BNS, BNSS and BSA sections (effective July 2024).
                </div>
              </label>
            </div>

            <div className="flex gap-2 justify-content-between mt-3">
              <Button label="Back" icon="pi pi-arrow-left" severity="secondary" onClick={() => setStep(1)} />
              <Button label="Review" icon="pi pi-arrow-right" iconPos="right" disabled={requiredMissing} onClick={() => setStep(3)} />
            </div>
          </div>
        )}

        {/* Step 3 — Review */}
        {step === 3 && (
          <div className="flex flex-column gap-3">
            <div className="grid">
              <div className="col-12">
                <span className="pp-stat-label">Documents</span>
                <div className="font-medium">{selectedDocs.map(d => d.name).join(', ')}</div>
              </div>
              <div className="col-6">
                <span className="pp-stat-label">Template</span>
                <div className="font-medium">{selectedTemplate ? selectedTemplate.name : 'None — rewrite the documents'}</div>
              </div>
              {amsLink && (
                <div className="col-12">
                  <span className="pp-stat-label">AMS case</span>
                  <div className="font-medium">
                    {amsCaseLabel(amsLink.case)}{amsLink.task && ` · Task: ${amsLink.task.title}`}
                  </div>
                </div>
              )}
              <div className="col-12">
                <span className="pp-stat-label">BNS/BNSS codes</span>
                <div className="font-medium">{applyBnsCodes ? 'Yes — replace IPC/CrPC/Evidence Act references' : 'No'}</div>
              </div>
            </div>
            <hr style={{ border: 'none', borderTop: '1px solid var(--pp-border)', width: '100%', margin: '0.5rem 0' }} />
            {slotFields.length > 0 && (
              <>
                <span className="pp-stat-label">Case facts</span>
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
                <span className="pp-stat-label">Prompt</span>
                <div className="pp-source-quote" style={{ fontFamily: 'inherit' }}>{prompt}</div>
              </>
            )}
            {!allReady && (
              <Message
                severity={anyFailed ? 'error' : 'warn'}
                className="w-full"
                icon={anyFailed ? undefined : 'pi pi-spin pi-spinner'}
                text={anyFailed
                  ? 'A document failed processing — fix it before generating.'
                  : 'Documents are still being processed — Generate unlocks once they are ready.'}
              />
            )}
            <div className="flex gap-2 justify-content-between mt-3">
              <Button label="Back" icon="pi pi-arrow-left" severity="secondary" onClick={() => setStep(2)} />
              <Button
                label={allReady ? 'Generate Draft' : 'Waiting for documents…'}
                icon={allReady ? 'pi pi-bolt' : 'pi pi-spin pi-spinner'}
                iconPos="right"
                loading={submitting}
                disabled={!allReady}
                onClick={handleSubmit}
              />
            </div>
          </div>
        )}
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
