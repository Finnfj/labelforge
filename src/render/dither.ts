import type { DitherAlgorithm } from '../model/labelDoc'

/**
 * Reduce greyscale to one bit per dot, for photographs only.
 *
 * A thermal head prints one bit per dot, so a photo thresholded flat comes out as
 * a few black blobs. Trading spatial resolution for apparent tone is the only way
 * to make one legible, and there is more than one way to make that trade.
 *
 * Never run any of this over text, barcodes or QR codes: the scattered dots
 * destroy the sharp module edges a scanner relies on.
 */

export interface DitherOptions {
  /** Defaults to Floyd–Steinberg, which is what this module used to do outright. */
  algorithm?: DitherAlgorithm
  /**
   * Fraction of the quantisation error carried into neighbouring pixels, 0–1.
   *
   * 1 is the classic kernel. Lowering it walks the result back towards a hard
   * threshold, which is occasionally what a high-contrast photo wants — full
   * diffusion sprays dots into what should be clean white. At 0 nothing is
   * carried and every kernel degenerates to a flat cut at 127.
   *
   * For the ordered matrix there is no error to carry, so this scales the
   * amplitude of the threshold pattern instead: 0 flattens it to a plain cut,
   * which keeps the parameter meaning the same thing to a user. (That one lands
   * at 128 rather than 127 — the same one-level asymmetry `threshold()` has
   * always had against the diffusion path.)
   */
  strength?: number
}

/** Offsets and weights, in sixteenths or eighths, applied left-to-right. */
type Kernel = ReadonlyArray<{ dx: number; dy: number; weight: number }>

/** The classic kernel: 7/16 ahead, then 3/16, 5/16, 1/16 on the row below. */
const FLOYD_STEINBERG: Kernel = [
  { dx: 1, dy: 0, weight: 7 / 16 },
  { dx: -1, dy: 1, weight: 3 / 16 },
  { dx: 0, dy: 1, weight: 5 / 16 },
  { dx: 1, dy: 1, weight: 1 / 16 },
]

/**
 * Atkinson: 1/8 to each of six neighbours, so only 6/8 of the error is carried.
 *
 * Deliberately lossy. Discarding a quarter of the error keeps highlights white
 * and shadows black instead of dragging both toward the middle, which is exactly
 * the failure mode Floyd–Steinberg has on a thermal head — the head's own dot
 * gain then closes up the mid-grey wash and the photo prints as mud.
 */
const ATKINSON: Kernel = [
  { dx: 1, dy: 0, weight: 1 / 8 },
  { dx: 2, dy: 0, weight: 1 / 8 },
  { dx: -1, dy: 1, weight: 1 / 8 },
  { dx: 0, dy: 1, weight: 1 / 8 },
  { dx: 1, dy: 1, weight: 1 / 8 },
  { dx: 0, dy: 2, weight: 1 / 8 },
]

/**
 * 8×8 ordered (Bayer) matrix, as thresholds in 0–63.
 *
 * No error is carried at all, so a dot's value depends only on its own luminance
 * and its position in the tile. That makes it the most robust choice here: error
 * diffusion produces long trails of isolated dots, and an isolated dot is exactly
 * what a thermal head under- or over-prints most unpredictably. The regular
 * texture also survives the head's bleed, where a diffusion pattern smears.
 */
const BAYER_8 = buildBayer8()

function buildBayer8(): Uint8Array {
  // Recursive construction: each level quadruples the matrix from the last.
  let matrix = [
    [0, 2],
    [3, 1],
  ]
  for (let size = 2; size < 8; size *= 2) {
    const next: number[][] = []
    for (let y = 0; y < size * 2; y++) next.push(new Array<number>(size * 2).fill(0))
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const base = matrix[y][x] * 4
        next[y][x] = base
        next[y][x + size] = base + 2
        next[y + size][x] = base + 3
        next[y + size][x + size] = base + 1
      }
    }
    matrix = next
  }
  return Uint8Array.from(matrix.flat())
}

/**
 * Binarise a luminance plane. 1 means a black dot, matching `threshold()`.
 */
export function dither(
  luma: Uint8Array,
  width: number,
  height: number,
  options: DitherOptions = {},
): Uint8Array {
  const strength = clamp(options.strength ?? 1, 0, 1)
  if (options.algorithm === 'bayer') return ordered(luma, width, height, strength)
  const kernel = options.algorithm === 'atkinson' ? ATKINSON : FLOYD_STEINBERG
  return diffuse(luma, width, height, kernel, strength)
}

/**
 * Floyd–Steinberg error diffusion.
 *
 * Kept as its own export because it is the historical behaviour and several
 * callers and tests name it directly.
 */
export function floydSteinberg(luma: Uint8Array, width: number, height: number): Uint8Array {
  return diffuse(luma, width, height, FLOYD_STEINBERG, 1)
}

/**
 * Serpentine error diffusion over an arbitrary kernel.
 *
 * Serpentine traversal (alternating scan direction per row) is not optional: plain
 * left-to-right diffusion produces diagonal "worm" artefacts on smooth gradients,
 * and a label is mostly smooth gradients.
 */
function diffuse(
  luma: Uint8Array,
  width: number,
  height: number,
  kernel: Kernel,
  strength: number,
): Uint8Array {
  // Work in floats so accumulated error isn't repeatedly truncated.
  const buf = Float32Array.from(luma)
  const out = new Uint8Array(luma.length)

  for (let y = 0; y < height; y++) {
    const leftToRight = (y & 1) === 0
    for (let k = 0; k < width; k++) {
      const x = leftToRight ? k : width - 1 - k
      const i = y * width + x
      const old = buf[i]
      const black = old <= 127
      out[i] = black ? 1 : 0
      const err = (old - (black ? 0 : 255)) * strength

      // Mirror the kernel when scanning right-to-left.
      const fwd = leftToRight ? 1 : -1
      for (const { dx, dy, weight } of kernel) {
        add(buf, width, height, x + dx * fwd, y + dy, err * weight)
      }
    }
  }
  return out
}

/** Ordered threshold against a tiled matrix; no error is carried. */
function ordered(luma: Uint8Array, width: number, height: number, strength: number): Uint8Array {
  const out = new Uint8Array(luma.length)
  // Spread the 64 matrix levels across the full 0–255 range, scaled by strength.
  const amplitude = 255 * strength
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const cell = BAYER_8[(y & 7) * 8 + (x & 7)]
      // +0.5 centres the tile on 128, so strength 0 collapses to a plain threshold.
      const level = 128 + ((cell + 0.5) / 64 - 0.5) * amplitude
      out[i] = luma[i] <= level ? 1 : 0
    }
  }
  return out
}

function add(
  buf: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  amount: number,
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return
  buf[y * width + x] += amount
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : max
}
