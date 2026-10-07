import type { SlotField } from '../api/drafting'
import { fieldOptions } from '../constants/legal'
import { Field } from '../../../ui/forms'
import Icon from '../../../ui/Icon'

interface Props {
  field: SlotField
  value: string
  onChange: (value: string) => void
  badge?: string // small tag beside the label, e.g. "from case details" for a value prefilled from the linked case
}

// Facts are stored as strings; dates use dd/mm/yyyy. The native date input speaks
// yyyy-mm-dd, so convert at the edge and keep the stored format unchanged.
const toIso = (s: string) => {
  const m = (s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
}
const fromIso = (s: string) => {
  const m = (s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/** Renders one case-fact field with the right widget for its type:
 *  date → date input, select → select, else → text input. */
export default function SlotFieldInput({ field, value, onChange, badge }: Props) {
  const label = (
    <span className="row" style={{ gap: 6, display: 'inline-flex' }}>
      <span>{field.label}</span>
      {field.hint && (
        <span title={field.hint} className="faint" style={{ display: 'inline-flex', cursor: 'help' }}>
          <Icon name="info" size="sm" /><span className="sr-only">{field.hint}</span>
        </span>
      )}
      {badge && <span className="chip info plain">{badge}</span>}
    </span>
  )

  return (
    <Field label={label} required={field.required}>
      {id => {
        if (field.type === 'date') {
          return <input id={id} type="date" className="input" value={toIso(value)} onChange={e => onChange(fromIso(e.target.value))} />
        }
        if (field.type === 'select') {
          const opts = fieldOptions(field)
          return (
            <select id={id} className="input" value={value || ''} onChange={e => onChange(e.target.value)}>
              <option value="">Select</option>
              {/* Keep a prefilled value that is not in the list selectable. */}
              {value && !opts.includes(value) && <option value={value}>{value}</option>}
              {opts.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )
        }
        return <input id={id} className="input" value={value} onChange={e => onChange(e.target.value)} />
      }}
    </Field>
  )
}
