import { createPackedBitmap, type PackedBitmap } from '../../model/bitmap'
import type { PaperTypeValue } from './constants'
import { encodeImage } from './encodeImage'
import { printJobFraming, printJobStream } from './commands'

/**
 * A print job built to find out whether a command does anything.
 *
 * Most of this protocol has resisted investigation for one reason: a command sent
 * on its own is acknowledged and ignored, and only acts inside a job with a raster
 * in front of it. The gap seek took four rounds of inference and an HCI capture to
 * find for exactly that reason — it had been in the command table the whole time
 * and every test of it had been in the wrong position.
 *
 * The raw-hex box in Diagnostics sends bytes bare, so it cannot test anything that
 * needs that position, and the in-job toggle beside it wraps bytes with no raster,
 * which the panel's own note records as insufficient. This closes the gap: a real
 * job, a blank raster of a chosen height, then the bytes under test, then
 * `stopPrintJob`.
 *
 * Deliberately spare, so that anything the paper does is attributable:
 *
 * - **No `alignPaperStart`.** It retracts about twenty millimetres, which is the
 *   largest paper movement in the protocol and would drown out whatever is being
 *   measured. Bands of a split label omit it and print correctly, so a job does
 *   not need it.
 * - **No gap seek**, for the same reason — it is the other thing that moves paper.
 * - **No `alignPaperEnd`.** The paper is left exactly where the probe left it,
 *   which is the whole point; advancing to the tear-off position afterwards would
 *   hide the result.
 *
 * What remains that moves paper is the blank raster, forward by exactly its own
 * height, and the bytes under test. Feed a few millimetres so there is a reference
 * to measure against, then read off what the command did.
 *
 * ## Position matters, and not the same way for everything
 *
 * `position` decides whether the bytes go before the raster or after it, and that is
 * not a detail. The gap seek acts **only** after a raster — inert anywhere else,
 * which is why it took four rounds and a capture to find. `alignPaperStart` is the
 * opposite: it retracts before a raster and four of them after one moved nothing.
 *
 * So a command that does nothing in one position has not been ruled out. It has been
 * ruled out in that position, and both sides are worth the paper.
 *
 * ## What it has settled so far
 *
 * - **`adjustPosition` is not implemented.** All four `AdjustMode` values were probed
 *   on both sides of the raster; every one was acknowledged and moved nothing.
 * - **`alignPaperStart` retracts on its own**, in a job with nothing else in it that
 *   moves paper — which is what makes the earlier attribution of a full print's
 *   movement to one command in it a mistake rather than a guess.
 * - **It stacks twice.** Two moved paper; a third left the label stale against the
 *   roll. So it is a relative move rather than an align, and about forty millimetres
 *   is the whole rewind this printer has.
 */
export type ProbePosition = 'before' | 'after'

export function probeJob(options: {
  paperType: PaperTypeValue
  density: number
  /** Blank rows printed before the probe, so any movement has a reference. */
  feedDots: number
  widthDots: number
  /** The bytes under test. */
  probe: Uint8Array
  /**
   * Which side of the raster to put them on. Defaults to after, where the gap seek
   * acts; motion commands look as though they want the other side.
   */
  position?: ProbePosition
}): Uint8Array {
  const framing = printJobFraming({
    paperType: options.paperType,
    density: options.density,
    seekGap: false,
    alignStart: false,
  })
  const probe = { bytes: options.probe, note: 'probe' }
  const placed: typeof framing =
    options.position === 'before'
      ? { ...framing, preamble: [...framing.preamble, probe] }
      : { ...framing, trailer: [probe, ...framing.trailer] }
  return printJobStream(placed, encodeImage(blank(options.widthDots, options.feedDots)))
}

function blank(widthDots: number, rows: number): PackedBitmap {
  return createPackedBitmap(Math.max(8, widthDots), Math.max(1, Math.round(rows)))
}
