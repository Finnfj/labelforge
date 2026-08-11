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
/**
 * Where the label's left edge sits within the head-width raster.
 *
 * Exported because the preview needs the same answer: it has to crop to where
 * the label actually is, not to the first N columns. Those were separate
 * calculations once, and the preview showed a right-aligned label cut in half
 * while the printed result was perfect.
 */
export function headOriginDots(
  labelWidthDots: number,
  headWidthDots: number,
  align: HeadAlign = 'left',
  offsetDots = 0,
): number {
  const slack = headWidthDots - labelWidthDots
  const base = align === 'left' ? 0 : align === 'right' ? slack : slack >> 1
  return base + offsetDots
}

export function padToHead(
  src: PackedBitmap,
  headWidthDots: number,
  align: HeadAlign = 'left',
  offsetDots = 0,
  options: { clip?: boolean } = {},
): PackedBitmap {
  // Throwing is the right default for a print: silently cropping someone's
  // label is worse than refusing. The preview opts into clipping so it can show
  // what *would* print alongside a warning — which matters because the head
  // width is an assumption until it has been measured on real hardware, and a
  // 50 mm roll is 400 dots against an assumed 384.
  if (src.widthDots > headWidthDots && !options.clip) {
    throw new LabelTooWideError(src.widthDots, headWidthDots)
  }
  if (src.widthDots === headWidthDots && offsetDots === 0) return src

  const originX = headOriginDots(src.widthDots, headWidthDots, align, offsetDots)

  const out = createPackedBitmap(headWidthDots, src.heightDots)
  for (let y = 0; y < src.heightDots; y++) {
    for (let x = 0; x < src.widthDots; x++) {
      if (getDot(src, x, y)) setDot(out, x + originX, y, true)
    }
  }
  return out
}
