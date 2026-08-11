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
 * Head width in dots.
 *
 * 400 dots = 50.0 mm, measured on a P50S rather than assumed. The vendor SDK's
 * example handler hard-codes 384 (48 mm), and following it produced a label
 * right-aligned 16 dots — exactly 400 − 384 — too far left. The printer is a
 * genuine 50 mm device and the SDK's figure is wrong for it.
 *
 * Still a default rather than a constant: it is stored per printer, because
 * nothing in the protocol reports it and other models in the family differ.
 */
export const DEFAULT_HEAD_WIDTH_DOTS = 400
