/**
 * Builds the GATT writes for one DYMO LetraTag print job.
 *
 * Every byte sequence here is documented in docs/DYMO_PROTOCOL.md, cross-checked
 * against github.com/ysfchn/dymo-bluetooth (see docs/THIRD_PARTY.md). Two open
 * points are called out where they're used: an undocumented directive the real
 * vendor app sends that isn't required, and a `bits per pixel` byte that differs
 * from that project's own value.
 */
import type { PackedBitmap } from '../../model/bitmap'
import { encodeDymoRaster } from './raster'
import {
  buildHeader,
  CHUNK_SIZE,
  Directive,
  END_DIRECTIVE,
  FORM_FEED_DIRECTIVE,
  MAGIC,
  PRINT_DATA_ALIGN,
  PRINT_DATA_BPP,
  PRINT_DATA_HEIGHT_DOTS,
  START_DIRECTIVE,
  STATUS_DIRECTIVE,
  UNDOCUMENTED_DIRECTIVE,
} from './constants'

const ESC = 0x1b

/**
 * `ESC D` + bpp + align + width + height + image data. `width` is the raster's
 * column count (already includes the 2x stretch; see `encodeDymoRaster`), `height`
 * is always the fixed addressable height, not the printable one.
 */
function buildPrintData(bitmap: PackedBitmap): Uint8Array {
  const { width, data } = encodeDymoRaster(bitmap)
  const out = new Uint8Array(2 + 1 + 1 + 4 + 4 + data.length)
  const view = new DataView(out.buffer)
  out[0] = ESC
  out[1] = Directive.PrintData
  out[2] = PRINT_DATA_BPP
  out[3] = PRINT_DATA_ALIGN
  view.setUint32(4, width, true)
  view.setUint32(8, PRINT_DATA_HEIGHT_DOTS, true)
  out.set(data, 12)
  return out
}

/**
 * The full directive stream for a print job: `START`, the undocumented directive
 * the real app always sends, `PRINT_DATA`, `FORM_FEED`, `STATUS`, `END`.
 */
function buildPrintPayload(bitmap: PackedBitmap): Uint8Array {
  const printData = buildPrintData(bitmap)
  const out = new Uint8Array(
    START_DIRECTIVE.length +
      UNDOCUMENTED_DIRECTIVE.length +
      printData.length +
      FORM_FEED_DIRECTIVE.length +
      STATUS_DIRECTIVE.length +
      END_DIRECTIVE.length,
  )
  let o = 0
  out.set(START_DIRECTIVE, o)
  o += START_DIRECTIVE.length
  out.set(UNDOCUMENTED_DIRECTIVE, o)
  o += UNDOCUMENTED_DIRECTIVE.length
  out.set(printData, o)
  o += printData.length
  out.set(FORM_FEED_DIRECTIVE, o)
  o += FORM_FEED_DIRECTIVE.length
  out.set(STATUS_DIRECTIVE, o)
  o += STATUS_DIRECTIVE.length
  out.set(END_DIRECTIVE, o)
  return out
}

/**
 * Splits the payload into application-level chunks, each its own GATT write: a
 * 1-byte sequence index (skipping the value `27`, a vendor-app quirk reproduced as-is
 * — see docs/DYMO_PROTOCOL.md) followed by up to `CHUNK_SIZE` bytes of payload, with
 * the magic value appended to the last chunk.
 */
function chunkPayload(payload: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = []
  for (let offset = 0, index = 0; offset < payload.length; offset += CHUNK_SIZE, index++) {
    const slice = payload.subarray(offset, Math.min(offset + CHUNK_SIZE, payload.length))
    const isLast = offset + CHUNK_SIZE >= payload.length
    // The real app's chunk numbering skips the value 27 outright — confirmed by
    // ysfchn/dymo-bluetooth, reason unknown, reproduced rather than second-guessed.
    const sequenceIndex = index >= 27 ? index + 1 : index
    const chunk = new Uint8Array(1 + slice.length + (isLast ? MAGIC.length : 0))
    chunk[0] = sequenceIndex
    chunk.set(slice, 1)
    if (isLast) chunk.set(MAGIC, 1 + slice.length)
    chunks.push(chunk)
  }
  return chunks
}

/**
 * Every GATT write for one print job, in order: the 9-byte header first, then each
 * payload chunk. `transport.write()` is called once per element — this function
 * owns the chunking because the chunk framing (the index byte, the trailing magic)
 * is part of the wire protocol, not a transport-level size limit.
 */
export function buildPrintJob(bitmap: PackedBitmap): Uint8Array[] {
  const payload = buildPrintPayload(bitmap)
  return [buildHeader(payload.length), ...chunkPayload(payload)]
}
