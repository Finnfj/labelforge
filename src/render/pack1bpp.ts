import { createPackedBitmap, rowBytesFor, type PackedBitmap } from '../model/bitmap'

/**
 * Pack a one-byte-per-dot mask (1 = black) into the printer's 1bpp layout:
 * row-major, rows padded out to a whole byte, MSB first within each byte.
 */
export function pack1bpp(bits: Uint8Array, widthDots: number, heightDots: number): PackedBitmap {
  const rowBytes = rowBytesFor(widthDots)
  const data = new Uint8Array(rowBytes * heightDots)
  for (let y = 0; y < heightDots; y++) {
    const src = y * widthDots
    const dst = y * rowBytes
    for (let x = 0; x < widthDots; x++) {
      if (bits[src + x]) data[dst + (x >> 3)] |= 128 >> (x & 7)
    }
  }
  return { widthDots, heightDots, rowBytes, data }
}

/** Inverse of {@link pack1bpp}. Used by the preview and by round-trip tests. */
export function unpack1bpp(bm: PackedBitmap): Uint8Array {
  const out = new Uint8Array(bm.widthDots * bm.heightDots)
  for (let y = 0; y < bm.heightDots; y++) {
    const src = y * bm.rowBytes
    const dst = y * bm.widthDots
    for (let x = 0; x < bm.widthDots; x++) {
      out[dst + x] = (bm.data[src + (x >> 3)] & (128 >> (x & 7))) !== 0 ? 1 : 0
    }
  }
  return out
}

export { createPackedBitmap }
