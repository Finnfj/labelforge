import { describe, expect, it } from 'vitest'
import type { DraftElement } from '../model/labelDoc'
import { placeForTurnedView } from './insertPlacement'

/**
 * Inserting into a turned canvas.
 *
 * Two things have to hold together, and the second is the one that is easy to
 * forget: the element must read upright on the turned canvas, *and* it must be on
 * the label. Counter-rotating without moving the element satisfies the first and
 * breaks the second, because elements rotate about their centre.
 */

const text = (patch: Partial<DraftElement> = {}): DraftElement =>
  ({
    kind: 'text',
    text: 'Text',
    fontFamily: 'Fira Sans',
    fontSizePt: 10,
    align: 'left',
    x: 2,
    y: 2,
    widthMm: 24,
    heightMm: 6,
    rotation: 0,
    ...patch,
  }) as DraftElement

/** The footprint a centre-rotated element actually covers, in mm. */
function footprint(element: DraftElement) {
  const cx = element.x + element.widthMm / 2
  const cy = element.y + element.heightMm / 2
  // A quarter turn swaps which dimension runs along which axis.
  const quarter = Math.abs(element.rotation % 180) === 90
  const across = quarter ? element.heightMm : element.widthMm
  const down = quarter ? element.widthMm : element.heightMm
  return { x: cx - across / 2, y: cy - down / 2, across, down }
}

describe('placeForTurnedView', () => {
  it('counter-rotates so the element reads upright on the turned canvas', () => {
    // The canvas turns content a quarter turn clockwise, so the element needs the
    // opposite quarter turn to come out level. 270 rather than -90 only because
    // that is what reads sensibly in the Rotation field.
    expect(placeForTurnedView(text(), 30).rotation).toBe(270)
  })

  it('keeps the element on the label', () => {
    // The bug this exists to prevent. 24 mm of text at y = 2 rotated about its
    // centre spans y = -7 to 17 — upright on screen with a third of it off the
    // paper, which looks like the feature is broken rather than the placement.
    const placed = placeForTurnedView(text(), 30)
    const box = footprint(placed)
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.across).toBeLessThanOrEqual(30)
  })

  it('puts it against the corner the turned canvas shows top left', () => {
    // A turned canvas shows the label's bottom-left corner at the screen's top
    // left, so that is the corner a new element belongs against — anywhere else
    // and it arrives somewhere the user is not looking.
    const placed = placeForTurnedView(text(), 30, 2)
    const box = footprint(placed)
    expect(box.x).toBeCloseTo(2, 6)
    expect(box.y + box.down).toBeCloseTo(30 - 2, 6)
  })

  it('turns the footprint on its side', () => {
    // What "upright on screen" means in document terms: the long axis of the text
    // now runs down the label, and the turn puts it back across the screen.
    const box = footprint(placeForTurnedView(text(), 30))
    expect(box.across).toBeCloseTo(6, 6)
    expect(box.down).toBeCloseTo(24, 6)
  })

  it('sits flush rather than off the edge when it cannot fit the margin', () => {
    // A 24 mm element on a 20 mm label has no room for the margin. Flush with the
    // edge is wrong by 2 mm; hanging off it is wrong by more and looks broken.
    const box = footprint(placeForTurnedView(text(), 20))
    expect(box.y).toBeCloseTo(0, 6)
  })

  it('adds to a rotation the element already had', () => {
    // Every toolbar draft is upright today, but a preset or a template need not
    // be, and silently discarding its rotation would be a surprise.
    expect(placeForTurnedView(text({ rotation: 90 }), 30).rotation).toBe(0)
    expect(placeForTurnedView(text({ rotation: 45 }), 30).rotation).toBe(315)
  })

  it('leaves a square element where it would have been', () => {
    // Nothing to compensate: a square's footprint is the same either way, so only
    // the rotation should differ.
    const square = text({ widthMm: 20, heightMm: 20 })
    const placed = placeForTurnedView(square, 30)
    expect(placed.x).toBeCloseTo(2, 6)
    expect(placed.y).toBeCloseTo(30 - 20 - 2, 6)
  })
})
