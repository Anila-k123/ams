import { Field } from '../../../ui/forms'
import Icon from '../../../ui/Icon'

interface Props {
  // One entry per placeholder label: its humanized display + current value.
  items: { label: string; display: string; value: string }[]
  onChange: (label: string, value: string) => void   // live-updates the document
  onFocus?: (label: string) => void  // jump to + highlight this placeholder in the doc
  onBlur?: (label: string) => void   // clear the highlight
}

// Placeholder labels are written by the model ("Year", "Monthly Rent", "Pincode"),
// so a field's input type is inferred from its name. Number-like fields accept
// digits only (letters typed or pasted are dropped); everything else, including
// "Case Number" (O.S. No. 900/2025), stays free text.
type Kind = 'year' | 'pincode' | 'phone' | 'amount' | 'number' | 'text'

function fieldKind(label: string): Kind {
  const l = label.toLowerCase().replace(/[_-]+/g, ' ')
  if (/\bin words\b/.test(l)) return 'text'
  if (/\byear\b/.test(l) && !/\b(financial|assessment|academic)\b/.test(l)) return 'year'
  if (/\b(pin ?code|postal code|zip ?code)\b/.test(l)) return 'pincode'
  if (/\b(phone|mobile|telephone|contact number|whatsapp)\b/.test(l)) return 'phone'
  if (/\b(amount|fees?|rent|price|sum|consideration|deposit|salary|interest|penalty|compensation|cost|charges?)\b/.test(l)) return 'amount'
  if (/\b(age|days|months|weeks|percentage|percent|rate|quantity|count|number of|no\.? of)\b/.test(l)) return 'number'
  return 'text'
}

// Keep only what the kind allows, so typing and pasting behave the same.
function clean(kind: Kind, v: string): string {
  switch (kind) {
    case 'year': return v.replace(/\D/g, '').slice(0, 4)
    case 'pincode': return v.replace(/\D/g, '').slice(0, 6)
    case 'phone': return (v.trim().startsWith('+') ? '+' : '') + v.replace(/\D/g, '').slice(0, 12)
    case 'amount': return oneDot(v.replace(/[^\d.,]/g, ''))
    case 'number': return oneDot(v.replace(/[^\d.]/g, ''))
    default: return v
  }
}
const oneDot = (v: string) => { const i = v.indexOf('.'); return i < 0 ? v : v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '') }

// A gentle note while a fixed-length value is incomplete.
function note(kind: Kind, v: string): string | null {
  if (!v) return null
  if (kind === 'year' && v.length !== 4) return 'Enter a 4-digit year, e.g. 2025.'
  if (kind === 'pincode' && v.length !== 6) return 'A PIN code has 6 digits.'
  if (kind === 'phone' && v.replace(/\D/g, '').length < 10) return 'Enter a 10-digit mobile number.'
  return null
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
        const kind = fieldKind(item.label)
        const filled = item.value.trim().length > 0
        const hint = note(kind, item.value.trim())
        const numeric = kind !== 'text'
        return (
          <Field key={item.label} hint={hint} label={
            <span className="row" style={{ gap: 6 }}>
              {item.display}
              {filled && !hint && <span style={{ color: 'var(--ok)', display: 'inline-flex' }}><Icon name="check" size="sm" /><span className="sr-only">filled</span></span>}
            </span>
          }>
            {(id, describedBy) => (
              <input id={id} className="input" value={item.value} placeholder={item.display}
                aria-describedby={describedBy}
                inputMode={kind === 'phone' ? 'tel' : kind === 'amount' || kind === 'number' ? 'decimal' : numeric ? 'numeric' : undefined}
                maxLength={kind === 'year' ? 4 : kind === 'pincode' ? 6 : kind === 'phone' ? 13 : undefined}
                onChange={e => onChange(item.label, clean(kind, e.target.value))}
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
