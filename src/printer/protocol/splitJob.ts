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

/** Fraction of the limit a band is allowed to reach, so a re-encode has room. */
const HEADROOM = 0.85

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
  const rowsPerBand = Math.max(1, Math.floor(budget / Math.max(bytesPerRow, 1)))

  const bands: PackedBitmap[] = []
  for (let row = 0; row < bitmap.heightDots; row += rowsPerBand) {
    const rows = Math.min(rowsPerBand, bitmap.heightDots - row)
    bands.push(...fitBand(sliceRows(bitmap, row, rows), budget))
  }
  return bands
}

/**
 * Halve a band until it fits, or until it is a single row.
 *
 * A single row over budget cannot be split further and is returned anyway: one
 * band that will not seek is a better outcome than refusing to print. It cannot
 * happen at any width this printer supports — a row is at most 72 bytes — but the
 * recursion needs a floor.
 */
function fitBand(band: PackedBitmap, budget: number): PackedBitmap[] {
  if (band.heightDots <= 1 || encodeImage(band).length <= budget) return [band]
  const half = Math.floor(band.heightDots / 2)
  return [
    ...fitBand(sliceRows(band, 0, half), budget),
    ...fitBand(sliceRows(band, half, band.heightDots - half), budget),
  ]
}
