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
export const MIN_EDIT_ZOOM = 0.25

/** Above this a label fills the screen for no extra insight. */
export const MAX_EDIT_ZOOM = MAX_FIT_FACTOR

/**
 * Hold a zoom inside what the editor can usefully show.
 *
 * Exists because the editor's zoom stopped being a menu of five values the moment
 * Ctrl+scroll could set it: a pinch produces a continuous stream of factors, and
 * something has to stop it running to a thousandth or a thousand times.
 */
export function clampEditZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1
  return Math.max(MIN_EDIT_ZOOM, Math.min(MAX_EDIT_ZOOM, scale))
}

/**
 * How much one wheel event should scale the editor by.
 *
 * A trackpad pinch reaches the page as a `wheel` event with `ctrlKey` set — there is
 * no separate pinch event on the desktop — so this covers both that and holding Ctrl
 * with a mouse wheel, which is the point: they should feel the same.
 *
 * **`deltaMode` is the part that is easy to get wrong.** The same gesture reports
 * pixels in Chrome and lines in Firefox, where a mouse notch is 3 rather than 100.
 * Taken at face value, Firefox would zoom by a thirtieth of what Chrome does and the
 * feature would look broken on one browser only.
 *
 * Exponential rather than additive, so that a step out undoes a step in exactly and
 * the rate feels the same at 30% as at 300%. The divisor is tuned so one mouse notch
 * is about a fifth, which leaves a trackpad's much smaller deltas as a smooth ramp.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY)) return 1
  const perUnit = deltaMode === 1 ? LINE_HEIGHT_PX : deltaMode === 2 ? PAGE_HEIGHT_PX : 1
  return Math.exp((-deltaY * perUnit) / WHEEL_ZOOM_DIVISOR)
}

/** Roughly a line of text, which is what `deltaMode: 1` counts in. */
const LINE_HEIGHT_PX = 16
/** Roughly a screenful, which is what `deltaMode: 2` counts in. */
const PAGE_HEIGHT_PX = 400
const WHEEL_ZOOM_DIVISOR = 400
