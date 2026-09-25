import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import PlaceholderNodeView from '../components/PlaceholderNodeView'

/**
 * An inline, atomic placeholder — a fillable field carrying {label, value}. The
 * generator emits `[[Label]]` text which is converted to these nodes on load; the
 * document renders the value (or "[Label]" while empty), and the placeholders panel
 * edits the value live. Serialises to `<span data-placeholder data-value>` so it
 * round-trips through save/reload.
 */
export const Placeholder = Node.create({
  name: 'placeholder',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      label: {
        default: '',
        parseHTML: el => el.getAttribute('data-placeholder') || '',
        renderHTML: attrs => ({ 'data-placeholder': attrs.label }),
      },
      value: {
        default: '',
        parseHTML: el => el.getAttribute('data-value') || '',
        renderHTML: attrs => ({ 'data-value': attrs.value || '' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-placeholder]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    // Inner text = the value, or [Label] when empty. Single brackets so a reload
    // doesn't re-match the [[…]] token conversion.
    return ['span', mergeAttributes(HTMLAttributes), node.attrs.value || `[${node.attrs.label}]`]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PlaceholderNodeView)
  },
})
