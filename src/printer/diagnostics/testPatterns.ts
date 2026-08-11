import { createPackedBitmap, setDot, type PackedBitmap } from '../../model/bitmap'
import { DOTS_PER_MM } from '../../model/units'

function fillRect(bm: PackedBitmap, x0: number, y0: number, w: number, h: number): void {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setDot(bm, x, y, true)
}

/**
 * The walking-skeleton pattern: prove that *something* comes out, correctly
 * oriented, on any roll the user happens to have.
 *
 * All content is confined to the leftmost 96 dots (12 mm) so it prints legibly
 * even on the narrowest stock, and the triangle makes the origin and orientation
 * unambiguous — a plain rectangle tells you nothing about whether the image was
 * mirrored or flipped.
 */
export function testStrip(headWidthDots: number, heightDots = 120): PackedBitmap {
  const bm = createPackedBitmap(headWidthDots, heightDots)
  // Solid square.
  fillRect(bm, 8, 8, 48, 48)
  // Right triangle with its square corner at the origin side.
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32 - y; x++) setDot(bm, 8 + x, 68 + y, true)
  return bm
}

/**
 * A 3×5 dot font, just the digits.
 *
 * Enough to number a ruler, which turns "count the ticks and hope" into reading
 * a number off the paper. Drawn by hand rather than rasterised from a real font:
 * this module must stay free of canvas so it works anywhere, and at this size
 * hinting would wreck a real typeface anyway.
 */
const DIGITS_3X5: Record<string, number[]> = {
  '0': [0b111, 0b101, 0b101, 0b101, 0b111],
  '1': [0b010, 0b110, 0b010, 0b010, 0b111],
  '2': [0b111, 0b001, 0b111, 0b100, 0b111],
  '3': [0b111, 0b001, 0b111, 0b001, 0b111],
  '4': [0b101, 0b101, 0b111, 0b001, 0b001],
  '5': [0b111, 0b100, 0b111, 0b001, 0b111],
  '6': [0b111, 0b100, 0b111, 0b101, 0b111],
  '7': [0b111, 0b001, 0b001, 0b001, 0b001],
  '8': [0b111, 0b101, 0b111, 0b101, 0b111],
  '9': [0b111, 0b101, 0b111, 0b001, 0b111],
}

/** Draw digits at `scale` dots per font pixel. Returns the width used. */
function drawNumber(bm: PackedBitmap, x0: number, y0: number, text: string, scale: number): number {
  let x = x0
  for (const character of text) {
    const glyph = DIGITS_3X5[character]
    if (!glyph) continue
    for (let row = 0; row < glyph.length; row++) {
      for (let column = 0; column < 3; column++) {
        if (glyph[row] & (0b100 >> column)) {
          fillRect(bm, x + column * scale, y0 + row * scale, scale, scale)
        }
      }
    }
    x += 4 * scale
  }
  return x - x0
}

/**
 * Ruler strip for measuring the true head width and horizontal origin.
 *
 * Numbered in millimetres, so you read the answer instead of counting ticks: the
 * highest number that printed tells you how much width you actually got, whether
 * it ran out because the head is narrower than requested or because the paper is.
 *
 * The two ends are deliberately different shapes — a right-pointing wedge at the
 * origin, a left-pointing one at the far edge. An earlier version put a solid
 * block at one end and a plain column at the other, which was genuinely
 * ambiguous on a printed strip: either could be described as "a long mark at one
 * end", and a mirrored or clipped print looked the same as a correct one.
 *
 * Nothing in the protocol reports head width, so measuring is the only way.
 */
export function rulerStrip(widthDots: number): PackedBitmap {
  const height = 96
  const bm = createPackedBitmap(widthDots, height)
  const cm = DOTS_PER_MM * 10

  // Origin: a wedge widening to the right, unmistakably "this is the start".
  for (let y = 0; y < 24; y++) {
    fillRect(bm, 0, y, 4 + Math.round((y / 23) * 16), 1)
  }

  // Far edge: the mirror image, plus a column right on the last dot. If the
  // wedge is missing, the strip stopped before the width requested.
  for (let y = 0; y < 24; y++) {
    const w = 4 + Math.round((y / 23) * 16)
    fillRect(bm, widthDots - w, y, w, 1)
  }
  fillRect(bm, widthDots - 1, 0, 1, height)

  // Millimetre numbers every centimetre.
  for (let x = 0; x <= widthDots - cm; x += cm) {
    const mm = String((x / DOTS_PER_MM) | 0)
    const scale = 4
    const textWidth = mm.length * 4 * scale
    // Keep the number clear of the end wedges.
    if (x + textWidth < widthDots - 26) drawNumber(bm, x + 3, 30, mm, scale)
  }

  // Ticks along the bottom: 1 mm short, 10 mm long.
  for (let x = 0; x < widthDots; x += DOTS_PER_MM) {
    const isCm = x % cm === 0
    fillRect(bm, x, height - (isCm ? 32 : 12), 1, isCm ? 32 : 12)
  }
  return bm
}

/**
 * A frame drawn on the outermost dots of the raster.
 *
 * The definitive geometry check, and the one to reach for first. If both vertical
 * lines appear on the paper with none of the frame lost, the raster maps exactly
 * onto the printable area and head width, alignment and offset are all correct.
 * If a side is missing the raster is wider than the paper; if there is a margin
 * before a line, it is narrower or offset.
 *
 * It answers in one label what the ruler strip only narrows down, because it does
 * not require reading a scale — you are just looking for four lines.
 */
export function edgeFrame(widthDots: number, heightDots = 80, thickness = 2): PackedBitmap {
  const bm = createPackedBitmap(widthDots, heightDots)
  fillRect(bm, 0, 0, thickness, heightDots)
  fillRect(bm, widthDots - thickness, 0, thickness, heightDots)
  fillRect(bm, 0, 0, widthDots, thickness)
  fillRect(bm, 0, heightDots - thickness, widthDots, thickness)

  // Inward-pointing corner ticks, so a frame clipped on one side is instantly
  // distinguishable from one that simply printed faintly.
  const tick = Math.min(24, Math.floor(widthDots / 6))
  fillRect(bm, 0, heightDots / 2 - 1, tick, 2)
  fillRect(bm, widthDots - tick, heightDots / 2 - 1, tick, 2)
  return bm
}

/** Checkerboard — verifies bit order and polarity at a glance. */
export function checkerboard(widthDots: number, heightDots: number, cell = 8): PackedBitmap {
  const bm = createPackedBitmap(widthDots, heightDots)
  for (let y = 0; y < heightDots; y++) {
    for (let x = 0; x < widthDots; x++) {
      if ((((x / cell) | 0) + ((y / cell) | 0)) % 2 === 0) setDot(bm, x, y, true)
    }
  }
  return bm
}

/** A solid patch plus a 50% checker, used as one rung of the density ladder. */
export function densityPatch(widthDots: number, heightDots = 48): PackedBitmap {
  const bm = createPackedBitmap(widthDots, heightDots)
  const half = Math.floor(widthDots / 2)
  fillRect(bm, 0, 0, half, heightDots)
  for (let y = 0; y < heightDots; y++) {
    for (let x = half; x < widthDots; x++) if ((x + y) % 2 === 0) setDot(bm, x, y, true)
  }
  return bm
}
