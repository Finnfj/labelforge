import { createPackedBitmap, getDot, setDot, type PackedBitmap } from '../model/bitmap'

export type HeadAlign = 'left' | 'center' | 'right'

export class LabelTooWideError extends Error {
  constructor(labelWidthDots: number, headWidthDots: number) {
    super(`Label is ${labelWidthDots} dots wide but the print head is only ${headWidthDots}.`)
    this.name = 'LabelTooWideError'
  }
}

/**
 * Place a label-sized bitmap into a head-width one.
 *
 * The printer always receives a full head-width raster; anything narrower has to
 * be positioned within it. Which edge the stock is loaded against is a physical
 * property of the printer, not something we can query, so alignment and a
 * fine-tuning offset are per-printer settings established with the diagnostics
 * ruler strip. Default is left, which is how gap stock is usually fed.
 */
export function padToHead(
  src: PackedBitmap,
  headWidthDots: number,
  align: HeadAlign = 'left',
  offsetDots = 0,
): PackedBitmap {
  if (src.widthDots > headWidthDots) throw new LabelTooWideError(src.widthDots, headWidthDots)
  if (src.widthDots === headWidthDots && offsetDots === 0) return src

  const slack = headWidthDots - src.widthDots
  const base = align === 'left' ? 0 : align === 'right' ? slack : (slack >> 1)
  const originX = base + offsetDots

  const out = createPackedBitmap(headWidthDots, src.heightDots)
  for (let y = 0; y < src.heightDots; y++) {
    for (let x = 0; x < src.widthDots; x++) {
      if (getDot(src, x, y)) setDot(out, x + originX, y, true)
    }
  }
  return out
}
