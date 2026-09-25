import { Mark, mergeAttributes } from '@tiptap/core'

/** Marks text that an accepted AI edit just changed, so the lawyer can see what
 *  was altered. Rendered green; cleared on Save (once reviewed). Round-trips as
 *  <span data-edit-hl>. */
export const EditHighlight = Mark.create({
  name: 'editHighlight',
  parseHTML() {
    return [{ tag: 'span[data-edit-hl]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-edit-hl': '', class: 'pp-edit-hl' }), 0]
  },
})
