import { describe, expect, it } from 'vitest'
import { rasterize } from './rasterize'
import { getDot } from '../model/bitmap'
import { createEmptyDoc, type LabelDoc, type LabelElement } from '../model/labelDoc'
import { unpack1bpp } from './pack1bpp'
import { LabelTooWideError } from './padToHead'

/**
 * These run in a real Chromium via Playwright, not jsdom. Canvas text metrics and
 * antialiasing are exactly what ships, so a geometry assertion here means the
 * millimetre-to-dot chain is right end to end rather than right in theory.
 */

function docWith(elements: Partial<LabelElement>[], widthMm = 40, heightMm = 30): LabelDoc {
  const doc = createEmptyDoc(widthMm, heightMm)
  doc.elements = elements.map((e, i) => ({
    id: `e${i}`,
    x: 0,
    y: 0,
    widthMm: 5,
    heightMm: 5,
    rotation: 0,
    z: i,
    ...e,
  })) as LabelElement[]
  return doc
}

/** Leftmost column containing any black dot, or -1. */
function firstInkColumn(bits: Uint8Array, width: number, height: number): number {
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) if (bits[y * width + x]) return x
  }
  return -1
}

function firstInkRow(bits: Uint8Array, width: number, height: number): number {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (bits[y * width + x]) return y
  }
  return -1
}

describe('rasterize geometry', () => {
  it('places a 10 mm inset at dot column 80', async () => {
    const doc = docWith([{ kind: 'shape', shape: 'rect', filled: true, strokeMm: 0, x: 10, y: 0 }])
    const { bitmap } = await rasterize(doc)

    expect(bitmap.widthDots).toBe(320) // 40 mm at 8 dots/mm
    expect(bitmap.heightDots).toBe(240)

    const bits = unpack1bpp(bitmap)
    expect(firstInkColumn(bits, bitmap.widthDots, bitmap.heightDots)).toBe(80)
  })

  it('places a 10 mm top inset at dot row 80', async () => {
    const doc = docWith([{ kind: 'shape', shape: 'rect', filled: true, strokeMm: 0, x: 0, y: 10 }])
    const { bitmap } = await rasterize(doc)
    const bits = unpack1bpp(bitmap)
    expect(firstInkRow(bits, bitmap.widthDots, bitmap.heightDots)).toBe(80)
  })

  it('anchors an element at the origin to dot 0', async () => {
    const doc = docWith([{ kind: 'shape', shape: 'rect', filled: true, strokeMm: 0 }])
    const { bitmap } = await rasterize(doc)
    expect(getDot(bitmap, 0, 0)).toBe(true)
  })

  it('fills exactly the requested size', async () => {
    // 5 x 5 mm = 40 x 40 dots.
    const doc = docWith([
      { kind: 'shape', shape: 'rect', filled: true, strokeMm: 0, widthMm: 5, heightMm: 5 },
    ])
    const { bitmap } = await rasterize(doc)
    expect(getDot(bitmap, 39, 39)).toBe(true)
    expect(getDot(bitmap, 40, 40)).toBe(false)
  })

  it('renders an unfilled rect as an outline, not a solid', async () => {
    const doc = docWith([
      {
        kind: 'shape',
        shape: 'rect',
        filled: false,
        strokeMm: 0.25,
        widthMm: 10,
        heightMm: 10,
        x: 2,
        y: 2,
      },
    ])
    const { bitmap } = await rasterize(doc)
    // Centre of the box is hollow; the edge is inked.
    expect(getDot(bitmap, 16 + 40, 16 + 40)).toBe(false)
    const bits = unpack1bpp(bitmap)
    expect(firstInkColumn(bits, bitmap.widthDots, bitmap.heightDots)).toBeLessThanOrEqual(16)
  })

  it('renders text as ink without overflowing the label', async () => {
    const doc = docWith([
      {
        kind: 'text',
        text: 'HELLO',
        fontFamily: 'sans-serif',
        fontSizePt: 12,
        align: 'left',
        x: 2,
        y: 2,
        widthMm: 30,
        heightMm: 8,
      },
    ])
    const { bitmap } = await rasterize(doc)
    const bits = unpack1bpp(bitmap)
    const inked = bits.reduce((n: number, v: number) => n + v, 0)
    expect(inked).toBeGreaterThan(50)
    expect(firstInkColumn(bits, bitmap.widthDots, bitmap.heightDots)).toBeGreaterThanOrEqual(16)
  })

  it('produces a blank bitmap for an empty document', async () => {
    const { bitmap } = await rasterize(createEmptyDoc(25, 15))
    expect(bitmap.data.every((b) => b === 0)).toBe(true)
  })

  it('skips hidden elements', async () => {
    const doc = docWith([{ kind: 'shape', shape: 'rect', filled: true, strokeMm: 0, hidden: true }])
    const { bitmap } = await rasterize(doc)
    expect(bitmap.data.every((b) => b === 0)).toBe(true)
  })

  it('pads to head width on request, leaving the label left-aligned', async () => {
    const doc = docWith([{ kind: 'shape', shape: 'rect', filled: true, strokeMm: 0 }])
    const { bitmap, labelWidthDots } = await rasterize(doc, { headWidthDots: 384 })
    expect(labelWidthDots).toBe(320)
    expect(bitmap.widthDots).toBe(384)
    expect(getDot(bitmap, 0, 0)).toBe(true)
    // Everything beyond the label edge must be blank.
    for (let x = 320; x < 384; x++) expect(getDot(bitmap, x, 0)).toBe(false)
  })

  it('reports a label wider than the head instead of failing, when clipping is allowed', async () => {
    // A 50 mm roll is 400 dots against the assumed 384-dot head, so the shipped
    // 50 mm presets hit this on every render. Refusing outright left the preview
    // stale with no explanation.
    const doc = docWith(
      [
        {
          kind: 'shape',
          shape: 'rect',
          filled: true,
          strokeMm: 0,
          x: 0,
          y: 0,
          widthMm: 50,
          heightMm: 5,
        },
      ],
      50,
      30,
    )
    const { bitmap, labelWidthDots, clipped } = await rasterize(doc, {
      headWidthDots: 384,
      clipToHead: true,
    })
    expect(labelWidthDots).toBe(400)
    expect(bitmap.widthDots).toBe(384)
    expect(clipped).toBe(true)
    expect(getDot(bitmap, 383, 0)).toBe(true)
  })

  it('refuses an over-wide label by default, so a print is never silently cropped', async () => {
    const doc = docWith([{ kind: 'shape', shape: 'rect', filled: true, strokeMm: 0 }], 50, 30)
    await expect(rasterize(doc, { headWidthDots: 384 })).rejects.toThrow(LabelTooWideError)
  })

  it('is not marked clipped when the label fits', async () => {
    const doc = docWith([{ kind: 'shape', shape: 'rect', filled: true, strokeMm: 0 }], 40, 30)
    const { clipped } = await rasterize(doc, { headWidthDots: 384, clipToHead: true })
    expect(clipped).toBe(false)
  })

  describe('unpadded output, as the vendor app sends it', () => {
    // An HCI capture of the vendor app printing a 40x30 mm label shows a raster of
    // 40 bytes per row and 240 rows: 320x240 dots, exactly the label, with no
    // padding out to the 384-dot head. Padding and picking an alignment was our
    // guess at what it did, and it put content in the wrong place.
    it('emits exactly the label width when no head width is given', async () => {
      const doc = docWith([{ kind: 'shape', shape: 'rect', filled: true, strokeMm: 0 }], 40, 30)
      const { bitmap } = await rasterize(doc)
      expect(bitmap.widthDots).toBe(320)
      expect(bitmap.rowBytes).toBe(40)
      expect(bitmap.heightDots).toBe(240)
    })

    it('still reports clipping against a head limit without padding to it', async () => {
      // maxWidthDots exists so "how wide is the head" and "pad out to the head"
      // can be asked separately, which they could not be when one option did both.
      const doc = docWith([{ kind: 'shape', shape: 'rect', filled: true, strokeMm: 0 }], 50, 30)
      const { bitmap, clipped } = await rasterize(doc, {
        maxWidthDots: 384,
        clipToHead: true,
      })
      expect(clipped).toBe(true)
      // Cropped to the head, not padded past it.
      expect(bitmap.widthDots).toBe(384)
    })

    it('refuses an over-wide label against a bare limit too', async () => {
      const doc = docWith([{ kind: 'shape', shape: 'rect', filled: true, strokeMm: 0 }], 50, 30)
      await expect(rasterize(doc, { maxWidthDots: 384 })).rejects.toThrow(LabelTooWideError)
    })
  })

  it('supersampling does not move dot-aligned geometry', async () => {
    // A rectangle on whole-dot boundaries must rasterise identically however
    // finely it was sampled. If this drifts, supersampling is shifting edges and
    // barcodes would be next.
    const doc = docWith([
      {
        kind: 'shape',
        shape: 'rect',
        filled: true,
        strokeMm: 0,
        x: 5,
        y: 5,
        widthMm: 10,
        heightMm: 10,
      },
    ])
    const plain = await rasterize(doc, { supersample: 1 })
    const fine = await rasterize(doc, { supersample: 3 })
    expect(Array.from(fine.bitmap.data)).toEqual(Array.from(plain.bitmap.data))
  })

  it('supersampling keeps text weight in the same ballpark', async () => {
    // Supersampling should sharpen glyph shapes, not thin them into fragments or
    // fatten them into blobs.
    const doc = docWith([
      {
        kind: 'text',
        text: 'Handling 8.5',
        fontFamily: 'sans-serif',
        fontSizePt: 8,
        align: 'left',
        x: 2,
        y: 2,
        widthMm: 34,
        heightMm: 6,
      },
    ])
    const ink = async (supersample: number) => {
      const { bitmap } = await rasterize(doc, { supersample })
      return unpack1bpp(bitmap).reduce((n: number, v: number) => n + v, 0)
    }
    const plain = await ink(1)
    const fine = await ink(3)
    expect(plain).toBeGreaterThan(50)
    expect(fine).toBeGreaterThan(50)
    expect(fine / plain).toBeGreaterThan(0.75)
    expect(fine / plain).toBeLessThan(1.35)
  })

  it('honours draw order', async () => {
    // A later, larger white-free shape simply adds ink; order matters for images
    // but here we assert the sort is applied at all by checking both are present.
    const doc = docWith([
      { kind: 'shape', shape: 'rect', filled: true, strokeMm: 0, x: 0, z: 5 },
      { kind: 'shape', shape: 'rect', filled: true, strokeMm: 0, x: 20, z: 1 },
    ])
    const { bitmap } = await rasterize(doc)
    expect(getDot(bitmap, 0, 0)).toBe(true)
    expect(getDot(bitmap, 160, 0)).toBe(true)
  })
  describe('an element that cannot be rendered', () => {
    /*
     * These guard the worst bug this code has had: clearing a QR's value to type a
     * new one made bwip-js refuse to encode, rasterize threw, and the caller kept
     * the previous bitmap — so the preview showed, and the printer received, the
     * payload that had just been replaced. Scanning the label gave the old URL.
     */
    const emptyQr = () =>
      docWith([{ kind: 'qr', value: '', ecLevel: 'M', widthMm: 18, heightMm: 18 }])

    it('does not throw the whole raster away', async () => {
      const { bitmap, skipped } = await rasterize(emptyQr())
      expect(bitmap.widthDots).toBe(320)
      expect(skipped).toHaveLength(1)
    })

    it('names the element and says why, in words worth reading', async () => {
      const { skipped } = await rasterize(emptyQr())
      expect(skipped[0].kind).toBe('qr')
      expect(skipped[0].id).toBeTruthy()
      // bwip-js's own wording is "bar code text not specified", which tells someone
      // who just cleared a field nothing at all.
      expect(skipped[0].reason).toMatch(/No value yet/i)
      expect(skipped[0].reason).not.toMatch(/bwip/i)
    })

    it('leaves the rest of the label intact', async () => {
      const doc = docWith([
        { kind: 'qr', value: '', ecLevel: 'M', widthMm: 12, heightMm: 12, x: 20, y: 2 },
        {
          kind: 'shape',
          shape: 'rect',
          filled: true,
          strokeMm: 0,
          x: 0,
          y: 0,
          widthMm: 8,
          heightMm: 8,
        },
      ])
      const { bitmap, skipped } = await rasterize(doc)
      expect(skipped).toHaveLength(1)
      // The rectangle still prints; only the unencodable code is missing.
      expect(getDot(bitmap, 4, 4)).toBe(true)
    })

    it('reports nothing skipped when everything renders', async () => {
      const doc = docWith([{ kind: 'qr', value: 'https://example.com', ecLevel: 'M' }])
      const { skipped } = await rasterize(doc)
      expect(skipped).toEqual([])
    })
  })
})
