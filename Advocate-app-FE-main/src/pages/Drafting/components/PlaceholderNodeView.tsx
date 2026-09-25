import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'

/** Renders a placeholder node inline: the filled value, or "[Label]" when empty.
 *  Not inline-editable (an atom) — it's filled/edited from the placeholders panel. */
export default function PlaceholderNodeView({ node }: NodeViewProps) {
  const label = (node.attrs.label as string) || ''
  const value = (node.attrs.value as string) || ''
  return (
    <NodeViewWrapper as="span" className={`pp-ph-node ${value ? 'filled' : 'empty'}`} title={label} data-ph-label={label}>
      {value || `[${label}]`}
    </NodeViewWrapper>
  )
}
