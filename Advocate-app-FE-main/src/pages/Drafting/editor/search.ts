import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

export const searchKey = new PluginKey('search')

interface Match { from: number; to: number }
interface SearchState { query: string; matches: Match[]; current: number; deco: DecorationSet }

/** Case-insensitive matches of `query` within single text nodes (contiguous text). */
function findMatches(doc: PMNode, query: string): Match[] {
  const out: Match[] = []
  const q = query.toLowerCase()
  if (!q) return out
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const text = node.text.toLowerCase()
    let i = 0
    while ((i = text.indexOf(q, i)) !== -1) {
      out.push({ from: pos + i, to: pos + i + q.length })
      i += q.length
    }
  })
  return out
}

function buildDeco(doc: PMNode, matches: Match[], current: number): DecorationSet {
  return DecorationSet.create(doc, matches.map((m, i) =>
    Decoration.inline(m.from, m.to, { class: i === current ? 'pp-search-hit current' : 'pp-search-hit' })))
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    search: {
      setSearch: (query: string) => ReturnType
      searchGo: (dir: 1 | -1) => ReturnType
      clearSearch: () => ReturnType
    }
  }
}

/** In-document find: highlights all matches, tracks a "current" match, and
 *  navigates next/previous (scrolling the current match into view). */
export const Search = Extension.create({
  name: 'search',

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchState>({
        key: searchKey,
        state: {
          init: () => ({ query: '', matches: [], current: 0, deco: DecorationSet.empty }),
          apply(tr, value, _old, newState) {
            const meta = tr.getMeta(searchKey) as { query?: string; current?: number } | undefined
            if (!meta && !tr.docChanged) return value
            let query = value.query
            let current = value.current
            if (meta?.query !== undefined) { query = meta.query; current = 0 }
            if (meta?.current !== undefined) current = meta.current
            const matches = findMatches(newState.doc, query)
            current = matches.length ? ((current % matches.length) + matches.length) % matches.length : 0
            return { query, matches, current, deco: buildDeco(newState.doc, matches, current) }
          },
        },
        props: {
          decorations: state => searchKey.getState(state)?.deco,
        },
      }),
    ]
  },

  addCommands() {
    return {
      setSearch: (query: string) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(searchKey, { query }))
        return true
      },
      clearSearch: () => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(searchKey, { query: '' }))
        return true
      },
      searchGo: (dir: 1 | -1) => ({ state, tr, dispatch }) => {
        const s = searchKey.getState(state)
        if (!s || !s.matches.length) return false
        const next = ((s.current + dir) % s.matches.length + s.matches.length) % s.matches.length
        if (dispatch) {
          const m = s.matches[next]
          tr.setMeta(searchKey, { current: next })
          tr.setSelection(TextSelection.create(tr.doc, m.from, m.to)).scrollIntoView()
          dispatch(tr)
        }
        return true
      },
    }
  },
})
