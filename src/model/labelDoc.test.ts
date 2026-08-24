import { describe, expect, it } from 'vitest'
import {
  createEmptyDoc,
  photoElementIds,
  withPhotoTone,
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

describe('photoElementIds', () => {
  it('names every photograph, whatever its dither', () => {
    // All of them, because the panel applies one tone choice across the label —
    // leaving one photo on full-strength diffusion would keep the raster large
    // and make the advice wrong.
    const doc = docWith(image('a'), image('b', { dither: 'bayer' }))
    expect(photoElementIds(doc)).toEqual(['a', 'b'])
  })

  it('leaves line art alone', () => {
    // Not a size judgement: thresholded line art is not dithered at all, so there
    // is nothing to trade, and dithering it would wreck the one thing it is for.
    expect(photoElementIds(docWith(image('a', { mode: 'lineart' })))).toEqual([])
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
    expect(photoElementIds(docWith(text))).toEqual([])
  })
})

describe('withPhotoTone', () => {
  it('applies the tone to photographs and nothing else', () => {
    const doc = docWith(image('a'), image('b', { mode: 'lineart' }))
    const next = withPhotoTone(doc, { ditherStrength: 0.4 })

    expect((next.elements[0] as ImageElement).ditherStrength).toBe(0.4)
    expect((next.elements[1] as ImageElement).ditherStrength).toBeUndefined()
    // The original is what the preview is still rasterising from.
    expect((doc.elements[0] as ImageElement).ditherStrength).toBeUndefined()
  })

  it('returns the same document when there is no photograph to change', () => {
    // The print panel rasterises the result to compare sizes. A fresh object with
    // identical contents would cost a full raster for no difference.
    const doc = docWith(image('a', { mode: 'lineart' }))
    expect(withPhotoTone(doc, { dither: 'bayer' })).toBe(doc)
  })
})
