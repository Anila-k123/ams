import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

export const riskHighlightKey = new PluginKey('riskHighlight')

interface RiskState { quotes: string[]; deco: DecorationSet }

/** Normalise whitespace so a stored quote still matches text that was re-wrapped. */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** Underline every occurrence of a risk `quote` that is actually present in the
 *  document. Omission findings (whose quote isn't in the text) simply produce no
 *  decoration — they're surfaced by the gutter marker instead. Matching is done
 *  within a single text node (contiguous text), case- and whitespace-insensitive. */
function buildDeco(doc: PMNode, quotes: string[]): DecorationSet {
  if (!quotes.length) return DecorationSet.empty
  const needles = quotes.map(norm).filter(q => q.length >= 4)
  if (!needles.length) return DecorationSet.empty

  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const hay = norm(node.text)
    for (const q of needles) {
      let i = hay.indexOf(q)
      while (i !== -1) {
        // hay is whitespace-collapsed; for typical single-space text this maps
        // 1:1 to the source. Guard the bounds against off-by-one on the node end.
        const from = pos + Math.min(i, node.text.length)
        const to = pos + Math.min(i + q.length, node.text.length)
        if (to > from) decos.push(Decoration.inline(from, to, { class: 'pp-risk-hl' }))
        i = hay.indexOf(q, i + q.length)
      }
    }
  })
  return DecorationSet.create(doc, decos)
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    riskHighlight: {
      /** Set the list of risk quotes to underline (replaces any previous set). */
      setRiskQuotes: (quotes: string[]) => ReturnType
    }
  }
}

/** Underlines the verbatim excerpts that playbook risk findings point at. */
export const RiskHighlight = Extension.create({
  name: 'riskHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<RiskState>({
        key: riskHighlightKey,
        state: {
          init: () => ({ quotes: [], deco: DecorationSet.empty }),
          apply(tr, value, _old, newState) {
            const meta = tr.getMeta(riskHighlightKey) as { quotes?: string[] } | undefined
            if (!meta && !tr.docChanged) return value
            const quotes = meta?.quotes ?? value.quotes
            return { quotes, deco: buildDeco(newState.doc, quotes) }
          },
        },
        props: {
          decorations: state => riskHighlightKey.getState(state)?.deco,
        },
      }),
    ]
  },

  addCommands() {
    return {
      setRiskQuotes: (quotes: string[]) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(riskHighlightKey, { quotes }))
        return true
      },
    }
  },
})
