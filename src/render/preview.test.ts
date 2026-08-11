import { describe, expect, it } from 'vitest'
import { toPreviewImage } from './preview'
import { headOriginDots, padToHead } from './padToHead'
import { pack1bpp } from './pack1bpp'

/** A label-width bitmap with ink in its first and last column. */
function labelWithEdges(widthDots: number, heightDots = 4) {
  const bits = new Uint8Array(widthDots * heightDots)
  for (let y = 0; y < heightDots; y++) {
    bits[y * widthDots] = 1
    bits[y * widthDots + widthDots - 1] = 1
  }
  return pack1bpp(bits, widthDots, heightDots)
}

/** Is the pixel at (x, y) of a preview inked? */
function inked(preview: ReturnType<typeof toPreviewImage>, x: number, y = 0): boolean {
  return preview.data[(y * preview.width + x) * 4] < 128
}

const LABEL = 320
const HEAD = 384

describe('headOriginDots', () => {
  it('places the label according to alignment', () => {
    expect(headOriginDots(LABEL, HEAD, 'left')).toBe(0)
    expect(headOriginDots(LABEL, HEAD, 'center')).toBe(32)
    expect(headOriginDots(LABEL, HEAD, 'right')).toBe(64)
  })

  it('adds the offset', () => {
    expect(headOriginDots(LABEL, HEAD, 'left', 24)).toBe(24)
    expect(headOriginDots(LABEL, HEAD, 'right', -8)).toBe(56)
  })

  it('agrees with where padToHead actually puts the dots', () => {
    // The two must never disagree: they did once, and a right-aligned label
    // printed perfectly while the preview showed it sliced in half.
    for (const align of ['left', 'center', 'right'] as const) {
      for (const offset of [0, 16, -8]) {
        const origin = headOriginDots(LABEL, HEAD, align, offset)
        // Only meaningful where the label actually lands on the raster; an
        // offset that pushes it off the edge is covered separately below.
        if (origin < 0 || origin + LABEL > HEAD) continue
        const padded = padToHead(labelWithEdges(LABEL), HEAD, align, offset)
        const view = toPreviewImage(padded, { viewOriginDots: 0, viewWidthDots: HEAD })
        expect(inked(view, origin), `${align} offset ${offset}: left edge`).toBe(true)
        expect(inked(view, origin + LABEL - 1), `${align} offset ${offset}: right edge`).toBe(true)
      }
    }
  })

  it('clips rather than wraps when an offset pushes the label off the head', () => {
    // Overshooting the calibration offset must lose the overhanging dots, not
    // reappear them on the opposite edge — which would look like corruption
    // rather than a bad setting.
    const padded = padToHead(labelWithEdges(LABEL), HEAD, 'left', -8)
    const view = toPreviewImage(padded, { viewOriginDots: 0, viewWidthDots: HEAD })
    // The label's right edge has moved 8 dots left and is still present.
    expect(inked(view, LABEL - 1 - 8)).toBe(true)
    // Nothing has wrapped around to the far end.
    expect(inked(view, HEAD - 1)).toBe(false)
  })
})

describe('toPreviewImage windowing', () => {
  it('shows a right-aligned label in full rather than cropping from column 0', () => {
    // The bug: the preview always cropped the first `labelWidth` columns, so a
    // right-aligned label appeared cut off while printing correctly.
    const origin = headOriginDots(LABEL, HEAD, 'right')
    const padded = padToHead(labelWithEdges(LABEL), HEAD, 'right')

    const cropped = toPreviewImage(padded, {
      labelStartDots: origin,
      labelWidthDots: LABEL,
      viewOriginDots: origin,
      viewWidthDots: LABEL,
    })

    expect(cropped.width).toBe(LABEL)
    // Both edges of the label are present, at the very ends of the view.
    expect(inked(cropped, 0)).toBe(true)
    expect(inked(cropped, LABEL - 1)).toBe(true)
  })

  it('tints only the area outside the paper, wherever the paper sits', () => {
    const origin = headOriginDots(LABEL, HEAD, 'right')
    const padded = padToHead(labelWithEdges(LABEL), HEAD, 'right')
    const full = toPreviewImage(padded, {
      labelStartDots: origin,
      labelWidthDots: LABEL,
      viewOriginDots: 0,
      viewWidthDots: HEAD,
    })

    const blueAt = (x: number) => full.data[x * 4 + 2]
    const redAt = (x: number) => full.data[x * 4]
    // Left of the paper: tinted, so red and blue differ.
    expect(blueAt(10)).not.toBe(redAt(10))
    // Inside the paper: neutral.
    expect(blueAt(origin + 100)).toBe(redAt(origin + 100))
  })

  it('never reads past the end of the raster', () => {
    const bm = labelWithEdges(64)
    const view = toPreviewImage(bm, { viewOriginDots: 60, viewWidthDots: 999 })
    expect(view.width).toBe(4)
    expect(view.data.length).toBe(4 * bm.heightDots * 4)
  })

  it('clamps a nonsensical origin instead of producing an empty image', () => {
    const bm = labelWithEdges(64)
    const view = toPreviewImage(bm, { viewOriginDots: 5000, viewWidthDots: 100 })
    expect(view.width).toBeGreaterThan(0)
  })

  it('defaults to the whole raster', () => {
    const bm = labelWithEdges(64)
    const view = toPreviewImage(bm)
    expect(view.width).toBe(64)
    expect(inked(view, 0)).toBe(true)
    expect(inked(view, 63)).toBe(true)
  })
})
