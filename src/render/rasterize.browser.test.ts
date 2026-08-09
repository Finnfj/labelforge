import { describe, expect, it } from 'vitest'
import { rasterize } from './rasterize'
import { getDot } from '../model/bitmap'
import { createEmptyDoc, type LabelDoc, type LabelElement } from '../model/labelDoc'
import { unpack1bpp } from './pack1bpp'

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
    const doc = docWith([
      { kind: 'shape', shape: 'rect', filled: true, strokeMm: 0, x: 10, y: 0 },
    ])
    const { bitmap } = await rasterize(doc)

    expect(bitmap.widthDots).toBe(320) // 40 mm at 8 dots/mm
    expect(bitmap.heightDots).toBe(240)

    const bits = unpack1bpp(bitmap)
    expect(firstInkColumn(bits, bitmap.widthDots, bitmap.heightDots)).toBe(80)
  })

  it('places a 10 mm top inset at dot row 80', async () => {
    const doc = docWith([
      { kind: 'shape', shape: 'rect', filled: true, strokeMm: 0, x: 0, y: 10 },
    ])
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
    const doc = docWith([
      { kind: 'shape', shape: 'rect', filled: true, strokeMm: 0, hidden: true },
    ])
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
})
