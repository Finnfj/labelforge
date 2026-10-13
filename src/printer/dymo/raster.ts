/**
 * Converts a {@link PackedBitmap} into the DYMO LetraTag's raster format.
 *
 * See docs/DYMO_PROTOCOL.md, "Raster encoding", for the evidence behind this.
 *
 * LabelForge's bitmap convention (shared with the MarkLife encoder) is: `widthDots`
 * is the fixed, across-the-head dimension; `heightDots` is the variable, along-the-feed
 * dimension; one *row* is one scanline. The LetraTag prints one `PRINT_DATA` "column"
 * per scanline, so each row becomes one column.
 *
 * **The order the rows go out in is not free.** On the tape, the first column sent is
 * the left end as you read it, and bit 0 of a column is the top (confirmed by the
 * ysfchn/dymo-bluetooth example printing correctly on real hardware). Sending row 0
 * first with dot 0 at the top is a *transpose* of the design — a mirror image however
 * the tape is held, which is exactly what the first real print showed. Sending the
 * last row first instead is a quarter turn clockwise, the same turn the editor's
 * "Horizontal" view applies (see `EditorCanvas.tsx`), so the tape reads like that view.
 */
import { getDot, type PackedBitmap } from '../../model/bitmap'
import { PRINTABLE_HEIGHT_DOTS, RASTER_STRETCH_FACTOR } from './constants'

/** Bytes per column: 32 addressable dots, only {@link PRINTABLE_HEIGHT_DOTS} of them print. */
const BYTES_PER_COLUMN = 4

export interface DymoRaster {
  /** The `PRINT_DATA` width argument — the number of columns, after stretching. */
  width: number
  /** `4 * width` bytes, one column after another. */
  data: Uint8Array
}

/**
 * Packs one LabelForge row into one Dymo column.
 *
 * Confirmed bit layout (ysfchn/dymo-bluetooth, corroborated by our own captures):
 * dot 0 of the row lands one bit in from the column's least-significant end, not at
 * it — the printer's own quirk, not an encoding choice here — which is also why dot
 * {@link PRINTABLE_HEIGHT_DOTS} (the 31st of 32 addressable bits) is never reachable
 * and the very first physical bit is never set either. Replicated exactly rather
 * than "fixed", since this is what real hardware has been shown to expect.
 */
function packColumn(bitmap: PackedBitmap, row: number): Uint8Array {
  const column = new Uint8Array(BYTES_PER_COLUMN)
  const dots = Math.min(bitmap.widthDots, PRINTABLE_HEIGHT_DOTS)
  for (let x = 0; x < dots; x++) {
    if (!getDot(bitmap, x, row)) continue
    const yy = x + 1
    const byteIndex = BYTES_PER_COLUMN - 1 - Math.floor(yy / 8)
    column[byteIndex] |= 1 << (7 - (yy % 8))
  }
  return column
}

/**
 * Encodes a bitmap for `PRINT_DATA`, including the 2x horizontal stretch the vendor
 * app always applies (see docs/DYMO_PROTOCOL.md, "Raster encoding") — every column
 * is emitted {@link RASTER_STRETCH_FACTOR} times in a row. `bitmap.widthDots` must
 * be at most {@link PRINTABLE_HEIGHT_DOTS}; anything beyond that dot is off the
 * printable area and silently dropped, the same way the printer itself drops it.
 */
export function encodeDymoRaster(bitmap: PackedBitmap): DymoRaster {
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
