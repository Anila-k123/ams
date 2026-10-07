import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { searchKey } from '../editor/search'
import Icon from '../../../ui/Icon'
import DIcon from './DIcon'

function Btn({ active, onClick, title, children }: {
  active?: boolean; onClick: () => void; title: string; children: React.ReactNode
}) {
  return (
    <button type="button" title={title} aria-label={title} aria-pressed={active}
      className={`btn ghost sm icon dr-tb-btn${active ? ' active' : ''}`}
      // preventDefault keeps the editor selection while clicking the button
      onMouseDown={e => { e.preventDefault(); onClick() }}>
      {children}
    </button>
  )
}

/** In-document find: a search box (highlight all + prev/next) for the editor. */
function SearchBox({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [info, setInfo] = useState({ count: 0, current: 0 })
  const inputRef = useRef<HTMLInputElement>(null)

  const refresh = () => {
    const s = searchKey.getState(editor.state) as { matches?: unknown[]; current?: number } | undefined
    const count = s?.matches?.length ?? 0
    setInfo({ count, current: count ? (s!.current ?? 0) + 1 : 0 })
  }
  // Scroll the current match to the centre of the document view.
  const scrollToCurrent = () => {
    const el = document.querySelector('.pp-editor-paper .pp-search-hit.current') as HTMLElement | null
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const afterSearch = () => requestAnimationFrame(() => { refresh(); scrollToCurrent() })
  const runSearch = (v: string) => { setQ(v); editor.commands.setSearch(v); afterSearch() }
  const go = (dir: 1 | -1) => { editor.commands.searchGo(dir); afterSearch() }
  const close = () => { setOpen(false); setQ(''); editor.commands.clearSearch() }

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  if (!open) {
    return <Btn title="Find in document" onClick={() => setOpen(true)}><Icon name="search" size="sm" /></Btn>
  }
  return (
    <div className="row" style={{ gap: 2 }}>
      <div className="input-icon dr-find">
        <Icon name="search" size="sm" />
        <input ref={inputRef} className="input" type="search" value={q} placeholder="Find" aria-label="Find in document"
          onChange={e => runSearch(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1) }
            if (e.key === 'Escape') { e.preventDefault(); close() }
          }} />
      </div>
      <span className="faint xs mono" aria-live="polite" style={{ minWidth: 36, textAlign: 'center' }}>{info.count ? `${info.current}/${info.count}` : (q ? '0/0' : '')}</span>
      <Btn title="Previous (Shift+Enter)" onClick={() => go(-1)}><DIcon name="chevronUp" /></Btn>
      <Btn title="Next (Enter)" onClick={() => go(1)}><Icon name="chevronDown" size="sm" /></Btn>
      <Btn title="Close (Esc)" onClick={close}><Icon name="x" size="sm" /></Btn>
    </div>
  )
}

/** Formatting toolbar for the draft editor (bold / italic / headings / lists / find). */
export default function EditorToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null
  const c = () => editor.chain().focus()
  return (
    <div className="ed-tools" role="toolbar" aria-label="Formatting">
      <Btn title="Bold" active={editor.isActive('bold')} onClick={() => c().toggleBold().run()}><b>B</b></Btn>
      <Btn title="Italic" active={editor.isActive('italic')} onClick={() => c().toggleItalic().run()}><i className="serif">I</i></Btn>
      <Btn title="Underline" active={editor.isActive('underline')} onClick={() => c().toggleUnderline().run()}><u>U</u></Btn>
      <Btn title="Strikethrough" active={editor.isActive('strike')} onClick={() => c().toggleStrike().run()}><s>S</s></Btn>
      <span className="sep" />
      <Btn title="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => c().setTextAlign('left').run()}><DIcon name="alignLeft" /></Btn>
      <Btn title="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => c().setTextAlign('center').run()}><DIcon name="alignCenter" /></Btn>
      <Btn title="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => c().setTextAlign('right').run()}><DIcon name="alignRight" /></Btn>
      <Btn title="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => c().setTextAlign('justify').run()}><DIcon name="alignJustify" /></Btn>
      <span className="sep" />
      <Btn title="Heading 1" active={editor.isActive('heading', { level: 1 })} onClick={() => c().toggleHeading({ level: 1 }).run()}><span className="xs">H1</span></Btn>
      <Btn title="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => c().toggleHeading({ level: 2 }).run()}><span className="xs">H2</span></Btn>
      <Btn title="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => c().toggleHeading({ level: 3 }).run()}><span className="xs">H3</span></Btn>
      <span className="sep" />
      <Btn title="Bullet list" active={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()}><Icon name="list" size="sm" /></Btn>
      <Btn title="Numbered list" active={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()}><span className="xs">1.</span></Btn>
      <span className="sep" />
      <Btn title="Undo" onClick={() => c().undo().run()}><DIcon name="undo" /></Btn>
      <Btn title="Redo" onClick={() => c().redo().run()}><DIcon name="redo" /></Btn>
      <span className="sep" />
      <SearchBox editor={editor} />
    </div>
  )
}
