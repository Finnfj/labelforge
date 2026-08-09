import { describe, expect, it } from 'vitest'
import { encodeImage } from './encodeImage'
import { pack1bpp } from '../../render/pack1bpp'
import goldens from './__fixtures__/vendor-goldens.json'

/**
 * These fixtures were captured from the vendor SDK's own `processImageData()`.
 * Our encoder must reproduce them byte for byte — that equivalence is the entire
 * reason this project needs no vendor code. If a pako upgrade or a stray change
 * to the zlib options alters the output, these fail loudly rather than producing
 * a printer that silently refuses to print.
 */

/** Painters matching the fixture generator. Keep in sync with the fixture names. */
const PAINTERS: Record<string, (x: number, y: number) => [number, number, number, number]> = {
  'box-384x120': (x, y) =>
    x > 8 && x < 88 && y > 8 && y < 88 ? [0, 0, 0, 255] : [255, 255, 255, 255],
  'stride-383x40': (x) => (x % 3 === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]),
  'stride-385x40': (x) => (x % 3 === 0 ? [0, 0, 0, 255] : [255, 255, 255, 255]),
  'transparent-384x16': () => [0, 0, 0, 0],
  'grey-ramp-256x32': (x) => [x, x, x, 255],
  'checker-384x1200': (x, y) =>
    ((x >> 3) + (y >> 3)) % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255],
  'threshold-edge-64x8': (x) => {
    const v = 199 + (x % 3)
    return [v, v, v, 255]
  },
  'solid-black-48x48': () => [0, 0, 0, 255],
  'solid-white-48x48': () => [255, 255, 255, 255],
}

/**
 * The vendor's binarisation rule, reproduced *only* to regenerate fixture inputs.
 *
 * Production code does not use this: our pipeline binarises upstream with proper
 * Rec. 601 luminance (and dithering for photos) and hands the encoder pixels that
 * are already pure black or white. This helper exists so the fixtures pin the
 * encoder — packing, zlib settings, header layout — rather than a colour policy.
 */
function binariseLikeVendor(rgba: Uint8ClampedArray, pixelCount: number): Uint8Array {
  const bits = new Uint8Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    const p = i * 4
    const mean = (rgba[p] + rgba[p + 1] + rgba[p + 2]) / 3
    bits[i] = mean <= 200 && rgba[p + 3] !== 0 ? 1 : 0
  }
  return bits
}

function paintToBits(name: string, width: number, height: number): Uint8Array {
  const paint = PAINTERS[name]
  if (!paint) throw new Error(`no painter registered for fixture "${name}"`)
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4
      const [r, g, b, a] = paint(x, y)
      rgba[p] = r
      rgba[p + 1] = g
      rgba[p + 2] = b
      rgba[p + 3] = a
    }
  }
  return binariseLikeVendor(rgba, width * height)
}

const fromBase64 = (b64: string): Uint8Array =>
  Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))

describe('encodeImage against vendor SDK goldens', () => {
  it.each(goldens.fixtures.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    const bits = paintToBits(fixture.name, fixture.width, fixture.height)
    const actual = encodeImage(pack1bpp(bits, fixture.width, fixture.height))
    const expected = fromBase64(fixture.expectedBase64)

    expect(actual.length).toBe(fixture.expectedLength)
    expect(Array.from(actual)).toEqual(Array.from(expected))
  })
})

describe('encodeImage header', () => {
  it('carries bytes-per-row, not dot width', () => {
    // 383, 384 and 385 dots are 48, 48 and 49 bytes per row respectively.
    for (const [widthDots, expectedRowBytes] of [
      [383, 48],
      [384, 48],
      [385, 49],
    ] as const) {
      const bm = pack1bpp(new Uint8Array(widthDots * 4), widthDots, 4)
      const out = encodeImage(bm)
      expect((out[2] << 8) | out[3]).toBe(expectedRowBytes)
    }
  })

  it('encodes height and payload length big-endian', () => {
    const height = 1200
    const bm = pack1bpp(new Uint8Array(384 * height), 384, height)
    const out = encodeImage(bm)
    expect(out[0]).toBe(0x1f)
    expect(out[1]).toBe(0x10)
    expect((out[4] << 8) | out[5]).toBe(height)
    const declared = (out[6] << 24) | (out[7] << 16) | (out[8] << 8) | out[9]
    expect(declared).toBe(out.length - 10)
  })

  it('emits a zlib-wrapped stream, not raw deflate', () => {
    const out = encodeImage(pack1bpp(new Uint8Array(64), 64, 1))
    // zlib CMF: low nibble 8 = deflate, high nibble = windowBits - 8 = 2.
    const cmf = out[10]
    expect(cmf & 0x0f).toBe(8)
    expect(cmf >> 4).toBe(2)
    // CMF/FLG must be a multiple of 31.
    expect(((cmf << 8) | out[11]) % 31).toBe(0)
  })
})
