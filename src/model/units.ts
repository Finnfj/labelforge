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
 * Head width in dots, until measured on real hardware.
 *
 * 384 dots = 48.0 mm, which is what the vendor SDK's example handler hard-codes.
 * The P50 is advertised as printing up to 50 mm, so this may well be 400. It is
 * deliberately a default rather than a constant: the diagnostics ruler strip
 * measures the real value and it is then stored per printer.
 */
export const DEFAULT_HEAD_WIDTH_DOTS = 384
