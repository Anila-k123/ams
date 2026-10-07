import AmsCasePicker from './AmsCasePicker'
import Icon from '../../../ui/Icon'
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
    <div className="field">
      <span className="label">Case <span className="faint" style={{ fontWeight: 400 }}>(optional)</span></span>
      {value ? (
        <div className="row between dr-picked">
          <div>
            <div className="small mono" style={{ fontWeight: 500 }}>{amsCaseLabel(value)}</div>
            {value.clientName && <div className="faint xs">{value.clientName}</div>}
          </div>
          <button type="button" className="btn ghost sm icon" aria-label="Remove case"
            disabled={disabled} onClick={() => onChange(null)}><Icon name="x" size="sm" /></button>
        </div>
      ) : (
        <AmsCasePicker onPick={onChange} disabled={disabled} label="Case" />
      )}
    </div>
  )
}
