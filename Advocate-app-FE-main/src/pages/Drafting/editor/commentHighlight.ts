import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'

export const commentHighlightKey = new PluginKey('commentHighlight')

interface CommentState { quotes: string[]; deco: DecorationSet }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/** Mark the passages open comments are about (drafting/comments.py keeps the quoted words).
 *  Same matching as the risk underline (riskHighlight.ts): case- and whitespace-insensitive,
 *  within one text node. A quote that was since edited away simply isn't marked. */
function buildDeco(doc: PMNode, quotes: string[]): DecorationSet {
  const needles = quotes.map(norm).filter(q => q.length >= 3)
  if (!needles.length) return DecorationSet.empty
  const decos: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    const hay = norm(node.text)
    for (const q of needles) {
      let i = hay.indexOf(q)
      while (i !== -1) {
        const from = pos + Math.min(i, node.text.length)
        const to = pos + Math.min(i + q.length, node.text.length)
        if (to > from) decos.push(Decoration.inline(from, to, { class: 'pp-comment-hl' }))
        i = hay.indexOf(q, i + q.length)
      }
    }
  })
  return DecorationSet.create(doc, decos)
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    commentHighlight: {
      /** Set the quotes of open comments to mark (replaces any previous set). */
      setCommentQuotes: (quotes: string[]) => ReturnType
    }
  }
}

export const CommentHighlight = Extension.create({
  name: 'commentHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin<CommentState>({
        key: commentHighlightKey,
        state: {
          init: () => ({ quotes: [], deco: DecorationSet.empty }),
          apply(tr, value, _old, newState) {
            const meta = tr.getMeta(commentHighlightKey) as { quotes?: string[] } | undefined
            if (!meta && !tr.docChanged) return value
            const quotes = meta?.quotes ?? value.quotes
            return { quotes, deco: buildDeco(newState.doc, quotes) }
          },
        },
        props: { decorations: state => commentHighlightKey.getState(state)?.deco },
      }),
    ]
  },

  addCommands() {
    return {
      setCommentQuotes: (quotes: string[]) => ({ tr, dispatch }) => {
        if (dispatch) dispatch(tr.setMeta(commentHighlightKey, { quotes }))
        return true
      },
    }
  },
})
