import type { DraftBlock } from '../api/drafting'
import Icon from '../../../ui/Icon'

/**
 * Status chip for a draft block. Shows a green "Cited" badge (with match %
 * when a similarity score is available) only for verified sample-clause blocks;
 * everything else — prompt text and unverified AI output — gets "Needs review".
 */
export default function BlockBadge({ block }: { block: DraftBlock }) {
  if (block.verified && block.source === 'sample_clause') {
    // Convert the 0..1 cosine similarity to a whole-number percentage for display.
    const pct = block.similarity_score != null ? Math.round(block.similarity_score * 100) : null
    return (
      <span className="chip ok">
        <Icon name="ok" size="sm" />
        {pct != null ? `Cited · ${pct}% match` : 'Cited from sample'}
      </span>
    )
  }
  return (
    <span className="chip warn">
      <Icon name="warn" size="sm" />
      Needs review
    </span>
  )
}
