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
 * the label itself is the remaining move, and it is a different experiment for two
 * reasons, either of which would be enough:
 *
 * - **The seek is in the buffer before the raster ends.** The slices go out
 *   back-to-back with no wait, so by the time the printer finishes the second-last
 *   band it has already read the last band and the seek behind it. The follow-up
 *   job could never manage that, because it is sent only once `4F 4B` says the
 *   printer has stopped — and a printer that has stopped is in a different state
 *   from one still working.
 * - **Nothing resets between the bands.** Only the first slice retracts, none but
 *   the last seeks, and the tear-off advance happens once at the end. If the
 *   printer counts how far it has printed within the current label — the reading
 *   that best fits the follow-up's behaviour — an unbroken run of bands is its
 *   best chance of counting the whole label.
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
