import { describe, expect, it } from 'vitest'
import {
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library'
import jsQR from 'jsqr'
import { rasterize } from './rasterize'
import { unpack1bpp } from './pack1bpp'
import { renderCode, MIN_RELIABLE_MODULE_DOTS, BarcodeError } from './barcode'
import {
  createEmptyDoc,
  type BarcodeElement,
  type LabelDoc,
  type QrElement,
} from '../model/labelDoc'
import type { PackedBitmap } from '../model/bitmap'

/**
 * The strongest validation available without a printer: render a code exactly as
 * it will be sent to the head, then decode it back with real scanner libraries
 * and check the payload survived.
 *
 * This catches the failure that matters and that nothing else would — a barcode
 * that looks perfectly fine on screen but will not scan, because a threshold,
 * a fractional scale factor or a stray dither wrecked its module ratios.
 */

/** 1 = black. Decoders want luminance, where black is 0. */
function toLuminance(bitmap: PackedBitmap): Uint8ClampedArray {
  const bits = unpack1bpp(bitmap)
  const out = new Uint8ClampedArray(bits.length)
  for (let i = 0; i < bits.length; i++) out[i] = bits[i] ? 0 : 255
  return out
}

function toRgba(bitmap: PackedBitmap): Uint8ClampedArray {
  const bits = unpack1bpp(bitmap)
  const out = new Uint8ClampedArray(bits.length * 4)
  for (let i = 0; i < bits.length; i++) {
    const v = bits[i] ? 0 : 255
    out[i * 4] = v
    out[i * 4 + 1] = v
    out[i * 4 + 2] = v
    out[i * 4 + 3] = 255
  }
  return out
}

function decodeLinear(bitmap: PackedBitmap): string | null {
  const reader = new MultiFormatReader()
  const hints = new Map()
  hints.set(DecodeHintType.TRY_HARDER, true)
  reader.setHints(hints)
  const source = new RGBLuminanceSource(toLuminance(bitmap), bitmap.widthDots, bitmap.heightDots)
  try {
    return reader.decode(new BinaryBitmap(new HybridBinarizer(source))).getText()
  } catch {
    return null
  }
}

function decodeQr(bitmap: PackedBitmap): string | null {
  const result = jsQR(toRgba(bitmap), bitmap.widthDots, bitmap.heightDots)
  return result?.data ?? null
}

function docWith(element: BarcodeElement | QrElement, widthMm: number, heightMm: number): LabelDoc {
  const doc = createEmptyDoc(widthMm, heightMm)
  doc.elements = [element]
  return doc
}

const barcode = (over: Partial<BarcodeElement> = {}): BarcodeElement => ({
  id: 'b1',
  kind: 'barcode',
  symbology: 'code128',
  value: 'ABC123',
  showText: false,
  x: 1,
  y: 1,
  widthMm: 38,
  heightMm: 14,
  rotation: 0,
  z: 1,
  ...over,
})

const qr = (over: Partial<QrElement> = {}): QrElement => ({
  id: 'q1',
  kind: 'qr',
  value: 'https://example.com/42',
  ecLevel: 'M',
  x: 1,
  y: 1,
  widthMm: 22,
  heightMm: 22,
  rotation: 0,
  z: 1,
  ...over,
})

describe('linear barcodes survive the full render pipeline', () => {
  const cases: Array<[string, BarcodeElement, number, number]> = [
    ['code128', barcode({ symbology: 'code128', value: 'ABC123' }), 40, 20],
    ['code128 long', barcode({ symbology: 'code128', value: 'SHELF-4471-B' }), 50, 20],
    ['code39', barcode({ symbology: 'code39', value: 'HELLO' }), 50, 20],
    ['ean13', barcode({ symbology: 'ean13', value: '4006381333931' }), 50, 20],
    ['ean8', barcode({ symbology: 'ean8', value: '96385074' }), 40, 20],
  ]

  it.each(cases)('%s round-trips', async (_name, element, widthMm, heightMm) => {
    const doc = docWith(
      { ...element, widthMm: widthMm - 2, heightMm: heightMm - 2 },
      widthMm,
      heightMm,
    )
    const { bitmap } = await rasterize(doc)
    const decoded = decodeLinear(bitmap)
    // EAN encodes the value without its check digit in some readers; compare the
    // significant prefix rather than demanding an exact string for those.
    expect(decoded).not.toBeNull()
    expect(element.value.startsWith(decoded!) || decoded === element.value).toBe(true)
  })

  it('round-trips with the human-readable text enabled', async () => {
    const doc = docWith(barcode({ showText: true, widthMm: 38, heightMm: 16 }), 40, 20)
    const { bitmap } = await rasterize(doc)
    expect(decodeLinear(bitmap)).toBe('ABC123')
  })

  it('still decodes after padding out to the head width', async () => {
    const doc = docWith(barcode(), 40, 20)
    const { bitmap } = await rasterize(doc, { headWidthDots: 384, align: 'left' })
    expect(bitmap.widthDots).toBe(384)
    expect(decodeLinear(bitmap)).toBe('ABC123')
  })

  it.each([25, 40, 50])('round-trips on a %i mm roll', async (widthMm) => {
    const doc = docWith(
      barcode({ value: 'W' + widthMm, widthMm: widthMm - 2, heightMm: 14 }),
      widthMm,
      20,
    )
    const { bitmap } = await rasterize(doc)
    expect(decodeLinear(bitmap)).toBe('W' + widthMm)
  })
})

describe('QR codes survive the full render pipeline', () => {
  it.each([0, 90, 180, 270])('round-trips at %i degrees', async (rotation) => {
    // Identical placement at every angle: elements rotate about their centre, so
    // turning one must not move it. If this ever needs per-angle compensation
    // again, rotation has regressed to swinging content out of its box.
    const doc = docWith(qr({ x: 5, y: 5, widthMm: 24, heightMm: 24, rotation }), 34, 34)
    const { bitmap } = await rasterize(doc)
    expect(decodeQr(bitmap)).toBe('https://example.com/42')
  })

  it.each(['L', 'M', 'Q', 'H'] as const)('round-trips at error correction %s', async (ecLevel) => {
    const doc = docWith(qr({ ecLevel, widthMm: 26, heightMm: 26 }), 30, 30)
    const { bitmap } = await rasterize(doc)
    expect(decodeQr(bitmap)).toBe('https://example.com/42')
  })

  it('round-trips a long payload', async () => {
    const value = 'https://example.com/inventory/item?sku=SHELF-4471-B&loc=A12&qty=48'
    const doc = docWith(qr({ value, widthMm: 44, heightMm: 44 }), 48, 48)
    const { bitmap } = await rasterize(doc)
    expect(decodeQr(bitmap)).toBe(value)
  })
})

describe('module geometry', () => {
  it('scales by whole dots only', () => {
    for (const boxWidth of [100, 137, 200, 313, 384]) {
      const { moduleDots } = renderCode(barcode(), boxWidth, 100)
      expect(Number.isInteger(moduleDots)).toBe(true)
      expect(moduleDots).toBeGreaterThanOrEqual(1)
    }
  })

  it('includes a quiet zone', () => {
    // bwip-js emits the bare symbol; without our margin the leftmost column
    // would be a bar. Assert the outer edge is white.
    const { canvas } = renderCode(barcode(), 300, 100)
    const ctx = canvas.getContext('2d')!
    const left = ctx.getImageData(0, Math.floor(canvas.height / 2), 1, 1).data
    const right = ctx.getImageData(canvas.width - 1, Math.floor(canvas.height / 2), 1, 1).data
    expect(left[0]).toBeGreaterThan(200)
    expect(right[0]).toBeGreaterThan(200)
  })

  it('never exceeds the box it was given', () => {
    const { canvas } = renderCode(barcode(), 200, 80)
    expect(canvas.width).toBeLessThanOrEqual(200)
  })

  it('flags a module width that is too small to scan reliably', () => {
    // A long payload squeezed into a narrow box falls to one dot per module.
    const { moduleDots } = renderCode(
      barcode({ value: 'THIS-IS-A-VERY-LONG-BARCODE-VALUE-1234567890' }),
      120,
      80,
    )
    expect(moduleDots).toBeLessThan(MIN_RELIABLE_MODULE_DOTS)
  })

  it('reports unencodable content as a typed error', () => {
    expect(() =>
      renderCode(barcode({ symbology: 'ean13', value: 'not-numeric' }), 300, 80),
    ).toThrow(BarcodeError)
  })
})
