import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check } from '../../../ui/forms'
import Icon from '../../../ui/Icon'

const LETTERHEAD_KEY = 'pp_download_letterhead'
const WIDTH = 280

function readLetterhead(): boolean {
  try { return localStorage.getItem(LETTERHEAD_KEY) === '1' } catch { return false }
}

interface Props {
  anchor: HTMLElement
  onClose: () => void
  onDownload: (letterhead: boolean, format: 'docx' | 'pdf') => void
  onRedline: (letterhead: boolean) => void
}

// Download → PDF / Word / Redline, with one "Add firm letterhead" tick instead of a menu item
// per format × look. The letterhead (firm logo, address, signature block) suits the office's own
// letters, notices and opinions, not deeds or pleadings, so it is off unless ticked; the choice
// is remembered per browser. A popover of its own (not the kit's PopMenu) because it holds a
// checkbox, and ticking it must not close the menu.
export default function DownloadPanel({ anchor, onClose, onDownload, onRedline }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [letterhead, setLetterhead] = useState(readLetterhead)

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); anchor.focus() } }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [anchor, onClose])

  const changeLetterhead = (on: boolean) => {
    setLetterhead(on)
    try { localStorage.setItem(LETTERHEAD_KEY, on ? '1' : '0') } catch { /* private window: not remembered */ }
  }
  const pick = (fn: () => void) => { onClose(); fn() }

  const r = anchor.getBoundingClientRect()
  return createPortal(
    <div ref={ref} className="popover menu" role="menu" aria-label="Download"
      style={{ left: Math.max(8, r.right - WIDTH), top: r.bottom + 6, width: WIDTH }}>
      <div style={{ padding: '6px 10px 8px' }}>
        <Check label="Add firm letterhead" checked={letterhead} onChange={e => changeLetterhead(e.target.checked)} />
      </div>
      <div className="sep" />
      <button type="button" role="menuitem" onClick={() => pick(() => onDownload(letterhead, 'pdf'))}>
        <Icon name="file" size="sm" /><span className="grow">PDF</span>
      </button>
      <button type="button" role="menuitem" onClick={() => pick(() => onDownload(letterhead, 'docx'))}>
        <Icon name="file" size="sm" /><span className="grow">Word (.docx)</span>
      </button>
      <button type="button" role="menuitem" onClick={() => pick(() => onRedline(letterhead))}>
        <Icon name="swap" size="sm" /><span className="grow">Redline (tracked changes)…</span>
      </button>
      <div className="sep" />
      <p className="faint xs" style={{ margin: 0, padding: '4px 10px 6px' }}>
        Letterhead adds your firm's logo, address and signature block. Use it for notices, opinions
        and letters, not for deeds or pleadings (the parties sign those).
      </p>
    </div>,
    document.body,
  )
}
