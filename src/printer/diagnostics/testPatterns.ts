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
 * Ruler strip for measuring the true head width and horizontal origin.
 *
 * A tick every dot-millimetre, a long tick every centimetre, a solid block at
 * x=0 and a single column at the far edge. Print one at each candidate width and
 * measure with a real ruler: if 384 dots measures 48.0 mm the assumed geometry is
 * right; if the far-edge column is missing the head is narrower than assumed; if
 * the left block is clipped the origin is offset. There is no command that
 * reports any of this, so measuring is the only way to learn it.
 */
export function rulerStrip(widthDots: number): PackedBitmap {
  const height = 64
  const bm = createPackedBitmap(widthDots, height)

  // Origin marker: an asymmetric block so a mirrored print is obvious.
  fillRect(bm, 0, 0, 16, 24)
  fillRect(bm, 0, 24, 8, 8)

  // Far-edge column: absent on the print => the head is narrower than widthDots.
  fillRect(bm, widthDots - 1, 0, 1, height)

  for (let x = 0; x < widthDots; x += DOTS_PER_MM) {
    const isCm = x % (DOTS_PER_MM * 10) === 0
    fillRect(bm, x, height - (isCm ? 32 : 12), 1, isCm ? 32 : 12)
  }
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
