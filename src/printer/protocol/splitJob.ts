import { prependBlankRows, sliceRows, type PackedBitmap } from '../../model/bitmap'
import { encodeImage } from './encodeImage'
import { SEEK_SAFE_JOB_BYTES } from './constants'

/**
 * Printing one label as several jobs, so that the last of them can seek.
 *
 * The printer honours a job's gap seek only when it read the job in full before
 * the motor started. Above `SEEK_SAFE_JOB_BYTES` it did not, and the seek at the
 * end of a tall label goes unread — which is why tall labels do not register
 * themselves. Sending the seek afterwards in a job of its own does not help: it
 * behaves as a form feed and takes a blank label. Splitting the label is the only
 * route that costs nothing in the picture, and it works: the label prints whole,
 * registers, and wastes no paper.
 *
 * **The bands must go one at a time**, each waiting for the last to be
 * acknowledged. Back-to-back was tried and the printer accepted the first band,
 * printed it, answered `4F 4B` once and dropped the rest.
 *
 * ## The seam
 *
 * The printer takes up {@link SPLIT_SEAM_DOTS} — measured at exactly 1 mm — at the
 * start of a job, before it lays down a raster. So the next band begins a
 * millimetre past where the last one stopped, and the gap shows as a white line.
 *
 * Two corrections have been tried and both failed, in ways worth keeping:
 *
 * - **Winding back eight dots.** `1F 11 10 00 08` went out and the printer ignored
 *   it. Forty dots of the same command moves paper visibly, so the minimum step is
 *   somewhere between the two.
 * - **Overlapping the bands by eight rows.** This has the wrong sign, which the
 *   geometry says plainly and a print confirmed. The paper advances a millimetre
 *   *without printing*; repeating rows does not take that advance back, it just
 *   prints them again after the gap and pushes everything below down by another
 *   millimetre. The seam stayed exactly as it was.
 *
 * What removes the advance is removing the advance. The band winds back
 * {@link SPLIT_REWIND_DOTS}, which is far enough to be honoured, and then prints
 * {@link SPLIT_PAD_DOTS} of blank to come forward again — landing the first real
 * row exactly where the last band stopped. The blank rows pass back over paper that
 * is already printed and fire nothing, so they cost only their compressed size,
 * which for blank is nothing.
 *
 * The whole correction is one movement known to work plus arithmetic, rather than a
 * movement of the size we actually want, which the printer will not make.
 */

/**
 * What the printer takes up at the start of a job, in dots.
 *
 * Measured: a split label came out registered with a seam at the boundary of
 * exactly one millimetre, which is eight dots at 8 dots/mm.
 */
export const SPLIT_SEAM_DOTS = 8

/**
 * How far a band winds back before printing, in dots.
 *
 * Five millimetres. Eight dots is under the printer's minimum step and does
 * nothing; forty was seen to move paper during an earlier experiment, in the same
 * position in a job. The exact value does not matter as long as it is honoured and
 * {@link SPLIT_PAD_DOTS} matches it.
 */
export const SPLIT_REWIND_DOTS = 40

/**
 * Blank rows a band prints to come forward from the wind-back.
 *
 * The wind-back less the take-up: the paper ends up exactly where the previous band
 * stopped. If the take-up is not eight dots after all, this is the number to
 * adjust, and the error shows up directly — too small leaves white, too large
 * prints a millimetre twice and shows as a darker line.
 */
export const SPLIT_PAD_DOTS = SPLIT_REWIND_DOTS - SPLIT_SEAM_DOTS

/** Fraction of the limit a band is allowed to reach, so a re-encode has room. */
const HEADROOM = 0.85

/** Shortest band worth sending, so the plan always reaches the end of the label. */
const MIN_BAND_ROWS = 16

/** One job's worth of a label: the raster to send, and how far to wind back first. */
export interface SeekableBand {
  raster: PackedBitmap
  /** Zero for the first band, which has nothing before it to line up with. */
  rewindDots: number
}

/**
 * Cut a raster into the fewest bands that each fit within the seek limit.
 *
 * Fewest, because every boundary is a place the head stops while the driver waits
 * for an acknowledgement, and a stopped head is where a seam would show.
 *
 * Returns a single band when the raster already fits, so a caller can treat
 * splitting as the general case. The rewind and the blank padding are paired here
 * rather than left to the driver: they are two halves of one correction and half of
 * it is worse than neither.
 */
export function planSeekableBands(
  bitmap: PackedBitmap,
  limitBytes = SEEK_SAFE_JOB_BYTES,
): SeekableBand[] {
  const budget = Math.max(1, Math.floor(limitBytes * HEADROOM))
  if (encodeImage(bitmap).length <= budget) return [{ raster: bitmap, rewindDots: 0 }]

  const bytesPerRow = encodeImage(bitmap).length / Math.max(1, bitmap.heightDots)
  const estimate = Math.max(MIN_BAND_ROWS, Math.floor(budget / Math.max(bytesPerRow, 1)))

  const bands: SeekableBand[] = []
  let next = 0
  while (next < bitmap.heightDots) {
    const first = next === 0
    let rows = Math.min(bitmap.heightDots - next, estimate)
    let band = dress(sliceRows(bitmap, next, rows), first)

    // Compressed size is not linear in rows — a band of dense image compresses
    // worse than the average — so the estimate can come out over. Halve until it
    // fits, with a floor so the loop always advances.
    while (rows > MIN_BAND_ROWS && encodeImage(band.raster).length > budget) {
      rows = Math.max(MIN_BAND_ROWS, Math.floor(rows / 2))
      band = dress(sliceRows(bitmap, next, rows), first)
    }

    bands.push(band)
    next += rows
  }
  return bands
}

/** Give a band its wind-back and the blank rows that undo it. */
function dress(rows: PackedBitmap, first: boolean): SeekableBand {
  return first
    ? { raster: rows, rewindDots: 0 }
    : { raster: prependBlankRows(rows, SPLIT_PAD_DOTS), rewindDots: SPLIT_REWIND_DOTS }
}
