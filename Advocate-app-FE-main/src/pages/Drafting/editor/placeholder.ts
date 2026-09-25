import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// Unfilled placeholders: 2+ underscores, a dot-leader/ellipsis run (2+ ellipsis
// chars or 4+ dots — a normal "..." is left alone), or an empty/blank bracket.
// Kept in sync with the read-only view's detector.
const BLANK_SRC = '_{2,}|…{2,}|\\.{4,}|\\[\\[[^\\]]+\\]\\]|\\[[\\s_.•●…]*\\]'

/** Live-highlights unfilled placeholders in the editor as the user types. */
export const PlaceholderHighlight = Extension.create({
  name: 'placeholderHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('placeholderHighlight'),
        props: {
          decorations(state) {
            const decos: Decoration[] = []
            const re = new RegExp(BLANK_SRC, 'g')
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              re.lastIndex = 0
              let m: RegExpExecArray | null
              while ((m = re.exec(node.text)) !== null) {
                const from = pos + m.index
                decos.push(Decoration.inline(from, from + m[0].length, {
                  class: 'pp-blank',
                  title: 'Unfilled placeholder — provide this value',
                }))
              }
            })
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})
