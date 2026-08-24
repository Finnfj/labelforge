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

/**
 * Add blank rows below the image.
 *
 * This is how the inter-label gap gets fed. The printer stops exactly at the end
 * of the raster and no motion command works on it, so the only way to advance
 * into the gap is to make the raster taller — the head walks the extra rows and
 * fires nothing.
 *
 * It has to happen for every print, not once: a label pitch is height + gap, so
 * printing only the height leaves each label one gap further behind than the
 * last. That is a cumulative error, which is why the second print is slightly
 * off and the third is twice as bad.
 */
export function appendBlankRows(bm: PackedBitmap, rows: number): PackedBitmap {
  const extra = Math.max(0, Math.round(rows))
  if (extra === 0) return bm
  const heightDots = bm.heightDots + extra
  const data = new Uint8Array(bm.rowBytes * heightDots)
  data.set(bm.data, 0)
  return { widthDots: bm.widthDots, heightDots, rowBytes: bm.rowBytes, data }
}

/**
 * A horizontal band of the bitmap, sharing nothing with the original.
 *
 * Rows are byte-aligned and independent, so a band is a contiguous run of the
 * backing array and this is one copy. That is what makes splitting a raster across
 * several print jobs cheap — see `printer/protocol/splitJob.ts` for why anyone
 * would want to.
 */
export function sliceRows(bm: PackedBitmap, startRow: number, rows: number): PackedBitmap {
  const from = Math.max(0, Math.min(bm.heightDots, Math.round(startRow)))
  const count = Math.max(0, Math.min(bm.heightDots - from, Math.round(rows)))
  return {
    widthDots: bm.widthDots,
    heightDots: count,
    rowBytes: bm.rowBytes,
    data: bm.data.slice(from * bm.rowBytes, (from + count) * bm.rowBytes),
  }
}

/**
 * Add blank rows above the image.
 *
 * The counterpart to {@link appendBlankRows}, and it exists for the seam between
 * the bands of a split label: the head is deliberately wound back further than it
 * needs to be, and these rows carry it forward to exactly where the last band
 * stopped without firing a dot on the way. See `printer/protocol/splitJob.ts`.
 */
export function prependBlankRows(bm: PackedBitmap, rows: number): PackedBitmap {
  const extra = Math.max(0, Math.round(rows))
  if (extra === 0) return bm
  const heightDots = bm.heightDots + extra
  const data = new Uint8Array(bm.rowBytes * heightDots)
  data.set(bm.data, extra * bm.rowBytes)
  return { widthDots: bm.widthDots, heightDots, rowBytes: bm.rowBytes, data }
}

/** Set or clear the dot at (x, y). Out-of-bounds writes are ignored. */
export function setDot(bm: PackedBitmap, x: number, y: number, black: boolean): void {
  if (x < 0 || y < 0 || x >= bm.widthDots || y >= bm.heightDots) return
  const i = y * bm.rowBytes + (x >> 3)
  const mask = 128 >> (x & 7)
  if (black) bm.data[i] |= mask
  else bm.data[i] &= ~mask
}
