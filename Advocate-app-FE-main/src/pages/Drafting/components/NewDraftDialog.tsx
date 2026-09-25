import { useState, type CSSProperties } from 'react'
import { DRAFTING } from '../routes'
import { useNavigate } from 'react-router-dom'
import { Dialog } from 'primereact/dialog'
import { Button } from 'primereact/button'
import { Tag } from 'primereact/tag'

/** The two ways to start a draft. */
type Choice = 'reference' | 'scratch'

interface CardDef {
  choice: Choice
  icon: string
  title: string
  desc: string
  disabled?: boolean // not yet available (e.g. from-scratch drafting = Mode 3)
}

const CARDS: CardDef[] = [
  {
    choice: 'reference',
    icon: 'pi pi-upload',
    title: 'Upload reference files',
    desc: "Provide past records. We'll extract details to build your drafts.",
  },
  {
    choice: 'scratch',
    icon: 'pi pi-pencil',
    title: 'Type facts directly',
    desc: 'Start from scratch — by entering the facts.',
  },
]

const cardStyle = (active: boolean, disabled: boolean): CSSProperties => ({
  flex: 1,
  minWidth: 0,
  border: `1.5px solid ${active ? 'var(--primary-color)' : 'var(--surface-300, #e5e7eb)'}`,
  background: active ? 'var(--primary-50, #eef2ff)' : '#fff',
  borderRadius: 12,
  padding: '1.1rem 1.2rem',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.6 : 1,
  transition: 'border-color .12s, background .12s',
})

const iconTile: CSSProperties = {
  width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center',
  justifyContent: 'center', background: 'var(--primary-50, #eef2ff)', color: 'var(--primary-color)',
  fontSize: '1.1rem', marginBottom: '0.7rem',
}

/**
 * "How would you like to begin?" chooser shown when starting a new draft:
 * reference files (template/sample + prompt) vs typing facts directly (from
 * scratch). On Next it routes to the wizard with the chosen mode as a query
 * param. The from-scratch card is disabled until Mode 3 is built.
 */
export default function NewDraftDialog({ visible, onHide }: { visible: boolean; onHide: () => void }) {
  const navigate = useNavigate()
  const [choice, setChoice] = useState<Choice | null>(null)

  const close = () => { setChoice(null); onHide() }
  const next = () => {
    if (!choice) return
    close()
    navigate(`${DRAFTING.newDraft}?begin=${choice}`)
  }

  const footer = (
    <div className="flex align-items-center justify-content-between w-full">
      <Button label="Cancel" text onClick={close} />
      <Button label="Next" icon="pi pi-arrow-right" iconPos="right" disabled={!choice} onClick={next} />
    </div>
  )

  return (
    <Dialog
      header="How would you like to begin?"
      visible={visible}
      onHide={close}
      footer={footer}
      dismissableMask
      style={{ width: '46rem', maxWidth: '95vw' }}
    >
      <div className="flex align-items-stretch gap-3">
        {CARDS.map((c, i) => (
          <div key={c.choice} className="flex align-items-stretch gap-3" style={{ flex: 1, minWidth: 0 }}>
            {i > 0 && (
              <div className="flex align-items-center">
                <span className="text-xs font-semibold text-color-secondary">OR</span>
              </div>
            )}
            <div
              style={cardStyle(choice === c.choice, !!c.disabled)}
              onClick={() => !c.disabled && setChoice(c.choice)}
            >
              <div style={iconTile}><i className={c.icon} /></div>
              <div className="flex align-items-center gap-2 mb-1">
                <span className="font-semibold">{c.title}</span>
                {c.disabled && <Tag value="Coming soon" severity="warning" style={{ fontSize: '0.65rem' }} />}
              </div>
              <p className="m-0 text-sm text-color-secondary" style={{ lineHeight: 1.45 }}>{c.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </Dialog>
  )
}
