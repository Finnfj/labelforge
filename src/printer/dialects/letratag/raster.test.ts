import { describe, expect, it } from 'vitest'
import { createPackedBitmap, setDot } from '../../../model/bitmap'
import { encodeLetraTagRaster } from './raster'

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ')

describe('LetraTag raster', () => {
  it("doubles every column, as the vendor app's stretch does", () => {
    const { width, data } = encodeLetraTagRaster(createPackedBitmap(1, 3))
    expect(width).toBe(6)
    expect(data.length).toBe(6 * 4)
  })

  it('packs dot 0 of a row one bit in from the end of its column', () => {
    // The layout ysfchn/dymo-bluetooth prints with: dot 0 -> byte 3, bit 0x40.
    const bm = createPackedBitmap(1, 1)
    setDot(bm, 0, 0, true)
    expect(hex(encodeLetraTagRaster(bm).data)).toBe('00 00 00 40 00 00 00 40')
  })

  it('packs the last printable dot at the opposite end of the column', () => {
    // Dot 29, the 30th and last that prints -> byte 0, bit 0x02.
    const bm = createPackedBitmap(30, 1)
    setDot(bm, 29, 0, true)
    expect(hex(encodeLetraTagRaster(bm).data.subarray(0, 4))).toBe('02 00 00 00')
  })

  it('sends the last row first, so the tape is the design turned clockwise, not mirrored', () => {
    // Row 0 first would be a transpose: a mirror image. The first real print came out
    // exactly that way.
    const bm = createPackedBitmap(1, 2)
    setDot(bm, 0, 0, true)
    const { data } = encodeLetraTagRaster(bm)
    expect(hex(data.subarray(0, 8))).toBe('00 00 00 00 00 00 00 00')
    expect(hex(data.subarray(8, 16))).toBe('00 00 00 40 00 00 00 40')
  })

  it('drops dots beyond the head rather than wrapping them into another column', () => {
    const bm = createPackedBitmap(32, 1)
    setDot(bm, 31, 0, true)
    expect(hex(encodeLetraTagRaster(bm).data)).toBe('00 00 00 00 00 00 00 00')
  })
})
