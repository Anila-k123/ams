import { useState } from 'react'
import { DRAFTING } from '../routes'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Modal } from '../../../ui/overlays'
import Icon, { type IconName } from '../../../ui/Icon'

/** The two ways to start a draft. */
type Choice = 'reference' | 'scratch'

interface CardDef {
  choice: Choice
  icon: IconName
  title: string
  desc: string
  disabled?: boolean // not yet available
}

const CARDS: CardDef[] = [
  {
    choice: 'reference',
    icon: 'folder',
    title: 'Start from reference documents',
    desc: 'Pick the plaint, agreement or past records. Facts are pulled from them and cited.',
  },
  {
    choice: 'scratch',
    icon: 'pen',
    title: 'Type the facts directly',
    desc: 'Set up the parties and key terms yourself. Good for agreements and fresh matters with no papers yet.',
  },
]

/** The chooser cards, shared by the modal and the inline /new page. */
export function BeginChoices({ choice, onChoose }: { choice: Choice | null; onChoose: (c: Choice) => void }) {
  return (
    <div className="cols g-2 dr-begin" role="radiogroup" aria-label="How to begin">
      {CARDS.map(c => (
        <button key={c.choice} type="button" className={`pp-opt${choice === c.choice ? ' on' : ''}`}
          role="radio" aria-checked={choice === c.choice} disabled={c.disabled}
          onClick={() => !c.disabled && onChoose(c.choice)}>
          <Icon name={c.icon} size="lg" />
          <h3>{c.title}</h3>
          <span className="muted small">{c.desc}</span>
          {c.disabled && <span className="chip warn">Coming soon</span>}
        </button>
      ))}
    </div>
  )
}

/**
 * "How would you like to begin?" chooser shown when starting a new draft:
 * reference files (template/sample + prompt) vs typing facts directly (from
 * scratch). On Next it routes to the wizard with the chosen mode as a query param.
 */
export default function NewDraftDialog({ visible, onHide }: { visible: boolean; onHide: () => void }) {
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const [choice, setChoice] = useState<Choice | null>(null)

  const close = () => { setChoice(null); onHide() }
  const next = () => {
    if (!choice) return
    // Not close(): onHide may navigate away (the /new page sends Cancel back to
    // Drafts), which would race the navigation below.
    setChoice(null)
    // Keep whatever the entry point passed (caseId / taskId from a case or task),
    // so the chosen wizard still opens linked to it.
    const q = new URLSearchParams(search)
    q.set('begin', choice)
    navigate(`${DRAFTING.newDraft}?${q.toString()}`)
  }

  return (
    <Modal
      title="New draft"
      sub="How would you like to begin?"
      open={visible}
      onClose={close}
      size="wide"
      footer={<>
        <button type="button" className="btn ghost" onClick={close}>Cancel</button>
        <button type="button" className="btn primary" disabled={!choice} onClick={next}>Continue<Icon name="chevron" size="sm" /></button>
      </>}
    >
      <BeginChoices choice={choice} onChoose={setChoice} />
    </Modal>
  )
}
