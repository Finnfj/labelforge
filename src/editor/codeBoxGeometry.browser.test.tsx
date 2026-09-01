import { afterEach, describe, expect, it } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Canvas, FabricObject } from 'fabric'
import { EditorCanvas } from './EditorCanvas'
import {
  createEmptyDoc,
  type BarcodeElement,
  type LabelDoc,
  type LabelElement,
} from '../model/labelDoc'
import { mmToDots } from '../model/units'

/**
 * A code's box is a thing the user declared, not a measurement of the symbol.
 *
 * Same bug as the text box had, reached a different way. A code is never stretched
 * to fill its box — fractional module widths do not scan — so it is drawn at its
 * natural size and centred. That left the Fabric object a different size from the
 * box: a 30 × 12 mm barcode came out 198 × 135 dots against a box of 240 × 96,
 * taller than its box because a linear symbology was getting a quiet zone above
 * and below it as well as beside it. `readGeometry` then measured the object back,
 * so one purely horizontal drag turned 30 × 12 mm into 24.75 × 16.9 — the height
 * visibly growing, which is how it was reported.
 *
 * Two things hold it shut. The rendered canvas is the box, with the code centred
 * inside it, the way an image element already worked. And the writeback keeps the
 * declared millimetres rather than re-deriving them, so nothing is lost to the
 * round trip through whole dots either.
 */

let root: Root | null = null
let host: HTMLDivElement | null = null
let canvas: Canvas | null = null
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
/** The Barcode button's own defaults, which is where this was reported. */
const BOX = { x: 2, y: 2, widthMm: 30, heightMm: 12 }

function docWithBarcode(patch: Partial<BarcodeElement> = {}): LabelDoc {
  const next = createEmptyDoc(40, 30)
  next.elements = [
    {
      id: 'b1',
      kind: 'barcode',
      symbology: 'code128',
      value: '12345678',
      showText: true,
      rotation: 0,
      z: 1,
      ...BOX,
      ...patch,
    },
  ]
  return next
}

async function settle() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
  })
}

/** The editor wired to real document state, so a patch can come back round. */
async function mountLive(patch: Partial<BarcodeElement> = {}): Promise<void> {
  canvas = null
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  doc = docWithBarcode(patch)

  function LiveEditor() {
    const [current, setDoc] = useState(doc)
    doc = current
    return (
      <EditorCanvas
        doc={current}
        selectedId="b1"
        zoom={ZOOM}
        onSelect={() => {}}
        onUpdate={(id, patch) => {
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
  expect(first, 'the barcode did not reach the canvas').toBeTruthy()
  return first
}

const code = () => doc.elements[0] as BarcodeElement

/** The object's axis-aligned box in scene dots — what the user sees selected. */
function box() {
  const points = object().getCoords()
  return {
    left: Math.min(...points.map((p) => p.x)),
    top: Math.min(...points.map((p) => p.y)),
    right: Math.max(...points.map((p) => p.x)),
    bottom: Math.max(...points.map((p) => p.y)),
  }
}

/** Drag with real mouse events, since the handler reads what Fabric leaves behind. */
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

describe('code box geometry', () => {
  it('is the size of the box the user typed, not of the symbol', async () => {
    await mountLive()
    const b = box()
    expect(b.right - b.left).toBeCloseTo(mmToDots(BOX.widthMm), 1)
    expect(b.bottom - b.top).toBeCloseTo(mmToDots(BOX.heightMm), 1)
  })

  it('puts the box where the document says', async () => {
    await mountLive()
    const b = box()
    expect(b.left).toBeCloseTo(mmToDots(BOX.x), 1)
    expect(b.top).toBeCloseTo(mmToDots(BOX.y), 1)
  })

  it('keeps the declared box through a horizontal drag', async () => {
    // The report: the barcode got longer in height only. It grew because the
    // rendered canvas was five millimetres taller than the box and the drag wrote
    // that back.
    await mountLive()
    await dragBy(mmToDots(4))

    expect(code().heightMm, 'height changed on a horizontal drag').toBe(BOX.heightMm)
    expect(code().widthMm, 'width changed on a horizontal drag').toBe(BOX.widthMm)
    expect(code().y, 'y changed on a horizontal drag').toBeCloseTo(BOX.y, 2)
    expect(code().x, 'the drag did not move it').toBeGreaterThan(BOX.x)
  })

  it('does not drift on the drags after the first', async () => {
    // The first lap is where a mismatch shows; a second one catches anything that
    // only settles once the document has been rewritten.
    await mountLive()
    await dragBy(mmToDots(2))
    const afterOne = { ...code() }
    await dragBy(mmToDots(2))

    expect(code().heightMm).toBe(afterOne.heightMm)
    expect(code().widthMm).toBe(afterOne.widthMm)
    expect(code().y).toBeCloseTo(afterOne.y, 2)
  })

  it('keeps a box that is not a whole number of dots', async () => {
    // Why the writeback keeps the declared value rather than re-deriving it even
    // though the object now agrees: millimetres round to whole dots on the way
    // out, so a round trip would quietly truncate anything finer than an eighth
    // of a millimetre. 30.05 mm is 240.4 dots.
    const odd = { widthMm: 30.05, heightMm: 12.03 }
    await mountLive(odd)
    expect(code().widthMm).toBe(odd.widthMm)

    await dragBy(mmToDots(2))
    expect(code().widthMm, 'width was rounded by the round trip').toBe(odd.widthMm)
    expect(code().heightMm, 'height was rounded by the round trip').toBe(odd.heightMm)
  })
})
