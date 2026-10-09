import { useEffect, useId, useRef, useState } from 'react'
import Icon from '../../../ui/Icon'
import { amsApi, amsCaseLabel, type AmsCase } from '../api/ams'

interface Props {
  onPick: (c: AmsCase) => void
  disabled?: boolean
  label?: string
  // Inside a dialog: the list sits in the flow (the dialog grows to show it, nothing
  // is clipped by its scroll area), loads straight away and stays open.
  inline?: boolean
}

/** Optional "Link an AMS case" search box. Searches the advocate's AMS cases by
 *  number, title or client name. A small combobox: type to search, arrows + Enter
 *  or a click to pick. */
export default function AmsCasePicker({ onPick, disabled, label = 'Search cases', inline = false }: Props) {
  const [value, setValue] = useState('')
  const [suggestions, setSuggestions] = useState<AmsCase[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [error, setError] = useState('')
  const listId = useId()
  const boxRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = (query: string) => {
    setError('')
    amsApi.cases(query)
      .then(r => { setSuggestions(r.content); setActive(-1); setOpen(true) })
      .catch(() => { setSuggestions([]); setError('Could not reach PactPro.') })
  }

  // Debounced search as the user types (the old AutoComplete searched per keystroke).
  const onType = (v: string) => {
    setValue(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => search(v), 250)
  }

  // Inline: show the cases at once, before anything is typed.
  useEffect(() => { if (inline) search('') }, [inline])

  useEffect(() => {
    const down = (e: MouseEvent) => { if (!inline && boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', down)
    return () => { document.removeEventListener('mousedown', down); if (timer.current) clearTimeout(timer.current) }
  }, [inline])

  const pick = (c: AmsCase) => { onPick(c); setValue(''); if (!inline) { setOpen(false); setSuggestions([]) } }

  return (
    <div className="stack" style={{ gap: 4 }} ref={boxRef}>
      <div className="dr-combo">
        <div className="input-icon">
          <Icon name="search" size="sm" />
          <input className="input" role="combobox" aria-label={label} aria-expanded={open} aria-controls={listId}
            aria-autocomplete="list" disabled={disabled} value={value}
            placeholder="Search PactPro cases by number, title or client"
            onFocus={() => search(value)}
            onChange={e => onType(e.target.value)}
            onKeyDown={e => {
              if (!open || !suggestions.length) return
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % suggestions.length) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + suggestions.length) % suggestions.length) }
              else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(suggestions[active]) }
              else if (e.key === 'Escape' && !inline) setOpen(false)
            }} />
        </div>
        {open && (
          <ul className={`dr-combo-list${inline ? ' inline' : ''}`} id={listId} role="listbox">
            {suggestions.length === 0 && <li className="faint small" style={{ padding: '8px 12px' }}>No cases found.</li>}
            {suggestions.map((c, i) => (
              <li key={c.id} role="option" aria-selected={i === active} className={i === active ? 'active' : undefined}
                onMouseDown={e => { e.preventDefault(); pick(c) }}>
                <div className="small" style={{ fontWeight: 500 }}>{amsCaseLabel(c)}</div>
                {c.clientName && <div className="faint xs">{c.clientName}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <span className="xs" style={{ color: 'var(--bad)' }} role="alert">{error}</span>}
    </div>
  )
}
