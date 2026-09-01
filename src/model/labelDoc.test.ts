import { describe, expect, it } from 'vitest'
import {
  createEmptyDoc,
  elementsInDrawOrder,
  photoElementIds,
  withElementShifted,
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

/**
 * Stepping one element through the draw order.
 *
 * The operation is a swap with a neighbour, but `z` is renumbered across the
 * document rather than swapped in place. That is what makes it survive a document
 * whose z values are tied or sparse, which an old autosave or a hand-written
 * template can easily be.
 */
describe('withElementShifted', () => {
  const stack = (...zs: number[]) => {
    const doc = createEmptyDoc(50, 80)
    doc.elements = zs.map((z, i) => image(String.fromCharCode(97 + i), { z }))
    return doc
  }
  const order = (doc: LabelDoc) => elementsInDrawOrder(doc).map((e) => e.id)

  it('swaps an element with the one above it', () => {
    expect(order(withElementShifted(stack(1, 2, 3), 'a', 1))).toEqual(['b', 'a', 'c'])
  })

  it('swaps an element with the one below it', () => {
    expect(order(withElementShifted(stack(1, 2, 3), 'c', -1))).toEqual(['a', 'c', 'b'])
  })

  it('renumbers z rather than swapping the two values', () => {
    // What makes it work on a document with ties or gaps. Swapping z between two
    // elements that share a value is a no-op that looks like a bug.
    const shifted = withElementShifted(stack(5, 5, 5), 'a', 1)
    const zs = [...shifted.elements].sort((x, y) => x.z - y.z).map((e) => e.z)
    expect(new Set(zs).size).toBe(3)
    expect(order(shifted)).toEqual(['b', 'a', 'c'])
  })

  it('returns the very same object at the top of the stack', () => {
    // Identity, not just equality: the editor reads it as "nothing happened" and
    // skips the history entry, so pressing Forward on the top element does not
    // leave an undo step that appears to do nothing.
    const doc = stack(1, 2, 3)
    expect(withElementShifted(doc, 'c', 1)).toBe(doc)
  })

  it('returns the very same object at the bottom, and for an unknown id', () => {
    const doc = stack(1, 2, 3)
    expect(withElementShifted(doc, 'a', -1)).toBe(doc)
    expect(withElementShifted(doc, 'nope', 1)).toBe(doc)
  })

  it('counts hidden elements as occupying a place', () => {
    // They are still in the stack. Stepping over one invisibly would make the next
    // press of the button look like it did nothing at all.
    const doc = stack(1, 2, 3)
    doc.elements[1].hidden = true
    const shifted = withElementShifted(doc, 'a', 1)
    // One press moved it past the hidden element and no further, so 'a' is still
    // under 'c' — visibly unchanged, which is correct rather than surprising.
    expect(order(shifted)).toEqual(['a', 'c'])
    const zOf = (id: string) => shifted.elements.find((e) => e.id === id)!.z
    expect(zOf('a')).toBeGreaterThan(zOf('b'))
    expect(zOf('a')).toBeLessThan(zOf('c'))
  })

  it('leaves every other property alone', () => {
    const shifted = withElementShifted(stack(1, 2), 'a', 1)
    for (const element of shifted.elements) {
      expect(element.kind).toBe('image')
      expect((element as ImageElement).assetId).toBe(`asset-${element.id}`)
      expect(element.widthMm).toBe(10)
    }
  })
})
