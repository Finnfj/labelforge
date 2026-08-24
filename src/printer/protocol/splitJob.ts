import { sliceRows, type PackedBitmap } from '../../model/bitmap'
import { encodeImage } from './encodeImage'
import { SEEK_SAFE_JOB_BYTES } from './constants'

/**
 * Printing one label as several jobs, so that the last of them can seek.
 *
 * The printer honours a job's gap seek only when it read the job in full before
 * the motor started. Above `SEEK_SAFE_JOB_BYTES` it did not, and the seek at the
 * end of a tall label goes unread — which is the whole reason tall labels do not
 * register themselves.
 *
 * Sending the seek afterwards in a job of its own does not work: it behaves as a
 * form feed and takes a blank label, from every starting position tried. Splitting
 * the label itself is the remaining move — the only one that costs nothing in the
 * picture, since every other route trades image quality for compressed size.
 *
 * **The bands must be sent one at a time, each waiting for the last to be
 * acknowledged.** Back-to-back was the first attempt, on the theory that the final
 * band's seek would then be in the buffer before the head reached it. The printer
 * accepted the first band, printed it, answered `4F 4B` once and dropped the other
 * two: a 640-row label came out 223 rows tall. It will not take a new job while it
 * is working on one, so there is no way to get a second job into its buffer, and
 * that theory is dead.
 *
 * What is left is the other reason splitting might work: nothing resets between the
 * bands. Only the first retracts, none but the last seeks, the tear-off advance
 * happens once at the end. If the printer counts how far it has printed within the
 * current label — the reading that best fits the follow-up behaving as a form feed —
 * then the last band having printed real rows rather than a millimetre of blank is
 * the closest a separate job can get to the geometry that works.
 *
 * The risk is a visible seam at each boundary if the printer stops the head
 * between jobs. That is why this plans the fewest bands it can rather than a fixed
 * size, and why it is opt-in.
 */

/**
 * The gap the printer leaves at the start of a job, in dots.
 *
 * Measured on a P50S: a split label registered correctly and came out with a seam
 * at each boundary of **exactly one millimetre**, which is eight dots at 8 dots/mm.
 * The printer takes up that much before it starts laying down a raster, so every
 * band after the first would begin one millimetre further on than the last ended.
 *
 * **Filled by overlapping the bands, not by a motion command.** Winding back eight
 * dots with `1F 11 10` was the obvious correction and the printer ignored it — the
 * bytes went out in bands two and three, all three jobs were acknowledged, and the
 * seam was unchanged. Forty dots of the same command had moved paper visibly in an
 * earlier experiment, so there is a minimum step somewhere between the two and
 * eight dots is under it.
 *
 * Overlapping needs no command at all: band two simply starts eight rows before
 * band one ended, and those rows land in the millimetre the printer inserts. Pure
 * arithmetic against a measurement, which is a better thing to depend on than an
 * undocumented motion primitive.
 */
export const SPLIT_SEAM_DOTS = 8

/** Fraction of the limit a band is allowed to reach, so a re-encode has room. */
const HEADROOM = 0.85

/**
 * Shortest band worth sending.
 *
 * Has to exceed the overlap, or a band would be nothing but the rows the band
 * before it already printed and the plan would never reach the end of the label.
 */
const MIN_BAND_ROWS = SPLIT_SEAM_DOTS * 2

/**
 * Cut a raster into the fewest bands that each fit within the seek limit.
 *
 * Fewest, because every boundary is a place the head stops while the driver waits
 * for the acknowledgement, and a stopped head is where a seam would show.
 *
 * Compressed size is not linear in rows — a band of dense image compresses worse
 * than the average — so this estimates from the whole raster, then verifies each
 * band and halves any that came out over. Returns a single-element array when the
 * raster already fits, so a caller can treat splitting as the general case.
 */
export function planSeekableBands(
  bitmap: PackedBitmap,
  limitBytes = SEEK_SAFE_JOB_BYTES,
): PackedBitmap[] {
  const budget = Math.max(1, Math.floor(limitBytes * HEADROOM))
  if (encodeImage(bitmap).length <= budget) return [bitmap]

  const bytesPerRow = encodeImage(bitmap).length / Math.max(1, bitmap.heightDots)
  const estimate = Math.max(MIN_BAND_ROWS, Math.floor(budget / Math.max(bytesPerRow, 1)))

  const bands: PackedBitmap[] = []
  let next = 0
  while (next < bitmap.heightDots) {
    // Every band but the first reaches back over the seam, so the rows the printer
    // would otherwise skip are printed by the band that follows it.
    const from = next === 0 ? 0 : next - SPLIT_SEAM_DOTS
    let rows = Math.min(bitmap.heightDots - from, estimate + (next === 0 ? 0 : SPLIT_SEAM_DOTS))
    let band = sliceRows(bitmap, from, rows)

    // Compressed size is not linear in rows — a band of dense image compresses
    // worse than the average — so the estimate can come out over. Halve until it
    // fits. The floor keeps the overlap from eating the whole band, which would
    // stop the loop making progress.
    while (rows > MIN_BAND_ROWS && encodeImage(band).length > budget) {
      rows = Math.max(MIN_BAND_ROWS, Math.floor(rows / 2))
      band = sliceRows(bitmap, from, rows)
    }

    bands.push(band)
    next = from + band.heightDots
  }
  return bands
}
