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
 * ## The seam, and why it cannot be closed
 *
 * The printer takes up {@link SPLIT_SEAM_DOTS} — measured at exactly 1 mm — at the
 * start of a job, before it lays down a raster. That millimetre of paper passes the
 * head with nothing fired at it, and no command can take it back:
 *
 * - **Winding back eight dots** was ignored.
 * - **Winding back forty** was also ignored. It had looked as though forty worked,
 *   from an earlier experiment where the paper visibly pulled back — but that job
 *   also carried `alignPaperStart`, which retracts about twenty millimetres and is
 *   a known paper-mover. The movement was that, not the wind-back. `adjustPosition`
 *   is inert like every other dedicated motion command on this firmware.
 * - **Overlapping the rasters** has the wrong sign. The advance happens without
 *   printing; repeating rows does not undo it, it prints them again after the gap
 *   and pushes everything below down by another millimetre.
 *
 * So the millimetre is spent. What is left is to choose what it costs and where it
 * falls.
 *
 * **What it costs:** the eight rows that land in it are skipped rather than printed
 * late. Printing them late shifts the whole remainder of the label down by a
 * millimetre per boundary, which grows with every band and moves the bottom of the
 * design off the label. Skipping keeps every other row exactly where it was
 * designed and gives up a millimetre of image.
 *
 * **Where it falls:** the cut is nudged to whichever row nearby loses the least
 * ink. A millimetre of white across a photograph shows; a millimetre across the
 * white space between two lines of text does not. This is the part that actually
 * helps, and it is pure arithmetic on the bitmap — no protocol involved.
 */

/**
 * What the printer takes up at the start of a job, in dots.
 *
 * Measured: a split label came out registered with a seam at the boundary of
 * exactly one millimetre, which is eight dots at 8 dots/mm. Confirmed twice more
 * by making it worse in known amounts.
 */
export const SPLIT_SEAM_DOTS = 8

/**
 * How far past the boundary a mid-label retract leaves the paper, in dots.
 *
 * **Measured, and it is the number that makes a seamless split possible.** With a
 * retract at the boundary and no rows skipped, a two-band 80 mm label came out
 * overlapping by exactly 7 mm — so the retract reaches 7 mm further back than the
 * take-up it was meant to undo. Net of the 8 dots the job takes up, `alignPaperStart`
 * winds back 64 dots mid-label: a fixed 8 mm, and nothing like the ~20 mm it moves
 * from the tear-off position.
 *
 * That settles what the command is. Twenty millimetres from the tear position, eight
 * from mid-label — it is neither a fixed offset nor an align to the label start. It
 * appears to wind back a fixed 8 mm from wherever it is, and the 20 mm reading was the
 * tear-off advance being undone by something else in that job.
 *
 * Whichever it is, the correction is exact: print this many blank rows before the
 * band's own first row. Blank rows advance the paper by precisely their count and fire
 * no dots, so they carry the head forward over ground the previous band already
 * printed, leaving its image untouched, and the band's first row lands exactly where
 * that band stopped. Nothing is lost and nothing is doubled.
 */
export const SEAM_RETRACT_OVERSHOOT_DOTS = 56

/**
 * Plan the jobs one label prints as, given how the boundary is being handled.
 *
 * The one place both drivers get their bands, because the boundary is two decisions
 * that have to agree — how many rows the cut gives up, and how many blank rows the
 * next band leads with. Split between callers they drifted; a millimetre of
 * disagreement is a visible step in the image.
 */
export function planBands(
  bitmap: PackedBitmap,
  options: { closeSeam?: boolean; limitBytes?: number } = {},
): PackedBitmap[] {
  const closeSeam = options.closeSeam === true
  const bands = planSeekableBands(
    bitmap,
    options.limitBytes ?? SEEK_SAFE_JOB_BYTES,
    closeSeam ? 0 : SPLIT_SEAM_DOTS,
  )
  if (!closeSeam) return bands
  // The first band has a tear-off advance behind it rather than a boundary, and its
  // retract undoes that instead — so it starts where it always did.
  return bands.map((band, i) =>
    i === 0 ? band : prependBlankRows(band, SEAM_RETRACT_OVERSHOOT_DOTS),
  )
}

/**
 * How far the cut may be moved to find a whiter row, in dots.
 *
 * Five millimetres, and only ever earlier than the estimate — moving a cut earlier
 * shrinks the band, so it cannot push one back over the size limit. Most labels
 * have a millimetre of white somewhere in five, and on those the seam disappears
 * into it.
 */
const SEAM_SEARCH_DOTS = 40

/** Fraction of the limit a band is allowed to reach, so a re-encode has room. */
const HEADROOM = 0.85

/** Shortest band worth sending, so the plan always reaches the end of the label. */
const MIN_BAND_ROWS = SPLIT_SEAM_DOTS * 4

/**
 * Cut a raster into the fewest bands that each fit within the seek limit.
 *
 * Fewest, because every boundary costs a millimetre of image and a place a line
 * could show. Returns a single band when the raster already fits, so a caller can
 * treat splitting as the general case.
 */
export function planSeekableBands(
  bitmap: PackedBitmap,
  limitBytes = SEEK_SAFE_JOB_BYTES,
  /**
   * Rows given up at each boundary. {@link SPLIT_SEAM_DOTS} when the take-up is spent,
   * zero when the caller is winding it back with `alignPaperStart` instead — see
   * `PrintSettings.closeSplitSeam`. The two have to agree, or the label is offset by a
   * millimetre per boundary in whichever direction they disagree.
   */
  seamDots = SPLIT_SEAM_DOTS,
): PackedBitmap[] {
  const budget = Math.max(1, Math.floor(limitBytes * HEADROOM))
  if (encodeImage(bitmap).length <= budget) return [bitmap]

  const bytesPerRow = encodeImage(bitmap).length / Math.max(1, bitmap.heightDots)
  const estimate = Math.max(MIN_BAND_ROWS, Math.floor(budget / Math.max(bytesPerRow, 1)))

  const bands: PackedBitmap[] = []
  let from = 0
  while (from < bitmap.heightDots) {
    const remaining = bitmap.heightDots - from
    if (remaining <= estimate) {
      bands.push(sliceRows(bitmap, from, remaining))
      break
    }

    let rows = quietestCut(bitmap, from, Math.min(remaining, estimate), seamDots)
    let band = sliceRows(bitmap, from, rows)
    // Compressed size is not linear in rows — dense image compresses worse than
    // the average — so the estimate can come out over. Halve until it fits, with a
    // floor so the loop always advances.
    while (rows > MIN_BAND_ROWS && encodeImage(band).length > budget) {
      rows = Math.max(MIN_BAND_ROWS, Math.floor(rows / 2))
      band = sliceRows(bitmap, from, rows)
    }

    bands.push(band)
    // Skip the rows that will be lost to the printer's take-up, rather than printing
    // them late and shifting the rest of the label down. With a retract at the
    // boundary there is nothing to lose and `seamDots` is zero, so the bands meet.
    from += rows + seamDots
  }
  return bands
}

/**
 * Move the cut earlier to whichever row loses the least ink to the seam.
 *
 * Scores each candidate by the dots set in the {@link SPLIT_SEAM_DOTS} rows that
 * would be skipped, and takes the lowest — ties going to the latest row, so a band
 * stays as large as it can and the label needs as few boundaries as possible. A
 * fully inked design scores the same everywhere and gets the estimate back
 * unchanged.
 */
function quietestCut(bitmap: PackedBitmap, from: number, rows: number, seamDots: number): number {
  // Nothing is lost at a boundary that costs no rows, so every cut scores the same and
  // the estimate stands — which keeps the bands as large as they can be.
  if (seamDots <= 0) return rows
  const earliest = Math.max(MIN_BAND_ROWS, rows - SEAM_SEARCH_DOTS)
  let best = rows
  let bestInk = Infinity
  for (let candidate = rows; candidate >= earliest; candidate--) {
    const ink = inkInRows(bitmap, from + candidate, seamDots)
    if (ink < bestInk) {
      bestInk = ink
      best = candidate
      if (ink === 0) break
    }
  }
  return best
}

/** Dots set in a run of rows. */
function inkInRows(bitmap: PackedBitmap, from: number, count: number): number {
  const start = Math.max(0, Math.min(bitmap.heightDots, from)) * bitmap.rowBytes
  const end = Math.max(0, Math.min(bitmap.heightDots, from + count)) * bitmap.rowBytes
  let ink = 0
  for (let i = start; i < end; i++) {
    let byte = bitmap.data[i]
    while (byte) {
      ink += byte & 1
      byte >>= 1
    }
  }
  return ink
}
