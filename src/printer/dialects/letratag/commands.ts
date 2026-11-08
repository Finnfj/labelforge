import type { PackedBitmap } from '../../../model/bitmap'
import type { JobPart } from '../../dialect'
import {
  END_DIRECTIVE,
  ESC_HASH_DIRECTIVE,
  FORM_FEED_DIRECTIVE,
  PRINT_DATA,
  PRINT_DATA_ALIGN,
  PRINT_DATA_BPP,
  PRINT_DATA_HEIGHT_DOTS,
  START_DIRECTIVE,
  STATUS_DIRECTIVE,
} from './constants'
import { encodeLetraTagRaster } from './raster'

/**
 * The directive stream of one LetraTag job, as the vendor app sends it: `START`,
 * `ESC #`, `PRINT_DATA` with its raster, `FORM_FEED`, `STATUS`, `END`.
 *
 * The header before it and the chunk framing around it are the link's (see `link.ts`),
 * because they frame the stream as it goes over the air, not what the printer parses.
 */
export function labelJobParts(bitmap: PackedBitmap): JobPart[] {
  const raster = encodeLetraTagRaster(bitmap)
  return [
    { kind: 'command', bytes: START_DIRECTIVE, note: 'start' },
    { kind: 'command', bytes: ESC_HASH_DIRECTIVE, note: 'escHash' },
    { kind: 'command', bytes: printDataHeader(raster.width), note: 'printData' },
    { kind: 'raster', bytes: raster.data },
    { kind: 'command', bytes: FORM_FEED_DIRECTIVE, note: 'formFeed' },
    { kind: 'command', bytes: STATUS_DIRECTIVE, note: 'status' },
    { kind: 'command', bytes: END_DIRECTIVE, note: 'end' },
  ]
}

/**
 * `ESC D`, bits per pixel, alignment, then width and height as little-endian u32s.
 * `width` counts the stretched columns; `height` is always the addressable 32 dots.
 */
function printDataHeader(width: number): Uint8Array {
  const header = new Uint8Array(12)
  const view = new DataView(header.buffer)
  header[0] = 0x1b
  header[1] = PRINT_DATA
  header[2] = PRINT_DATA_BPP
  header[3] = PRINT_DATA_ALIGN
  view.setUint32(4, width, true)
  view.setUint32(8, PRINT_DATA_HEIGHT_DOTS, true)
  return header
}
