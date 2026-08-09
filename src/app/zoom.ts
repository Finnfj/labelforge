/** CSS pixels per inch, as assumed by every browser. */
const CSS_DPI = 96
const PRINTER_DPI = 203

export type ZoomSetting = 'fit' | 'actual' | 1 | 2 | 4

/** Beyond this, a small label fills the screen for no extra insight. */
const MAX_FIT_FACTOR = 8

/**
 * Display scale for a printer dot.
 *
 * "actual" shows the label at its real physical size on screen, which is the only
 * honest way to judge whether 6 pt text is going to be readable once printed.
 */
export function zoomFactor(zoom: Exclude<ZoomSetting, 'fit'>): number {
  return zoom === 'actual' ? CSS_DPI / PRINTER_DPI : zoom
}

/**
 * Largest whole-dot scale that fits the available width.
 *
 * Deliberately an integer: the preview exists to show the 1-bit bitmap
 * faithfully, and a fractional scale under `image-rendering: pixelated` makes
 * some dots wider than others, which reads as a rendering defect that is not
 * actually in the data.
 */
export function fitFactor(availableWidth: number, bitmapWidth: number): number {
  if (!availableWidth || !bitmapWidth) return 1
  return Math.max(1, Math.min(MAX_FIT_FACTOR, Math.floor(availableWidth / bitmapWidth)))
}
