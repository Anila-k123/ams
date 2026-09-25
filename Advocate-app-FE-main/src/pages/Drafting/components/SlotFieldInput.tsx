import { InputText } from 'primereact/inputtext'
import { Dropdown } from 'primereact/dropdown'
import { Calendar } from 'primereact/calendar'
import { Tag } from 'primereact/tag'
import type { Nullable } from 'primereact/ts-helpers'
import type { SlotField } from '../api/drafting'
import { fieldOptions } from '../constants/legal'

interface Props {
  field: SlotField
  value: string
  onChange: (value: string) => void
  badge?: string // small tag beside the label, e.g. "from AMS" for a prefilled value
}

// Facts are stored as strings; dates use dd/mm/yyyy.
const pad = (n: number) => String(n).padStart(2, '0')
const fmtDate = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
const parseDate = (s: string): Nullable<Date> => {
  const m = (s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]))
  return isNaN(d.getTime()) ? null : d
}

/** Renders one case-fact field with the right widget for its type:
 *  date → Calendar (with icon), select → Dropdown, else → text input. */
export default function SlotFieldInput({ field, value, onChange, badge }: Props) {
  const label = (
    <label className="font-medium flex align-items-center gap-1">
      <span>{field.label}{field.required && <span style={{ color: '#dc2626' }} className="ml-1">*</span>}</span>
      {field.hint && (
        <i className="pi pi-question-circle pp-help-icon" title={field.hint}
          style={{ fontSize: '0.8rem', color: 'var(--pp-slate-400)', cursor: 'help' }} />
      )}
      {badge && <Tag value={badge} severity="info" className="ml-1" style={{ fontSize: '0.65rem', padding: '0 0.4rem' }} />}
    </label>
  )

  // No placeholders — the "?" tooltip already explains each field.
  let control
  if (field.type === 'date') {
    control = (
      <Calendar value={parseDate(value)} onChange={e => onChange(e.value ? fmtDate(e.value as Date) : '')}
        dateFormat="dd/mm/yy" showIcon showButtonBar readOnlyInput className="w-full"
        panelClassName="pp-cal-panel" appendTo={typeof document !== 'undefined' ? document.body : undefined} />
    )
  } else if (field.type === 'select') {
    control = (
      <Dropdown value={value || null} options={fieldOptions(field)} onChange={e => onChange(e.value ?? '')}
        filter showClear className="w-full" />
    )
  } else {
    control = (
      <InputText value={value} onChange={e => onChange(e.target.value)} className="w-full" />
    )
  }

  return (
    <div className="flex flex-column gap-1">
      {label}
      {control}
    </div>
  )
}
