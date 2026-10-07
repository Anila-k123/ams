import { Field } from '../../../ui/forms'
import Icon from '../../../ui/Icon'

interface Props {
  // One entry per placeholder label: its humanized display + current value.
  items: { label: string; display: string; value: string }[]
  onChange: (label: string, value: string) => void   // live-updates the document
  onFocus?: (label: string) => void  // jump to + highlight this placeholder in the doc
  onBlur?: (label: string) => void   // clear the highlight
}

/** Lists every document placeholder as a labeled input. Typing updates the
 *  document live, and each field stays (editable) even after it's filled.
 *  Focusing a field scrolls the document to that placeholder and highlights it. */
export default function DocumentPlaceholders({ items, onChange, onFocus, onBlur }: Props) {
  if (items.length === 0) {
    return <p className="faint small">No placeholders in this document.</p>
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      {items.map(item => {
        const filled = item.value.trim().length > 0
        return (
          <Field key={item.label} label={
            <span className="row" style={{ gap: 6 }}>
              {item.display}
              {filled && <span style={{ color: 'var(--ok)', display: 'inline-flex' }}><Icon name="check" size="sm" /><span className="sr-only">filled</span></span>}
            </span>
          }>
            {id => (
              <input id={id} className="input" value={item.value} placeholder={item.display}
                onChange={e => onChange(item.label, e.target.value)}
                onFocus={() => onFocus?.(item.label)}
                onBlur={() => onBlur?.(item.label)} />
            )}
          </Field>
        )
      })}
      <p className="faint xs">Edits apply to the document as you type.</p>
    </div>
  )
}
