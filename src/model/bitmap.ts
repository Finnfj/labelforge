/**
 * The single contract between the rendering half of the app and the printer half.
 *
 * `render/` produces one of these; `printer/` consumes it. Neither imports the
 * other, which is what keeps the whole editor testable with no Bluetooth in sight.
 */
export interface PackedBitmap {
  /** Width in dots. Not necessarily a multiple of 8. */
  readonly widthDots: number
  /** Height in dots (rows). */
  readonly heightDots: number
  /** Bytes per row: `ceil(widthDots / 8)`. Rows are byte-aligned. */
  readonly rowBytes: number
  /** `rowBytes * heightDots` bytes, MSB-first within each byte, a set bit is black. */
  readonly data: Uint8Array
}

/** Bytes needed per row for a given dot width. */
export function rowBytesFor(widthDots: number): number {
  return (widthDots + 7) >> 3
}

/** An all-white bitmap of the given size. */
export function createPackedBitmap(widthDots: number, heightDots: number): PackedBitmap {
  const rowBytes = rowBytesFor(widthDots)
  return { widthDots, heightDots, rowBytes, data: new Uint8Array(rowBytes * heightDots) }
}

/** True if the dot at (x, y) is black. Out-of-bounds reads as white. */
export function getDot(bm: PackedBitmap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= bm.widthDots || y >= bm.heightDots) return false
  return (bm.data[y * bm.rowBytes + (x >> 3)] & (128 >> (x & 7))) !== 0
}

/** Set or clear the dot at (x, y). Out-of-bounds writes are ignored. */
export function setDot(bm: PackedBitmap, x: number, y: number, black: boolean): void {
  if (x < 0 || y < 0 || x >= bm.widthDots || y >= bm.heightDots) return
  const i = y * bm.rowBytes + (x >> 3)
  const mask = 128 >> (x & 7)
  if (black) bm.data[i] |= mask
  else bm.data[i] &= ~mask
}
