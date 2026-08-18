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

/**
 * Fit scale for the vector editor, where a fractional scale is harmless.
 *
 * Deliberately *not* {@link fitFactor}. That one floors to a whole integer
 * because `PaperRoll` paints one device pixel per printer dot under
 * `image-rendering: pixelated`, where a fractional scale makes some dots wider
 * than others and reads as a rendering defect that is not in the data. The
 * editor draws vectors through Fabric's own zoom, so it has no such constraint
 * and can use every pixel the panel offers.
 */
export function fitScale(availableWidth: number, contentWidth: number): number {
  if (!availableWidth || !contentWidth) return 1
  return Math.max(MIN_EDIT_ZOOM, Math.min(MAX_FIT_FACTOR, availableWidth / contentWidth))
}

/** Below this the label is too small to place anything on with a pointer. */
const MIN_EDIT_ZOOM = 0.25
