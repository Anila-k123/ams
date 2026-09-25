import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import ClauseNodeView from '../components/ClauseNodeView'

/**
 * Top-level document node whose content is a sequence of `clause` nodes — so the
 * whole draft is a list of addressable clauses (each keyed by its DraftBlock id).
 * Replaces StarterKit's default Document (which is disabled where this is used).
 */
export const ClauseDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'clause+',
})

/**
 * One clause of the draft — an addressable block carrying its DraftBlock id +
 * provenance (heading, source, verified). Its body is ordinary rich text
 * (`block+`), rendered through a React NodeView that shows the heading + a
 * source chip. Serialised to/from `<section data-clause …>` so we can build the
 * initial document from stored HTML and read it back on save.
 */
export interface Citation {
  n: number
  doc?: string | null
  page?: number
  text?: string
  url?: string | null
}

export const Clause = Node.create<{
  getCitation?: (blockId: number) => Citation | undefined
  onCite?: (url: string, name?: string) => void
}>({
  name: 'clause',
  group: 'block',
  content: 'block+',
  defining: true,

  addOptions() {
    return { getCitation: undefined, onCite: undefined }
  },

  addAttributes() {
    return {
      blockId: {
        default: null,
        parseHTML: el => el.getAttribute('data-block-id'),
        renderHTML: attrs => (attrs.blockId ? { 'data-block-id': attrs.blockId } : {}),
      },
      heading: {
        default: '',
        parseHTML: el => el.getAttribute('data-heading') || '',
        renderHTML: attrs => ({ 'data-heading': attrs.heading || '' }),
      },
      // Captured template heading style ({align,font,size,color,bold,italic,…}),
      // round-tripped as a JSON attribute so the heading keeps the template's look.
      headingStyle: {
        default: null,
        parseHTML: el => {
          try { return JSON.parse(el.getAttribute('data-heading-style') || 'null') } catch { return null }
        },
        renderHTML: attrs => (attrs.headingStyle ? { 'data-heading-style': JSON.stringify(attrs.headingStyle) } : {}),
      },
      source: {
        default: 'generated',
        parseHTML: el => el.getAttribute('data-source') || 'generated',
        renderHTML: attrs => ({ 'data-source': attrs.source }),
      },
      verified: {
        default: false,
        parseHTML: el => el.getAttribute('data-verified') === 'true',
        renderHTML: attrs => ({ 'data-verified': attrs.verified ? 'true' : 'false' }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'section[data-clause]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['section', mergeAttributes(HTMLAttributes, { 'data-clause': '' }), 0]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ClauseNodeView)
  },
})
