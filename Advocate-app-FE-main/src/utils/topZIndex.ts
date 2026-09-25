/**
 * The z-index just above everything currently layered on the page.
 *
 * PrimeReact stacks dialogs, menus and tooltips by adding to the last overlay's
 * z-index (for a different overlay type it adds the whole base again: 10101 -> 20102
 * -> ...), so no fixed number is safely "on top". Pop-ups that open from inside a
 * dialog (the document summary's term and law-code look-ups) ask for this when they open.
 */
export function topZIndex(min = 1000): number {
  let top = min
  for (const el of Array.from(document.body.children) as HTMLElement[]) {
    const z = parseInt(getComputedStyle(el).zIndex, 10)
    if (!Number.isNaN(z) && z > top) top = z
  }
  return top + 1
}
