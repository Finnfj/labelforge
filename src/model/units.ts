/**
 * Geometry for the P50 print head.
 *
 * The head is a 203 dpi thermal head. 203 dpi is 7.992 dots/mm, but the vendor —
 * like every printer in this class — treats it as exactly 8 dots/mm, and the label
 * stock is specified in whole millimetres against that assumption. We follow suit:
 * using the "true" 7.992 would make a 50 mm label 399.6 dots and force a rounding
 * decision on every element, for a cumulative error of 0.2 mm across a whole label.
 */
export const DPI = 203
export const DOTS_PER_MM = 8

/** Millimetres to printer dots. */
export function mmToDots(mm: number): number {
  return Math.round(mm * DOTS_PER_MM)
}

/** Printer dots to millimetres. */
export function dotsToMm(dots: number): number {
  return dots / DOTS_PER_MM
}

/**
 * Millimetres to dots at an arbitrary resolution.
 *
 * For a printer whose dot pitch differs from the P50's — the DYMO LetraTag's is
 * roughly a third of it — every element's position and size has to scale by the
 * same factor as the canvas itself, not just the canvas. `toFabric.ts` is where
 * that otherwise goes wrong: a label rasterised at the right canvas size but with
 * every element still placed at 8 dots/mm comes out looking like the right
 * picture blown up several times past the edges of its own canvas.
 */
export function mmToDotsAt(mm: number, dotsPerMm: number): number {
  return Math.round(mm * dotsPerMm)
}

/**
 * Typographic points to printer dots.
 *
 * Font sizes are specified in points because that is what people know, but the
 * canvas we rasterise on is measured in dots, so this is the bridge. A point is
 * 1/72 inch, so at 203 dpi one point is ~2.82 dots — meaning 6 pt text is only
 * about 17 dots tall and is close to the practical floor for this head.
 */
export function ptToDots(pt: number): number {
  return (pt * DPI) / 72
}

export function dotsToPt(dots: number): number {
  return (dots * 72) / DPI
}

/**
 * Typographic points to dots at an arbitrary resolution.
 *
 * Delegates to {@link ptToDots} exactly at the P50's own dot pitch, rather than
 * recomputing it from a derived DPI, so every existing call keeps its exact
 * output — `DPI` is 203 by vendor convention, not the 203.2 that `DOTS_PER_MM *
 * 25.4` would give, and this must not move that by even a rounding hair for the
 * family it already prints on.
 */
export function ptToDotsAt(pt: number, dotsPerMm: number): number {
  if (dotsPerMm === DOTS_PER_MM) return ptToDots(pt)
  return (pt * (dotsPerMm * 25.4)) / 72
}

/**
 * Head width in dots.
 *
 * 384 dots = 48.0 mm on a P50S, which agrees with the vendor SDK. Established by
 * the edge-frame pattern: at 384 all four sides of the frame print, and at 400
 * the edge is lost.
 *
 * This was briefly set to 400 on weaker evidence — a label right-aligned against
 * 384 landed 16 dots too far left, and 400 − 384 = 16 looked conclusive. It was
 * not: that inference assumed the printable label was exactly 320 dots wide, and
 * a horizontal *placement* error cannot distinguish a wider head from paper that
 * sits further right. The edge frame tests the thing directly, so it wins.
 *
 * Still a default rather than a constant: nothing in the protocol reports it, and
 * other models in the family differ.
 */
export const DEFAULT_HEAD_WIDTH_DOTS = 384
