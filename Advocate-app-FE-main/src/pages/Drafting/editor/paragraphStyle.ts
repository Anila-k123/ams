import { Extension } from '@tiptap/core'

/**
 * Preserve an inline `style` attribute on paragraphs so a generated clause keeps
 * the template's captured formatting (alignment, font, size, colour, emphasis).
 *
 * Implemented as a GLOBAL attribute on the existing `paragraph` node (rather than
 * redefining the node) so it composes with StarterKit and TextAlign without a
 * duplicate-node conflict. TipTap merges multiple `style` fragments, so this and
 * TextAlign's own text-align coexist.
 */
export const ParagraphStyle = Extension.create({
  name: 'paragraphStyle',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          style: {
            default: null,
            // text-align is TextAlign's (the toolbar changes it); keeping it here too would let an
            // old alignment in this string win over the new one.
            parseHTML: el => (el.getAttribute('style') || '').split(';')
              .filter(d => d.trim() && !/^\s*text-align\s*:/i.test(d)).join(';') || null,
            renderHTML: attrs => (attrs.style ? { style: attrs.style } : {}),
          },
        },
      },
    ]
  },
})
