import { Field, TextField } from '../../../ui/forms'
import Icon from '../../../ui/Icon'
import { ENTITY_TYPES } from '../constants/legal'

/** One party to the document, as both new-draft forms collect it. */
export interface Party {
  name: string
  entity: string
  role: string
  address: string
  representative: string
}

export const emptyParty = (): Party => ({ name: '', entity: '', role: '', address: '', representative: '' })

/** Each party as one readable line for the drafting brief (facts.parties): name + the details given,
 *  e.g. "K. Kannan, entity type: Individual, role: Lessor". The role is what lets the AI bind each name
 *  to its part in the document, whatever order the reference names the parties in. */
export const partyLines = (parties: Party[]): string[] => parties
  .map(p => {
    if (!p.name.trim()) return ''
    const bits = [p.name.trim()]
    if (p.entity.trim()) bits.push(`entity type: ${p.entity.trim()}`)
    if (p.role.trim()) bits.push(`role: ${p.role.trim()}`)
    if (p.address.trim()) bits.push(`address: ${p.address.trim()}`)
    if (p.representative.trim()) bits.push(`represented by: ${p.representative.trim()}`)
    return bits.join(', ')
  })
  .filter(Boolean)

interface Props {
  parties: Party[]
  onChange: (parties: Party[]) => void
  options?: string[]          // suggested names (the linked case's client and opposite party)
  listId: string              // id for the names datalist (unique per form)
  rolePlaceholder?: string
}

// The parties to the document: one card per party (name, entity type, role, representative,
// address), add / remove rows for one, two or more. Shared by "Type the facts directly" and
// "Start from reference documents".
export default function PartiesEditor({ parties, onChange, options = [], listId, rolePlaceholder = 'Lessor, Plaintiff, Advocate' }: Props) {
  const set = (i: number, key: keyof Party, val: string) =>
    onChange(parties.map((p, idx) => (idx === i ? { ...p, [key]: val } : p)))
  const add = () => onChange([...parties, emptyParty()])
  const remove = (i: number) => onChange(parties.length > 1 ? parties.filter((_, idx) => idx !== i) : parties)

  return (
    <div className="stack" style={{ gap: 10 }}>
      <span className="label">Parties</span>
      <datalist id={listId}>{options.map(n => <option key={n} value={n} />)}</datalist>
      {parties.map((p, i) => (
        <div key={i} className="panel tinted"><div className="panel-body" style={{ padding: '14px 16px' }}>
          <div className="row between" style={{ marginBottom: 10 }}>
            <b className="small">Party {i + 1}</b>
            <button type="button" className="btn ghost sm" disabled={parties.length <= 1}
              aria-label={`Remove party ${i + 1}`} onClick={() => remove(i)}><Icon name="trash" size="sm" />Remove</button>
          </div>
          <div className="form-grid">
            <TextField label="Name" value={p.name} list={listId} onChange={e => set(i, 'name', e.target.value)} />
            <Field label="Entity type">
              {id => (
                <select id={id} className="input" value={p.entity} onChange={e => set(i, 'entity', e.target.value)}>
                  <option value="">Select</option>
                  {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              )}
            </Field>
            <TextField label="Role" value={p.role} onChange={e => set(i, 'role', e.target.value)} placeholder={rolePlaceholder}
              hint="Their part in this document. Tells the AI who is who." />
            <TextField label="Represented by (optional)" value={p.representative} onChange={e => set(i, 'representative', e.target.value)} />
            <TextField full label="Address (optional)" value={p.address} onChange={e => set(i, 'address', e.target.value)} />
          </div>
        </div></div>
      ))}
      <div><button type="button" className="btn ghost sm" onClick={add}><Icon name="plus" size="sm" />Add party</button></div>
    </div>
  )
}
