/**
 * A bitmap in the LetraTag's raster format.
 *
 * See docs/DYMO_PROTOCOL.md, "Raster encoding", for the evidence behind this.
 *
 * LabelForge's bitmap runs `widthDots` across the head and `heightDots` along the
 * feed, one row per scanline. The LetraTag prints one `PRINT_DATA` column per
 * scanline, so each row becomes one column.
 *
 * **The order the rows go out in is not free.** On the tape, the first column sent is
 * the left end as you read it, and bit 0 of a column is the top (ysfchn/dymo-bluetooth,
 * whose example prints correctly on hardware). Sending row 0 first with dot 0 at the
 * top is a transpose of the design — a mirror image however the tape is held, which is
 * what the first print from this encoder showed. Sending the last row first instead is
 * a quarter turn clockwise, the same turn the editor's "Horizontal" view applies (see
 * `EditorCanvas.tsx`), so the tape reads like that view.
 */
import { getDot, type PackedBitmap } from '../../../model/bitmap'
import { LETRATAG_HEAD_WIDTH_DOTS } from '../../../model/units'
import { RASTER_STRETCH_FACTOR } from './constants'

/** Bytes per column: 32 addressable dots, of which {@link LETRATAG_HEAD_WIDTH_DOTS} print. */
const BYTES_PER_COLUMN = 4

export interface LetraTagRaster {
  /** The `PRINT_DATA` width argument: the number of columns, after stretching. */
  width: number
  /** `4 * width` bytes, one column after another. */
  data: Uint8Array
}

/**
 * Packs one row into one column.
 *
 * Dot x goes to bit x + 1 counted from the most significant bit of the column's last
 * byte, then on through the bytes before it: dot 0 is `0x40` of byte 3, dot 29 is
 * `0x02` of byte 0. That is the layout of ysfchn/dymo-bluetooth, whose example prints
 * correctly on hardware, and of the contributor's first print. Nobody has yet printed
 * a known pattern to check it bit by bit — see docs/DYMO_PROTOCOL.md, "Open questions".
 */
function packColumn(bitmap: PackedBitmap, row: number): Uint8Array {
  const column = new Uint8Array(BYTES_PER_COLUMN)
  const dots = Math.min(bitmap.widthDots, LETRATAG_HEAD_WIDTH_DOTS)
  for (let x = 0; x < dots; x++) {
    if (!getDot(bitmap, x, row)) continue
    const bit = x + 1
    const byteIndex = BYTES_PER_COLUMN - 1 - Math.floor(bit / 8)
    column[byteIndex] |= 1 << (7 - (bit % 8))
  }
  return column
}

/**
 * Encodes a bitmap for `PRINT_DATA`, every column {@link RASTER_STRETCH_FACTOR} times,
 * as the vendor app does. Dots beyond {@link LETRATAG_HEAD_WIDTH_DOTS} are off the head and
 * dropped, as the printer itself would drop them.
 */
export function encodeLetraTagRaster(bitmap: PackedBitmap): LetraTagRaster {
  const width = bitmap.heightDots * RASTER_STRETCH_FACTOR
  const data = new Uint8Array(width * BYTES_PER_COLUMN)
  for (let i = 0; i < bitmap.heightDots; i++) {
    // Last row first — see the module comment.
    const column = packColumn(bitmap, bitmap.heightDots - 1 - i)
    for (let s = 0; s < RASTER_STRETCH_FACTOR; s++) {
      data.set(column, (i * RASTER_STRETCH_FACTOR + s) * BYTES_PER_COLUMN)
    }
  }
  return { width, data }
}
