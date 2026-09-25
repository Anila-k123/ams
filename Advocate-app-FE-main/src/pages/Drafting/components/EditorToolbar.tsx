import { useEffect, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { searchKey } from '../editor/search'

function Btn({ active, onClick, title, children }: {
  active?: boolean; onClick: () => void; title: string; children: React.ReactNode
}) {
  return (
    <button type="button" title={title}
      className={`pp-tb-btn${active ? ' active' : ''}`}
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
    return <Btn title="Find in document" onClick={() => setOpen(true)}><i className="pi pi-search" /></Btn>
  }
  return (
    <div className="pp-tb-search">
      <i className="pi pi-search pp-tb-search-icon" />
      <input ref={inputRef} className="pp-tb-search-input" value={q} placeholder="Find in document"
        onChange={e => runSearch(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1) }
          if (e.key === 'Escape') { e.preventDefault(); close() }
        }} />
      <span className="pp-tb-search-count">{info.count ? `${info.current}/${info.count}` : (q ? '0/0' : '')}</span>
      <Btn title="Previous (Shift+Enter)" onClick={() => go(-1)}><i className="pi pi-chevron-up" /></Btn>
      <Btn title="Next (Enter)" onClick={() => go(1)}><i className="pi pi-chevron-down" /></Btn>
      <Btn title="Close (Esc)" onClick={close}><i className="pi pi-times" /></Btn>
    </div>
  )
}

/** Formatting toolbar for the draft editor (bold / italic / headings / lists / find). */
export default function EditorToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null
  const c = () => editor.chain().focus()
  return (
    <div className="pp-toolbar">
      <Btn title="Bold" active={editor.isActive('bold')} onClick={() => c().toggleBold().run()}><b>B</b></Btn>
      <Btn title="Italic" active={editor.isActive('italic')} onClick={() => c().toggleItalic().run()}><i>I</i></Btn>
      <Btn title="Underline" active={editor.isActive('underline')} onClick={() => c().toggleUnderline().run()}><u>U</u></Btn>
      <Btn title="Strikethrough" active={editor.isActive('strike')} onClick={() => c().toggleStrike().run()}><s>S</s></Btn>
      <span className="pp-tb-sep" />
      <Btn title="Align left" active={editor.isActive({ textAlign: 'left' })} onClick={() => c().setTextAlign('left').run()}><i className="pi pi-align-left" /></Btn>
      <Btn title="Align center" active={editor.isActive({ textAlign: 'center' })} onClick={() => c().setTextAlign('center').run()}><i className="pi pi-align-center" /></Btn>
      <Btn title="Align right" active={editor.isActive({ textAlign: 'right' })} onClick={() => c().setTextAlign('right').run()}><i className="pi pi-align-right" /></Btn>
      <Btn title="Justify" active={editor.isActive({ textAlign: 'justify' })} onClick={() => c().setTextAlign('justify').run()}><i className="pi pi-align-justify" /></Btn>
      <span className="pp-tb-sep" />
      <Btn title="Heading 1" active={editor.isActive('heading', { level: 1 })} onClick={() => c().toggleHeading({ level: 1 }).run()}>H1</Btn>
      <Btn title="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => c().toggleHeading({ level: 2 }).run()}>H2</Btn>
      <Btn title="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => c().toggleHeading({ level: 3 }).run()}>H3</Btn>
      <span className="pp-tb-sep" />
      <Btn title="Bullet list" active={editor.isActive('bulletList')} onClick={() => c().toggleBulletList().run()}><i className="pi pi-list" /></Btn>
      <Btn title="Numbered list" active={editor.isActive('orderedList')} onClick={() => c().toggleOrderedList().run()}>1.</Btn>
      <span className="pp-tb-sep" />
      <Btn title="Undo" onClick={() => c().undo().run()}><i className="pi pi-undo" /></Btn>
      <Btn title="Redo" onClick={() => c().redo().run()}><i className="pi pi-refresh" /></Btn>
      <span className="pp-tb-sep" />
      <SearchBox editor={editor} />
    </div>
  )
}
