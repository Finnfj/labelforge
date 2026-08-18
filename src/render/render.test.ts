import { describe, expect, it } from 'vitest'
import { getDot } from '../model/bitmap'
import { mmToDots, dotsToMm } from '../model/units'
import { pack1bpp, unpack1bpp } from './pack1bpp'
import { padToHead, LabelTooWideError } from './padToHead'
import { threshold } from './threshold'
import { dither, floydSteinberg } from './dither'
import { composite } from './composite'
import { toLuminance, toAlphaMask } from './luminance'

const bitsFrom = (rows: string[]): { bits: Uint8Array; w: number; h: number } => {
  const w = rows[0].length
  const bits = new Uint8Array(w * rows.length)
  rows.forEach((row, y) => {
    for (let x = 0; x < w; x++) bits[y * w + x] = row[x] === '#' ? 1 : 0
  })
  return { bits, w, h: rows.length }
}

describe('units', () => {
  it('maps mm to dots at 8 dots/mm', () => {
    expect(mmToDots(1)).toBe(8)
    expect(mmToDots(10)).toBe(80)
    expect(mmToDots(48)).toBe(384)
    expect(dotsToMm(384)).toBe(48)
  })
})

describe('pack1bpp', () => {
  it('packs MSB-first with a set bit meaning black', () => {
    const { bits, w, h } = bitsFrom(['#.......'])
    expect(pack1bpp(bits, w, h).data[0]).toBe(0b1000_0000)
    expect(pack1bpp(bitsFrom(['.......#']).bits, 8, 1).data[0]).toBe(0b0000_0001)
  })

  it('pads each row to a whole byte and does not bleed into the next row', () => {
    // 9 dots wide -> 2 bytes per row. Only the first dot of row 1 is set.
    const bits = new Uint8Array(9 * 2)
    bits[9] = 1
    const bm = pack1bpp(bits, 9, 2)
    expect(bm.rowBytes).toBe(2)
    expect(Array.from(bm.data)).toEqual([0, 0, 0b1000_0000, 0])
  })

  it.each([383, 384, 385, 1, 7, 8, 9])('round-trips at width %i', (width) => {
    const height = 5
    const bits = new Uint8Array(width * height)
    for (let i = 0; i < bits.length; i++) bits[i] = (i * 7) % 3 === 0 ? 1 : 0
    expect(Array.from(unpack1bpp(pack1bpp(bits, width, height)))).toEqual(Array.from(bits))
  })

  it('leaves padding bits clear at non-multiple-of-8 widths', () => {
    const bits = new Uint8Array(9).fill(1)
    const bm = pack1bpp(bits, 9, 1)
    // dot 8 is the only one in the second byte; bits 9..15 are padding
    expect(bm.data[1]).toBe(0b1000_0000)
  })
})

describe('padToHead', () => {
  const src = pack1bpp(bitsFrom(['##']).bits, 2, 1)

  it('left-aligns by default', () => {
    const out = padToHead(src, 8)
    expect(unpack1bpp(out).join('')).toBe('11000000')
  })

  it('right-aligns', () => {
    expect(unpack1bpp(padToHead(src, 8, 'right')).join('')).toBe('00000011')
  })

  it('centres', () => {
    expect(unpack1bpp(padToHead(src, 8, 'center')).join('')).toBe('00011000')
  })

  it('applies a calibration offset', () => {
    expect(unpack1bpp(padToHead(src, 8, 'left', 3)).join('')).toBe('00011000')
  })

  it('clips content pushed past the head edge rather than wrapping it', () => {
    // Wrapping would silently reappear on the far side of the label, which looks
    // like a print corruption bug rather than a bad offset.
    const out = padToHead(src, 8, 'right', 1)
    expect(unpack1bpp(out).join('')).toBe('00000001')
  })

  it('refuses a label wider than the head', () => {
    expect(() => padToHead(pack1bpp(new Uint8Array(10), 10, 1), 8)).toThrow(LabelTooWideError)
  })

  it('is a no-op at exactly head width with no offset', () => {
    const exact = pack1bpp(new Uint8Array(8), 8, 1)
    expect(padToHead(exact, 8)).toBe(exact)
  })

  it('places a 10 mm inset at dot column 80', () => {
    // The mm -> dot -> printer chain, asserted end to end.
    const label = pack1bpp(bitsFrom(['#']).bits, 1, 1)
    const out = padToHead(label, 384, 'left', mmToDots(10))
    expect(getDot(out, 80, 0)).toBe(true)
    expect(getDot(out, 79, 0)).toBe(false)
  })
})

describe('luminance', () => {
  it('uses Rec. 601 weights', () => {
    const rgba = Uint8ClampedArray.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255])
    expect(Array.from(toLuminance(rgba, 3))).toEqual([76, 150, 29])
  })

  it('treats fully transparent black as white, not black', () => {
    const rgba = Uint8ClampedArray.from([0, 0, 0, 0])
    expect(toLuminance(rgba, 1)[0]).toBe(255)
  })

  it('composites partial alpha over white paper', () => {
    const rgba = Uint8ClampedArray.from([0, 0, 0, 128])
    expect(toLuminance(rgba, 1)[0]).toBeCloseTo(128, -1)
  })

  it('reports coverage from alpha', () => {
    const rgba = Uint8ClampedArray.from([0, 0, 0, 0, 0, 0, 0, 200])
    expect(Array.from(toAlphaMask(rgba, 2))).toEqual([0, 1])
  })
})

describe('threshold', () => {
  it('is inclusive at the threshold level', () => {
    expect(Array.from(threshold(Uint8Array.from([127, 128, 129]), 128))).toEqual([1, 1, 0])
  })
})

describe('floydSteinberg', () => {
  it('renders mid-grey as roughly half black', () => {
    const w = 64
    const h = 64
    const out = floydSteinberg(new Uint8Array(w * h).fill(128), w, h)
    const black = out.reduce((n, v) => n + v, 0)
    expect(black / out.length).toBeGreaterThan(0.4)
    expect(black / out.length).toBeLessThan(0.6)
  })

  it('leaves pure black and pure white untouched', () => {
    const w = 16
    const h = 16
    expect(floydSteinberg(new Uint8Array(w * h).fill(0), w, h).every((v) => v === 1)).toBe(true)
    expect(floydSteinberg(new Uint8Array(w * h).fill(255), w, h).every((v) => v === 0)).toBe(true)
  })

  /*
   * This is what lets the dither move into `toFabric.applyImageTone` without the
   * tone plane in `rasterize` undoing it: the plane pass still runs, but over
   * pixels that are already 0 or 255, where it is the identity. If this ever
   * stops holding, per-image dithering silently gets diffused a second time.
   */
  it('is idempotent over an already-binary plane', () => {
    const w = 32
    const h = 32
    const source = new Uint8Array(w * h)
    for (let i = 0; i < source.length; i++) source[i] = (i * 7) % 5 === 0 ? 0 : 255
    const once = floydSteinberg(source, w, h)
    const binary = Uint8Array.from(once, (v) => (v === 1 ? 0 : 255))
    expect(Array.from(floydSteinberg(binary, w, h))).toEqual(Array.from(once))
  })
})

describe('dither', () => {
  const flat = (n: number, value: number) => new Uint8Array(n).fill(value)

  it('defaults to Floyd–Steinberg', () => {
    const w = 32
    const h = 32
    expect(Array.from(dither(flat(w * h, 128), w, h))).toEqual(
      Array.from(floydSteinberg(flat(w * h, 128), w, h)),
    )
  })

  it.each(['atkinson', 'bayer'] as const)(
    'renders mid-grey as roughly half black: %s',
    (algorithm) => {
      const w = 64
      const h = 64
      const out = dither(flat(w * h, 128), w, h, { algorithm })
      const black = out.reduce((n, v) => n + v, 0)
      expect(black / out.length).toBeGreaterThan(0.4)
      expect(black / out.length).toBeLessThan(0.6)
    },
  )

  it.each(['atkinson', 'bayer'] as const)('differs from Floyd–Steinberg: %s', (algorithm) => {
    const w = 32
    const h = 32
    const ramp = Uint8Array.from({ length: w * h }, (_, i) => (i % w) * 8)
    const fs = dither(ramp, w, h, { algorithm: 'floyd-steinberg' })
    const other = dither(ramp, w, h, { algorithm })
    expect(Array.from(other)).not.toEqual(Array.from(fs))
  })

  it('carries less error under Atkinson than Floyd–Steinberg', () => {
    // Atkinson discards a quarter of the error, so a near-white field keeps more
    // of its highlights instead of having stray dots diffused into them.
    const w = 64
    const h = 64
    const nearWhite = flat(w * h, 200)
    const fs = dither(nearWhite, w, h, { algorithm: 'floyd-steinberg' })
    const atkinson = dither(nearWhite, w, h, { algorithm: 'atkinson' })
    const ink = (out: Uint8Array) => out.reduce((n, v) => n + v, 0)
    expect(ink(atkinson)).toBeLessThan(ink(fs))
  })

  it('degenerates to a flat cut at strength 0', () => {
    const w = 16
    const h = 16
    const ramp = Uint8Array.from({ length: w * h }, (_, i) => (i % w) * 17)
    for (const algorithm of ['floyd-steinberg', 'atkinson'] as const) {
      const out = dither(ramp, w, h, { algorithm, strength: 0 })
      expect(Array.from(out)).toEqual(Array.from(ramp, (v) => (v <= 127 ? 1 : 0)))
    }
    // The ordered matrix collapses at 128 rather than 127 — see DitherOptions.
    const ordered = dither(ramp, w, h, { algorithm: 'bayer', strength: 0 })
    expect(Array.from(ordered)).toEqual(Array.from(ramp, (v) => (v <= 128 ? 1 : 0)))
  })

  it('tiles the ordered matrix on an 8-dot grid', () => {
    // Same luminance everywhere, so any variation in the output is the matrix.
    // Every 8x8 tile must therefore be identical to its neighbour.
    const w = 32
    const h = 16
    const out = dither(flat(w * h, 128), w, h, { algorithm: 'bayer' })
    const tile = (tx: number, ty: number) => {
      const cells: number[] = []
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) cells.push(out[(ty * 8 + y) * w + tx * 8 + x])
      }
      return cells.join('')
    }
    expect(tile(1, 0)).toBe(tile(0, 0))
    expect(tile(0, 1)).toBe(tile(0, 0))
    // ...and it is a real pattern, not a flat field.
    expect(new Set(tile(0, 0).split('')).size).toBe(2)
  })
})

describe('composite', () => {
  it('lets white crisp content knock out the photo beneath it', () => {
    // Crisp plane: a white pixel (bit 0) that *is* covered by the mask.
    // OR-ing the planes would let the photo's black dot win and the text vanish.
    const crispBits = Uint8Array.from([0, 1, 0])
    const crispMask = Uint8Array.from([1, 1, 0])
    const toneBits = Uint8Array.from([1, 1, 1])
    expect(Array.from(composite(crispBits, crispMask, toneBits))).toEqual([0, 1, 1])
  })
})
