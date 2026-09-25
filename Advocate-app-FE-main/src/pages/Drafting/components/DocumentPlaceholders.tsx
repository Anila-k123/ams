import { InputText } from 'primereact/inputtext'

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
    return <p className="text-sm text-color-secondary m-0">No placeholders in this document.</p>
  }
  return (
    <div className="flex flex-column gap-3">
      {items.map(item => {
        const filled = item.value.trim().length > 0
        return (
          <div key={item.label} className="flex flex-column gap-1">
            <label className="pp-ph-label">
              {item.display}
              {filled && <i className="pi pi-check-circle pp-ph-done" />}
            </label>
            <InputText
              value={item.value}
              placeholder={item.display}
              onChange={e => onChange(item.label, e.target.value)}
              onFocus={() => onFocus?.(item.label)}
              onBlur={() => onBlur?.(item.label)}
              className="w-full"
            />
          </div>
        )
      })}
      <p className="text-xs text-color-secondary m-0">Edits apply to the document as you type.</p>
    </div>
  )
}
