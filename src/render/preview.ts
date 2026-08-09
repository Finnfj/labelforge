import { getDot, type PackedBitmap } from '../model/bitmap'

export type PreviewMode = 'crisp' | 'thermal'

export interface PreviewImage {
  width: number
  height: number
  /** RGBA, ready to hand to `new ImageData(...)`. */
  data: Uint8ClampedArray<ArrayBuffer>
}

/**
 * Render the *final* packed bitmap — the exact buffer the printer receives — so
 * the preview cannot drift away from what actually prints.
 *
 * `thermal` approximates what a 203 dpi head really puts on paper: heat spreads
 * into neighbouring dots, so black grows slightly and thin white gaps close up.
 * It is deliberately pessimistic, because the failure it exists to catch — small
 * text smearing shut, fine dithering turning into a grey smudge — is invisible in
 * a crisp preview and only shows up after you have wasted a label on it.
 */
export function toPreviewImage(
  bm: PackedBitmap,
  mode: PreviewMode = 'crisp',
  labelWidthDots = bm.widthDots,
  /**
   * Columns to show. The printer is always sent a full head-width raster, but
   * showing all of it makes every label look like it has an unexplained blank
   * strip down one side, so by default only the label itself is displayed.
   */
  viewWidthDots = bm.widthDots,
): PreviewImage {
  const h = bm.heightDots
  const w = Math.max(1, Math.min(viewWidthDots, bm.widthDots))
  const data = new Uint8ClampedArray(w * h * 4)

  const coverage = mode === 'thermal' ? thermalCoverage(bm) : null

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      // The coverage map spans the full bitmap, so it is indexed by the bitmap's
      // stride, not the (possibly narrower) view width.
      const ink = coverage ? coverage[y * bm.widthDots + x] : getDot(bm, x, y) ? 1 : 0

      // Area outside the label itself is under the head but has no paper: tint it
      // so a misplaced or overflowing design is obvious.
      const outsideLabel = x >= labelWidthDots
      const paper = outsideLabel ? 226 : 255
      const value = Math.round(paper * (1 - ink))

      data[i] = value
      data[i + 1] = value
      data[i + 2] = outsideLabel ? Math.round(value * 0.94 + 10) : value
      data[i + 3] = 255
    }
  }
  return { width: w, height: h, data }
}

/**
 * Ink coverage per dot in [0, 1] after simulated thermal bleed: a dot's own heat
 * plus a fraction of its neighbours', weighted more horizontally than vertically
 * because the head fires a whole row at once.
 */
function thermalCoverage(bm: PackedBitmap): Float32Array {
  const { widthDots: w, heightDots: h } = bm
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const self = getDot(bm, x, y) ? 1 : 0
      const horizontal = (getDot(bm, x - 1, y) ? 1 : 0) + (getDot(bm, x + 1, y) ? 1 : 0)
      const vertical = (getDot(bm, x, y - 1) ? 1 : 0) + (getDot(bm, x, y + 1) ? 1 : 0)
      out[y * w + x] = Math.min(1, self * 0.86 + horizontal * 0.17 + vertical * 0.1)
    }
  }
  return out
}
