import { deflate } from 'pako'
import type { PackedBitmap } from '../../model/bitmap'

/**
 * zlib parameters the printer's firmware expects.
 *
 * These are not arbitrary. The vendor SDK's "proprietary" compressor is pako with
 * its identifiers renamed, configured exactly like this, and the printer will not
 * accept a stream produced with different settings. `windowBits: 10` in particular
 * is load-bearing — the zlib default of 15 yields different bytes, which is what
 * the golden fixtures guard against.
 *
 * Positive `windowBits` means a zlib-wrapped stream (2-byte header + Adler-32),
 * not raw deflate.
 */
const ZLIB_OPTIONS = { level: -1, windowBits: 10, memLevel: 8, strategy: 0 } as const

/** Fixed size of the raster command header, before the compressed payload. */
const HEADER_BYTES = 10

/**
 * Build the `1F 10` raster image command for a packed bitmap.
 *
 * ```
 * 1F 10 <rowBytesHi> <rowBytesLo> <heightHi> <heightLo> <payloadLen BE32> <zlib payload>
 * ```
 *
 * Note the third and fourth bytes carry **bytes per row, not dots**. Community
 * documentation of this protocol labels that field "width", which is misleading;
 * feeding it the dot width produces a garbled print.
 */
export function encodeImage(bitmap: PackedBitmap): Uint8Array {
  const payload = deflate(bitmap.data, ZLIB_OPTIONS)

  const out = new Uint8Array(HEADER_BYTES + payload.length)
  out[0] = 0x1f
  out[1] = 0x10
  out[2] = (bitmap.rowBytes >> 8) & 0xff
  out[3] = bitmap.rowBytes & 0xff
  out[4] = (bitmap.heightDots >> 8) & 0xff
  out[5] = bitmap.heightDots & 0xff
  out[6] = (payload.length >>> 24) & 0xff
  out[7] = (payload.length >>> 16) & 0xff
  out[8] = (payload.length >>> 8) & 0xff
  out[9] = payload.length & 0xff
  out.set(payload, HEADER_BYTES)
  return out
}
