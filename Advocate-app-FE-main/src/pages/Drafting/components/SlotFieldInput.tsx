import { useState } from 'react'
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

// Duration facts are stored as one readable phrase, so the drafting prompt gets
// "2 years" / "11 months" / "until terminated" rather than a bare number. An older
// bare number ("2") is read in the field's first unit.
const OPEN_ENDED_VALUE = 'until terminated'
const parseDuration = (value: string, units: string[]) => {
  const v = (value || '').trim().toLowerCase()
  if (v === OPEN_ENDED_VALUE) return { n: '', unit: 'open' }
  const m = v.match(/^(\d+)\s*([a-z]*)/)
  if (!m) return { n: '', unit: units[0] }
  const unit = units.find(u => m[2] && (u === m[2] || u.replace(/s$/, '') === m[2])) || units[0]
  return { n: m[1], unit }
}
const formatDuration = (n: string, unit: string) => {
  if (unit === 'open') return OPEN_ENDED_VALUE
  if (!n) return ''
  return `${Number(n)} ${Number(n) === 1 ? unit.replace(/s$/, '') : unit}`
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

  // A duration explains itself in visible text, not only behind the info icon.
  const visibleHint = field.type === 'duration' ? field.hint : undefined
  // The unit picked before a number is typed (only "number + unit" is stored).
  const [pendingUnit, setPendingUnit] = useState<string | null>(null)

  return (
    <Field label={label} required={field.required} hint={visibleHint}>
      {(id, describedBy) => {
        if (field.type === 'duration') {
          const units = field.units?.length ? field.units : ['years']
          const parsed = parseDuration(value, units)
          const n = parsed.n
          const unit = value ? parsed.unit : (pendingUnit || units[0])
          const open = unit === 'open'
          return (
            <div className="row" style={{ gap: 8 }}>
              {!open && (
                <input id={id} className="input" style={{ width: 90 }} inputMode="numeric" maxLength={2} placeholder="e.g. 2"
                  aria-describedby={describedBy} value={n}
                  onChange={e => onChange(formatDuration(e.target.value.replace(/\D/g, '').slice(0, 2), unit))} />
              )}
              <select className="input" style={{ width: open ? '100%' : 'auto', flex: open ? 1 : undefined }}
                aria-label={`${field.label}: unit`} id={open ? id : undefined} value={unit}
                onChange={e => { setPendingUnit(e.target.value); onChange(formatDuration(n, e.target.value)) }}>
                {units.map(u => <option key={u} value={u}>{u.charAt(0).toUpperCase() + u.slice(1)}</option>)}
                {field.open_ended && <option value="open">{field.open_ended}</option>}
              </select>
            </div>
          )
        }
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
