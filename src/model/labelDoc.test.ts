import { describe, expect, it } from 'vitest'
import {
  createEmptyDoc,
  orderedDitherCandidates,
  withOrderedDither,
  type ImageElement,
  type LabelDoc,
  type TextElement,
} from './labelDoc'

/**
 * Which elements the print panel may offer to re-dither.
 *
 * The offer only makes sense for photographs. Dithering line art muddies it, and
 * a barcode dithered is a barcode no scanner reads — so getting the selection
 * wrong here would trade a registration problem for an unscannable label.
 */

function image(id: string, patch: Partial<ImageElement> = {}): ImageElement {
  return {
    id,
    kind: 'image',
    assetId: `asset-${id}`,
    mode: 'photo',
    fit: 'contain',
    x: 0,
    y: 0,
    widthMm: 10,
    heightMm: 10,
    rotation: 0,
    z: 1,
    ...patch,
  }
}

function docWith(...elements: LabelDoc['elements']): LabelDoc {
  const doc = createEmptyDoc(50, 80)
  doc.elements = elements
  return doc
}

describe('orderedDitherCandidates', () => {
  it('names photos that are not already ordered', () => {
    const doc = docWith(image('a'), image('b', { dither: 'atkinson' }))
    expect(orderedDitherCandidates(doc)).toEqual(['a', 'b'])
  })

  it('leaves line art alone', () => {
    // Not a size judgement: thresholded line art is not dithered at all, so there
    // is nothing to switch, and switching it would wreck the one thing it is for.
    const doc = docWith(image('a', { mode: 'lineart' }))
    expect(orderedDitherCandidates(doc)).toEqual([])
  })

  it('leaves everything that is not an image alone', () => {
    const text: TextElement = {
      id: 't',
      kind: 'text',
      text: 'hello',
      fontFamily: 'Fira Sans',
      fontSizePt: 10,
      align: 'left',
      x: 0,
      y: 0,
      widthMm: 20,
      heightMm: 6,
      rotation: 0,
      z: 1,
    }
    expect(orderedDitherCandidates(docWith(text))).toEqual([])
  })

  it('has nothing to say about a photo already ordered', () => {
    expect(orderedDitherCandidates(docWith(image('a', { dither: 'bayer' })))).toEqual([])
  })
})

describe('withOrderedDither', () => {
  it('switches exactly the candidates and copies rather than mutates', () => {
    const doc = docWith(image('a'), image('b', { mode: 'lineart' }))
    const next = withOrderedDither(doc)

    expect((next.elements[0] as ImageElement).dither).toBe('bayer')
    expect((next.elements[1] as ImageElement).dither).toBeUndefined()
    // The original is what the preview is still rasterising from.
    expect((doc.elements[0] as ImageElement).dither).toBeUndefined()
  })

  it('returns the same document when there is nothing to change', () => {
    // The print panel rasterises this to compare sizes. Handing back a fresh
    // object with identical contents would cost a full raster for no difference.
    const doc = docWith(image('a', { dither: 'bayer' }))
    expect(withOrderedDither(doc)).toBe(doc)
  })
})
