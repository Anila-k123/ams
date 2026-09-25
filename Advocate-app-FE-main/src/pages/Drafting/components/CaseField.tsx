import { Button } from 'primereact/button'
import AmsCasePicker from './AmsCasePicker'
import { amsCaseLabel, type AmsCase } from '../api/ams'

/** "AMS case (optional)" for drafting uploads. Replaces InstaDraft's client + project
 *  pickers: the backend derives the drafting client/project from the case
 *  (POST /api/drafting/samples/ with case_id; drafting/ams_cases.py). */
export default function CaseField({ value, onChange, disabled }: {
  value: AmsCase | null
  onChange: (c: AmsCase | null) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-column gap-2">
      <label className="font-medium text-sm">AMS case <span className="text-color-secondary font-normal">(optional)</span></label>
      {value ? (
        <div className="flex align-items-center justify-content-between gap-2 p-2 border-round"
          style={{ border: '1px solid var(--card-border)' }}>
          <div>
            <div className="font-medium">{amsCaseLabel(value)}</div>
            {value.clientName && <div className="text-sm text-color-secondary">{value.clientName}</div>}
          </div>
          <Button icon="pi pi-times" text rounded size="small" aria-label="Remove case"
            disabled={disabled} onClick={() => onChange(null)} />
        </div>
      ) : (
        <AmsCasePicker onPick={onChange} disabled={disabled} />
      )}
    </div>
  )
}
