import { useState } from 'react'
import { AutoComplete } from 'primereact/autocomplete'
import { amsApi, amsCaseLabel, type AmsCase } from '../api/ams'

interface Props {
  onPick: (c: AmsCase) => void
  disabled?: boolean
}

/** Optional "Link an AMS case" search box. Searches the advocate's AMS cases by
 *  number, title or client name. */
export default function AmsCasePicker({ onPick, disabled }: Props) {
  const [value, setValue] = useState<AmsCase | string>('')
  const [suggestions, setSuggestions] = useState<AmsCase[]>([])
  const [error, setError] = useState('')

  const search = (query: string) => {
    setError('')
    amsApi.cases(query)
      .then(r => setSuggestions(r.content))
      .catch(() => { setSuggestions([]); setError('Could not reach AMS.') })
  }

  return (
    <div className="flex flex-column gap-1">
      <AutoComplete value={value} suggestions={suggestions} dropdown forceSelection disabled={disabled}
        field="caseNumber" placeholder="Search AMS cases by number, title or client"
        completeMethod={e => search(e.query)}
        itemTemplate={(c: AmsCase) => (
          <div>
            <div className="font-medium">{amsCaseLabel(c)}</div>
            {c.clientName && <div className="text-sm text-color-secondary">{c.clientName}</div>}
          </div>
        )}
        onChange={e => setValue(e.value)}
        onSelect={e => { onPick(e.value as AmsCase); setValue('') }}
        className="w-full" inputClassName="w-full" />
      {error && <small style={{ color: '#dc2626' }}>{error}</small>}
    </div>
  )
}
