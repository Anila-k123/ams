import { diffWords } from 'diff'

/** One find-and-replace that turns part of a clause from `before` into `after`. */
export type TextEdit = { find: string; replace: string }

// Words around a change, added until the searched text is unique in the document.
const MAX_CONTEXT_WORDS = 12
// Changes closer than this (characters of unchanged text) are applied as one edit.
const MERGE_GAP = 40

function countIn(haystack: string, needle: string): number {
  if (!needle) return 0
  let n = 0
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) n++
  return n
}

/** Grow [s, e) in `text` by one word on each side. */
function widen(text: string, s: number, e: number): [number, number] {
  let ns = s
  while (ns > 0 && /\s/.test(text[ns - 1])) ns--
  while (ns > 0 && !/\s/.test(text[ns - 1])) ns--
  let ne = e
  while (ne < text.length && /\s/.test(text[ne])) ne++
  while (ne < text.length && !/\s/.test(text[ne])) ne++
  return [ns, ne]
}

/**
 * The smallest find-and-replace edits that turn a clause's `before` text into `after`, each one long
 * enough to occur exactly once in `documentText` (every clause of the draft). Used to apply Lisa's
 * accepted change inside the open Word editor without rewriting (and re-formatting) the whole clause.
 * Returns null when a change can't be pinned to one place.
 */
export function editsFor(before: string, after: string, documentText: string): TextEdit[] | null {
  if (before === after) return []
  // Changed ranges of `before`, with what replaces each.
  const hunks: { s: number; e: number; text: string }[] = []
  let pos = 0
  for (const part of diffWords(before, after)) {
    if (part.added) {
      const last = hunks[hunks.length - 1]
      if (last && last.e === pos) last.text += part.value
      else hunks.push({ s: pos, e: pos, text: part.value })
    } else if (part.removed) {
      const last = hunks[hunks.length - 1]
      if (last && last.e === pos) last.e = pos + part.value.length
      else hunks.push({ s: pos, e: pos + part.value.length, text: '' })
      pos += part.value.length
    } else {
      pos += part.value.length
    }
  }
  // Close changes become one edit, so their contexts never overlap.
  const merged: typeof hunks = []
  for (const h of hunks) {
    const last = merged[merged.length - 1]
    if (last && h.s - last.e < MERGE_GAP) {
      last.text += before.slice(last.e, h.s) + h.text
      last.e = h.e
    } else {
      merged.push({ ...h })
    }
  }
  const edits: TextEdit[] = []
  for (const h of merged) {
    let [s, e] = [h.s, h.e]
    if (s === e) [s, e] = widen(before, s, e)              // a pure insertion needs an anchor
    let tries = 0
    while (countIn(documentText, before.slice(s, e)) !== 1 && tries < MAX_CONTEXT_WORDS) {
      const [ns, ne] = widen(before, s, e)
      if (ns === s && ne === e) break
      [s, e] = [ns, ne]
      tries++
    }
    const find = before.slice(s, e)
    if (!find.trim() || countIn(documentText, find) !== 1) return null
    edits.push({ find, replace: before.slice(s, h.s) + h.text + before.slice(h.e, e) })
  }
  return edits
}
