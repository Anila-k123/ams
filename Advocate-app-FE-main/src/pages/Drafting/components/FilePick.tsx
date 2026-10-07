import { useId, useRef, useState } from 'react'
import Icon from '../../../ui/Icon'

interface Props {
  label: string
  onUpload: (event: { files: File[] }) => void   // same shape the old auto-upload handler took
  accept?: string
  maxBytes?: number
  disabled?: boolean
  hint?: string
}

/** Choose-and-upload drop zone. Picking (or dropping) a file uploads it at once,
 *  like the PrimeReact FileUpload `auto` mode it replaces; over-size files are
 *  refused here with an inline message. */
export default function FilePick({ label, onUpload, accept = '.pdf,.docx', maxBytes = 10_000_000, disabled, hint = 'PDF or Word (.docx), up to 10 MB.' }: Props) {
  const id = useId()
  const ref = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [err, setErr] = useState('')

  const take = (files: FileList | null) => {
    const f = files?.[0]
    if (!f || disabled) return
    if (f.size > maxBytes) { setErr(`${f.name} is larger than ${Math.round(maxBytes / 1_000_000)} MB.`); return }
    setErr('')
    onUpload({ files: [f] })
    if (ref.current) ref.current.value = ''
  }

  return (
    <div className="stack" style={{ gap: 6 }}>
      <label htmlFor={id} className={`dropzone dr-drop${over ? ' over' : ''}${disabled ? ' disabled' : ''}`}
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); take(e.dataTransfer.files) }}>
        <Icon name="upload" />
        <span className="small" style={{ fontWeight: 500, color: 'var(--ink)' }}>{label}</span>
        <span className="faint xs">{hint}</span>
        <input ref={ref} id={id} type="file" className="sr-only" accept={accept} disabled={disabled}
          onChange={e => take(e.target.files)} />
      </label>
      {err && <span className="xs" role="alert" style={{ color: 'var(--bad)' }}>{err}</span>}
    </div>
  )
}
