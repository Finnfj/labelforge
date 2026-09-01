import { afterEach, describe, expect, it } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Canvas, FabricObject, Textbox } from 'fabric'
import { EditorCanvas } from './EditorCanvas'
import { createEmptyDoc, type LabelDoc, type LabelElement, type TextElement } from '../model/labelDoc'
import { mmToDots } from '../model/units'

/**
 * A text element's box is a thing the user declared, not a measurement.
 *
 * The bug this pins down: a Fabric Textbox takes its height from its content and
 * silently discards whatever height it is given, so for a 24 × 6 mm box at 10 pt
 * the document says 48 dots tall and the object is about 32. `placement` centres
 * the object on the middle of the *document's* box, which insets the shorter
 * object by half the difference, and `readGeometry` then reads that inset back as
 * the element's y and the content height back as its height. One purely
 * horizontal drag was enough: Height 6 became 3.98 and Y 2 became 3.01, so an
 * element the user never resized shrank and stepped a millimetre down the label.
 *
 * Both halves are asserted here, because either alone would leave the round trip
 * lossy: the box's top edge belongs at the y the document gives it, and a drag
 * must hand back the declared height untouched.
 */

let root: Root | null = null
let host: HTMLDivElement | null = null
let canvas: Canvas | null = null
let updates: Array<Record<string, unknown>> = []
/** The live document, republished by the harness on every render. */
let doc: LabelDoc = createEmptyDoc(40, 30)

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  host?.remove()
  root = null
  host = null
  canvas = null
})

const ZOOM = 2
/** The Text button's own defaults, which is where this was reported. */
const BOX = { x: 2, y: 2, widthMm: 24, heightMm: 6 }

function docWithText(): LabelDoc {
  const doc = createEmptyDoc(40, 30)
  doc.elements = [
    {
      id: 't1',
      kind: 'text',
      text: 'Text',
      fontFamily: 'Fira Sans',
      fontSizePt: 10,
      align: 'left',
      rotation: 0,
      z: 1,
      ...BOX,
    },
  ]
  return doc
}

/** Two frames, which is what Fabric needs to have painted. */
async function settle() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
  })
}

/**
 * The editor wired to real document state, the way the app wires it.
 *
 * The loop has to be closed for this to mean anything: the drift is a patch
 * leaving `readGeometry`, landing in the document and coming back as a rebuilt
 * object, and a fixed document could not show the second lap.
 */
async function mountLive(): Promise<void> {
  updates = []
  canvas = null
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  doc = docWithText()

  function LiveEditor() {
    const [current, setDoc] = useState(doc)
    doc = current
    return (
      <EditorCanvas
        doc={current}
        selectedId="t1"
        zoom={ZOOM}
        onSelect={() => {}}
        onUpdate={(id, patch) => {
          updates.push(patch as Record<string, unknown>)
          // The same merge as useLabelEditor's updateElement, cast included:
          // spreading a patch over a discriminated union widens `kind`.
          setDoc((d) => ({
            ...d,
            elements: d.elements.map((e) =>
              e.id === id ? ({ ...e, ...patch } as LabelElement) : e,
            ),
          }))
        }}
        onReady={(c) => {
          canvas = c
        }}
      />
    )
  }

  await act(async () => {
    root!.render(<LiveEditor />)
  })
  await settle()
}

function object(): FabricObject {
  const first = canvas!.getObjects()[0]
  expect(first, 'the text element did not reach the canvas').toBeTruthy()
  return first
}

/** The text element as the document now holds it. */
function text(): TextElement {
  return doc.elements[0] as TextElement
}

/** The object's axis-aligned box in scene dots, which is what the user sees selected. */
function box() {
  const points = object().getCoords()
  return {
    top: Math.min(...points.map((p) => p.y)),
    bottom: Math.max(...points.map((p) => p.y)),
    left: Math.min(...points.map((p) => p.x)),
  }
}

/**
 * Drag the element with the pointer, exactly as a user does.
 *
 * Through real mouse events rather than by setting `left` and firing
 * `object:modified` by hand: the handler under test reads whatever Fabric leaves
 * on the object after a transform, so faking the transform would be testing the
 * fake.
 */
async function dragBy(dxDots: number, dyDots = 0) {
  const upper = host!.querySelector('canvas.upper-canvas') as HTMLCanvasElement
  const rect = upper.getBoundingClientRect()
  const from = object().getCenterPoint()
  const at = (x: number, y: number) => ({
    clientX: rect.left + x * ZOOM,
    clientY: rect.top + y * ZOOM,
    bubbles: true,
  })

  await act(async () => {
    upper.dispatchEvent(new MouseEvent('mousedown', at(from.x, from.y)))
    // Two moves: Fabric treats the first as the gesture threshold.
    upper.dispatchEvent(new MouseEvent('mousemove', at(from.x + dxDots / 2, from.y + dyDots / 2)))
    upper.dispatchEvent(new MouseEvent('mousemove', at(from.x + dxDots, from.y + dyDots)))
    upper.dispatchEvent(new MouseEvent('mouseup', at(from.x + dxDots, from.y + dyDots)))
  })
  await settle()
}

describe('a dragged text box', () => {
  it('is the size of the box the user typed, not of the glyphs', async () => {
    // The premise, and what the selection rectangle and the hit test are drawn
    // from. Fabric's own measurement of this line is about two thirds of the box,
    // and while it wins the handles enclose the glyphs instead of the box — and
    // every readback afterwards is a measurement rather than the box.
    await mountLive()
    expect(text().heightMm).toBe(6)
    expect(object().getScaledHeight()).toBeCloseTo(mmToDots(BOX.heightMm), 5)
    expect(
      (object() as Textbox).calcTextHeight(),
      'the text no longer fits, so the box is not the interesting number here',
    ).toBeLessThan(mmToDots(BOX.heightMm))
  })

  it('puts the top of the box where the document says', async () => {
    // Centred on the *document* box's middle, a short object is inset by half the
    // difference — about a millimetre of dead space above ink the document places
    // at y = 2 mm.
    await mountLive()
    expect(box().top).toBeCloseTo(mmToDots(BOX.y), 1)
    // Top-anchored, not centred: the content hangs from the declared top edge and
    // stays inside the declared box.
    expect(box().bottom).toBeLessThanOrEqual(mmToDots(BOX.y + BOX.heightMm) + 0.5)
  })

  it('keeps the declared height through a horizontal drag', async () => {
    await mountLive()
    await dragBy(mmToDots(8))

    expect(updates.length, 'the drag never reached the document').toBeGreaterThan(0)
    const moved = text()
    expect(moved.x).toBeCloseTo(BOX.x + 8, 1)
    // The two the bug moved on their own. Nothing asked for either.
    expect(moved.heightMm).toBeCloseTo(BOX.heightMm, 5)
    expect(moved.y).toBeCloseTo(BOX.y, 5)
    // And the box is still hung from the document's y after the round trip.
    expect(box().top).toBeCloseTo(mmToDots(BOX.y), 1)
  })

  it('does not drift further on the drags after the first', async () => {
    // The reported shape of it: one step, then stable. A fix that merely damps
    // the step would still pass a single-drag test.
    await mountLive()
    await dragBy(mmToDots(4))
    const once = { y: text().y, heightMm: text().heightMm }
    await dragBy(mmToDots(4))

    expect(text().y).toBeCloseTo(once.y, 5)
    expect(text().heightMm).toBeCloseTo(once.heightMm, 5)
    expect(text().x).toBeCloseTo(BOX.x + 8, 1)
  })

  it('keeps the box while text is typed on the canvas', async () => {
    // Why the height is an override of Fabric's own layout rather than an
    // assignment after it. Fabric recomputes a Textbox's height on every text
    // change, so a one-off assignment would be undone by the first keystroke —
    // and the next drag would read the recomputed height into the document. This
    // types enough to wrap onto a second line, so the recomputed height would be
    // larger than the box rather than smaller, and no clamp could hide it.
    await mountLive()
    const textbox = object() as Textbox
    await act(async () => {
      textbox.enterEditing()
    })
    const textarea = document.querySelector('textarea')
    expect(textarea, 'Fabric did not attach its editing textarea').not.toBeNull()
    await act(async () => {
      textarea!.value = 'Text and rather more text than fits'
      textarea!.selectionStart = textarea!.selectionEnd = textarea!.value.length
      textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    })

    expect(textbox.calcTextHeight()).toBeGreaterThan(mmToDots(BOX.heightMm))
    expect(textbox.getScaledHeight(), 'the box grew to fit the text').toBeCloseTo(
      mmToDots(BOX.heightMm),
      5,
    )

    await act(async () => {
      textbox.exitEditing()
    })
    await settle()
    await dragBy(mmToDots(4))
    expect(text().heightMm).toBeCloseTo(BOX.heightMm, 5)
    expect(text().y).toBeCloseTo(BOX.y, 5)
  })

  it('still folds a vertical resize into the font size and the box', async () => {
    // The other side of the bargain: a scale is the one thing that *should* change
    // a text element's height, and it must keep changing the font size with it.
    await mountLive()
    await act(async () => {
      const target = object()
      target.set({ scaleY: 2 })
      canvas!.fire('object:modified', { target })
    })
    await settle()

    expect(text().fontSizePt).toBeCloseTo(20, 1)
    expect(text().heightMm).toBeCloseTo(BOX.heightMm * 2, 1)
  })
})
