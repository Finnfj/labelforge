import { describe, expect, it } from 'vitest'
import { createPackedBitmap, setDot } from '../../model/bitmap'
import { encodeDymoRaster } from './raster'

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ')

describe('encodeDymoRaster', () => {
  it('doubles every column, per the vendor app’s 2x stretch', () => {
    const bm = createPackedBitmap(1, 3)
    const { width, data } = encodeDymoRaster(bm)
    expect(width).toBe(6)
    expect(data.length).toBe(6 * 4)
  })

  it('packs dot 0 of a row into the second-from-top addressable bit', () => {
    // Per docs/DYMO_PROTOCOL.md: the printer expects the first pixel starting
    // from the second bit, not the first — dot 0 -> yy = 1 -> byte 3, bit 0x40.
    const bm = createPackedBitmap(1, 1)
    setDot(bm, 0, 0, true)
    const { data } = encodeDymoRaster(bm)
    expect(hex(data.subarray(0, 4))).toBe('00 00 00 40')
    // Stretched: the second copy of the same column is identical.
    expect(hex(data.subarray(4, 8))).toBe('00 00 00 40')
  })

  it('packs the last printable dot into the opposite end of the column', () => {
    // dot 29 (the 30th and last printable) -> yy = 30 -> byte 0, bit 0x02.
    const bm = createPackedBitmap(30, 1)
    setDot(bm, 29, 0, true)
    const { data } = encodeDymoRaster(bm)
    expect(hex(data.subarray(0, 4))).toBe('02 00 00 00')
  })

  it('sends the last row first, so the tape is the design turned clockwise, not mirrored', () => {
    // Row 0 sent first would be a transpose — a mirror image. The first real print
    // came out exactly that way.
    const bm = createPackedBitmap(1, 2)
    setDot(bm, 0, 0, true) // only the top row is inked
    const { data } = encodeDymoRaster(bm)
    expect(hex(data.subarray(0, 8))).toBe('00 00 00 00 00 00 00 00') // last row, x2
    expect(hex(data.subarray(8, 16))).toBe('00 00 00 40 00 00 00 40') // first row, x2
  })

  it('leaves an all-white row as four zero bytes', () => {
    const bm = createPackedBitmap(30, 1)
    const { data } = encodeDymoRaster(bm)
    expect(hex(data)).toBe('00 00 00 00 00 00 00 00')
  })

  it('ignores dots beyond the printable height rather than wrapping into another column', () => {
    const bm = createPackedBitmap(32, 1)
    setDot(bm, 31, 0, true) // off the printable area entirely
    const { data } = encodeDymoRaster(bm)
    expect(hex(data)).toBe('00 00 00 00 00 00 00 00')
  })
})
