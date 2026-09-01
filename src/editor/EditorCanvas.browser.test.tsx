import { describe, expect, it, afterEach } from 'vitest'
import { StrictMode, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Canvas, Textbox } from 'fabric'
import { act } from 'react'
import { EditorCanvas } from './EditorCanvas'
import { createEmptyDoc, type LabelDoc, type LabelElement } from '../model/labelDoc'
import { mmToDots } from '../model/units'

/**
 * Renders the editor in a real browser, deliberately inside StrictMode.
 *
 * StrictMode double-invokes effects, which is exactly the condition that breaks
 * naive Fabric integrations: `dispose()` is asynchronous and tears down the DOM
 * subtree it was given, so a shared canvas element leaves the surviving instance
 * rendering into a detached node. Testing without StrictMode would pass while the
 * dev build showed a blank canvas.
 */

let root: Root | null = null
let host: HTMLDivElement | null = null
let updates: Array<{ id: string; patch: Record<string, unknown>; transient?: boolean }> = []
let canvas: Canvas | null = null

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  host?.remove()
  root = null
  host = null
})

async function mount(doc: LabelDoc, zoom = 2, selectedId: string | null = null, turned = false) {
  updates = []
  canvas = null
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <StrictMode>
        <EditorCanvas
          doc={doc}
          selectedId={selectedId}
          zoom={zoom}
          turned={turned}
          onSelect={() => {}}
          onUpdate={(id, patch, options) =>
            updates.push({
              id,
              patch: patch as Record<string, unknown>,
              transient: options?.transient,
            })
          }
          onReady={(c) => {
            canvas = c
          }}
        />
      </StrictMode>,
    )
  })
  // Fabric paints on requestAnimationFrame; give it a couple of frames.
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
  })
}

/** Re-render the mounted editor with a new document, as a doc edit would. */
async function rerender(doc: LabelDoc, zoom = 2, selectedId: string | null = null) {
  await act(async () => {
    root!.render(
      <StrictMode>
        <EditorCanvas
          doc={doc}
          selectedId={selectedId}
          zoom={zoom}
          onSelect={() => {}}
          onUpdate={() => {}}
          onReady={(c) => {
            canvas = c
          }}
        />
      </StrictMode>,
    )
  })
  await settle()
}

/**
 * Pixel identity of the bitmap backing a Fabric image object.
 *
 * Comparing the object's width is not enough: two different QR payloads often
 * encode to the same module count, so a stale symbol can be exactly the right
 * size and still be the wrong code.
 */
function sourceFingerprint(index = 0): string {
  const object = canvas!.getObjects()[index] as { _element?: CanvasImageSource }
  const element = object._element as HTMLCanvasElement | undefined
  expect(element, 'object is not backed by a canvas').toBeTruthy()
  return element!.toDataURL()
}

function liveCanvas(): HTMLCanvasElement {
  const canvases = host!.querySelectorAll<HTMLCanvasElement>('canvas.lower-canvas')
  expect(canvases.length).toBe(1)
  return canvases[0]
}

function tally(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let white = 0
  let dark = 0
  let transparent = 0
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) transparent++
    else if (d[i] > 200) white++
    else if (d[i] < 80) dark++
  }
  return { white, dark, transparent }
}

/** Two frames, which is what Fabric needs to have painted. */
async function settle() {
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
  })
}

/**
 * Mount the editor wired to real document state, the way the app wires it.
 *
 * `mount` above holds the document fixed, so it cannot see anything that depends on
 * an edit flowing out to the document and back — which is where the resize bug
 * lived. Here `onUpdate` patches state and re-renders, closing the loop.
 */
async function mountLive(initial: LabelDoc, zoom = 2) {
  updates = []
  canvas = null
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)

  function LiveEditor() {
    const [doc, setDoc] = useState(initial)
    const [selectedId, setSelectedId] = useState<string | null>(initial.elements[0]?.id ?? null)
    return (
      <EditorCanvas
        doc={doc}
        selectedId={selectedId}
        zoom={zoom}
        onSelect={setSelectedId}
        onUpdate={(id, patch) => {
          updates.push({ id, patch: patch as Record<string, unknown> })
          // Same merge as useLabelEditor's updateElement, cast included: spreading
          // a patch over a discriminated union widens `kind` past the union.
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
    root!.render(
      <StrictMode>
        <LiveEditor />
      </StrictMode>,
    )
  })
  await settle()
}

function docWithRect(): LabelDoc {
  const doc = createEmptyDoc(40, 30)
  doc.elements = [
    {
      id: 'r1',
      kind: 'shape',
      shape: 'rect',
      filled: true,
      strokeMm: 0,
      x: 5,
      y: 5,
      widthMm: 10,
      heightMm: 10,
      rotation: 0,
      z: 1,
    },
  ]
  return doc
}

function docWithQr(value: string, ecLevel: 'L' | 'M' | 'Q' | 'H' = 'M'): LabelDoc {
  const doc = createEmptyDoc(40, 30)
  doc.elements = [
    {
      id: 'q1',
      kind: 'qr',
      value,
      ecLevel,
      x: 2,
      y: 2,
      widthMm: 18,
      heightMm: 18,
      rotation: 0,
      z: 1,
    },
  ]
  return doc
}

function docWithText(): LabelDoc {
  const doc = createEmptyDoc(40, 30)
  doc.elements = [
    {
      id: 't1',
      kind: 'text',
      text: 'HELLO',
      fontFamily: 'sans-serif',
      fontSizePt: 14,
      align: 'left',
      x: 2,
      y: 2,
      widthMm: 30,
      heightMm: 8,
      rotation: 0,
      z: 1,
    },
  ]
  return doc
}

describe('EditorCanvas', () => {
  it('survives StrictMode double-mount with exactly one live canvas', async () => {
    await mount(createEmptyDoc(40, 30))
    // A shared-element integration leaves orphaned canvases behind here.
    expect(host!.querySelectorAll('canvas.lower-canvas').length).toBe(1)
  })

  it('paints the label as white paper', async () => {
    await mount(createEmptyDoc(40, 30))
    const { white, transparent } = tally(liveCanvas())
    expect(white).toBeGreaterThan(0)
    expect(transparent).toBe(0)
  })

  it('sizes the canvas to dots times zoom', async () => {
    await mount(createEmptyDoc(40, 30), 2)
    const canvas = liveCanvas()
    // 40 mm x 8 dots/mm = 320 dots, doubled.
    expect(canvas.width).toBe(640)
    expect(canvas.height).toBe(480)
  })

  it('renders document elements as ink', async () => {
    await mount(docWithText())
    const { dark } = tally(liveCanvas())
    expect(dark).toBeGreaterThan(100)
  })

  it('reports text typed directly on the canvas', async () => {
    // The bug this guards: Fabric does not raise `object:modified` for in-place
    // text editing, so without the editing-lifecycle handlers the typed text
    // lived only on the canvas and was discarded on the next rebuild. It looked
    // like edits were only saved when made in the Inspector.
    //
    // Typing is driven through the hidden textarea Fabric attaches while
    // editing, which is the real keystroke path — `insertChars()` mutates the
    // object without emitting anything, so testing through it would pass even
    // with the handlers removed.
    await mount(docWithText())
    const textbox = canvas!.getObjects()[0] as Textbox
    expect(textbox).toBeDefined()

    await act(async () => {
      textbox.enterEditing()
    })
    const textarea = document.querySelector('textarea')
    expect(textarea, 'Fabric did not attach its editing textarea').not.toBeNull()

    await act(async () => {
      textarea!.value = 'HELLOX'
      textarea!.selectionStart = textarea!.selectionEnd = 6
      textarea!.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const typed = updates.filter((u) => 'text' in u.patch)
    expect(typed.length, 'no text update reached the document').toBeGreaterThan(0)
    expect(String(typed.at(-1)!.patch.text)).toContain('X')
    // Keystrokes are transient so typing a word is a single undo step.
    expect(typed.at(-1)!.transient).toBe(true)

    await act(async () => {
      textbox.exitEditing()
    })

    // Leaving the field commits, which is what makes it an undo boundary.
    const committed = updates.filter((u) => 'text' in u.patch && !u.transient)
    expect(committed.length, 'exiting the field did not commit').toBeGreaterThan(0)
  })

  it('keeps a resize on the canvas instead of springing back', async () => {
    // The bug: Fabric reports a resize as a scale factor, `readGeometry` folded it
    // into widthMm/heightMm and reset the scale, and the rebuild that would have
    // redrawn the object at its new intrinsic size was suppressed as a
    // canvas-originated echo. The document was right and the canvas was wrong, so
    // the object visibly snapped back to its old size and only corrected itself
    // once some unrelated change forced a rebuild — clicking away, typically.
    await mountLive(docWithRect())
    const before = canvas!.getObjects()[0]
    const widthBefore = before.getScaledWidth()
    expect(widthBefore).toBeGreaterThan(0)

    // Exactly what dragging a corner handle produces: a scale factor, then
    // `object:modified` on mouse up.
    await act(async () => {
      before.set({ scaleX: 2, scaleY: 2 })
      canvas!.fire('object:modified', { target: before })
    })
    await settle()

    const patch = updates.at(-1)!.patch
    expect(patch.widthMm, 'the resize never reached the document').toBeCloseTo(20, 1)

    const after = canvas!.getObjects()[0]
    expect(after.getScaledWidth(), 'canvas disagrees with the document').toBeCloseTo(
      widthBefore * 2,
      0,
    )
    // The rebuild must not cost the user their selection, which is why it was
    // being suppressed in the first place.
    expect((canvas!.getActiveObject() as { elementId?: string } | null)?.elementId).toBe('r1')
  })

  it('regenerates a QR code when its value changes', async () => {
    // Selected, because that is the state the app is in: adding a QR selects it,
    // and the Inspector you then type into only exists for the selected element.
    const doc = docWithQr('https://example.com')
    await mount(doc, 2, 'q1')
    const before = sourceFingerprint()

    await rerender(docWithQr('https://example.com/a-quite-different-payload-entirely'), 2, 'q1')
    expect(sourceFingerprint(), 'the canvas still shows the old payload').not.toBe(before)
  })

  it('regenerates a QR code when its error correction changes', async () => {
    // A different EC level at the same payload means different modules, so this
    // must redraw too — and it is the case most likely to be missed, since the
    // element's own text is untouched.
    const doc = docWithQr('https://example.com', 'L')
    await mount(doc, 2, 'q1')
    const before = sourceFingerprint()

    await rerender(docWithQr('https://example.com', 'H'), 2, 'q1')
    expect(sourceFingerprint(), 'the canvas still shows the old EC level').not.toBe(before)
  })

  it('regenerates a QR even when a text element shares the label', async () => {
    // The suspicion: Fabric raises `text:changed` while laying a Textbox out on
    // add, not only while a user is typing. If so, every rebuild containing text
    // sets the "skip the next rebuild" flag, and the *following* edit is
    // swallowed — which would make any change appear to need a second nudge.
    const withText = (value: string): LabelDoc => {
      const doc = docWithQr(value)
      doc.elements = [
        ...doc.elements,
        {
          id: 't1',
          kind: 'text',
          text: 'HELLO',
          fontFamily: 'sans-serif',
          fontSizePt: 12,
          align: 'left',
          x: 22,
          y: 2,
          widthMm: 16,
          heightMm: 6,
          rotation: 0,
          z: 2,
        },
      ]
      return doc
    }

    await mount(withText('https://example.com'))
    const qrIndex = canvas!
      .getObjects()
      .findIndex((o) => (o as { elementId?: string }).elementId === 'q1')
    expect(qrIndex).toBeGreaterThanOrEqual(0)
    const before = sourceFingerprint(qrIndex)

    await rerender(withText('https://example.com/a-quite-different-payload-entirely'))
    expect(sourceFingerprint(qrIndex), 'a text element blocked the rebuild').not.toBe(before)
  })

  it('clears ink when the element is removed', async () => {
    const doc = docWithText()
    await mount(doc)
    expect(tally(liveCanvas()).dark).toBeGreaterThan(100)

    const emptied = { ...doc, elements: [] }
    await act(async () => {
      root!.render(
        <StrictMode>
          <EditorCanvas
            doc={emptied}
            selectedId={null}
            zoom={2}
            onSelect={() => {}}
            onUpdate={() => {}}
          />
        </StrictMode>,
      )
    })
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
    })
    expect(tally(liveCanvas()).dark).toBe(0)
  })
})

/**
 * Turning the editing canvas a quarter turn.
 *
 * A view-only affordance, so what has to hold is that it changes what is on the
 * screen and nothing else: the same document coordinates go out, and a pointer over
 * a given spot still means the spot it looks like.
 *
 * The pointer is the part worth testing. The turn is a Fabric viewport transform
 * rather than a CSS `rotate()` precisely so that Fabric inverts it for pointer
 * arithmetic — with CSS it would measure an axis-aligned bounding box and put every
 * click in the wrong place, and the canvas would look right while being unusable.
 */
describe('EditorCanvas turned', () => {
  const W_MM = 40
  const H_MM = 30
  const ZOOM = 2
  const widthDots = mmToDots(W_MM)
  const heightDots = mmToDots(H_MM)

  /** The interaction surface, which is what a pointer event actually lands on. */
  const upper = () => host!.querySelector('canvas.upper-canvas') as HTMLCanvasElement

  /** Where Fabric thinks a viewport point is, in scene coordinates. */
  const sceneAt = (sx: number, sy: number) => {
    const rect = upper().getBoundingClientRect()
    return canvas!.getScenePoint(
      new MouseEvent('mousemove', { clientX: rect.left + sx, clientY: rect.top + sy }),
    )
  }

  it('swaps the canvas dimensions', async () => {
    await mount(createEmptyDoc(W_MM, H_MM), ZOOM, null, true)
    expect(canvas!.getWidth()).toBe(heightDots * ZOOM)
    expect(canvas!.getHeight()).toBe(widthDots * ZOOM)
  })

  it('puts the label in the canvas rather than beside it', async () => {
    // A rotation about the origin alone would swing the label out of view entirely.
    // Every corner of the page has to land inside the canvas, or the design is off
    // screen and no amount of scrolling helps.
    await mount(createEmptyDoc(W_MM, H_MM), ZOOM, null, true)
    const vpt = canvas!.viewportTransform
    const corners: Array<[number, number]> = [
      [0, 0],
      [widthDots, 0],
      [0, heightDots],
      [widthDots, heightDots],
    ]
    for (const [x, y] of corners) {
      const sx = vpt[0] * x + vpt[2] * y + vpt[4]
      const sy = vpt[1] * x + vpt[3] * y + vpt[5]
      expect(sx).toBeGreaterThanOrEqual(-0.001)
      expect(sx).toBeLessThanOrEqual(canvas!.getWidth() + 0.001)
      expect(sy).toBeGreaterThanOrEqual(-0.001)
      expect(sy).toBeLessThanOrEqual(canvas!.getHeight() + 0.001)
    }
  })

  it('maps a pointer back to the spot it is over', async () => {
    // The whole reason the turn is a viewport transform. Fabric inverts this matrix
    // to find what a click is on, so if it is right here then dragging, resizing and
    // the selection handles are right for free.
    await mount(createEmptyDoc(W_MM, H_MM), ZOOM, null, true)
    const scene = sceneAt((heightDots - 60) * ZOOM, 100 * ZOOM)
    expect(scene.x).toBeCloseTo(100, 3)
    expect(scene.y).toBeCloseTo(60, 3)
  })

  it('maps a pointer the ordinary way when it is not turned', async () => {
    await mount(createEmptyDoc(W_MM, H_MM), ZOOM)
    const scene = sceneAt(100 * ZOOM, 60 * ZOOM)
    expect(scene.x).toBeCloseTo(100, 3)
    expect(scene.y).toBeCloseTo(60, 3)
  })

  it('reports the same document coordinates whether turned or not', async () => {
    // The document must not be able to tell. If the turn leaked into `readGeometry`
    // the label would print rotated, which is the one thing this feature promises
    // not to do.
    const geometry = async (turned: boolean) => {
      await mount(docWithRect(), ZOOM, null, turned)
      const object = canvas!.getObjects()[0]
      await act(async () => {
        object.set({ left: 80, top: 40 })
        canvas!.fire('object:modified', { target: object })
      })
      await settle()
      return updates.at(-1)!.patch
    }

    const upright = await geometry(false)
    await act(async () => {
      root!.unmount()
    })
    host!.remove()
    const sideways = await geometry(true)
    expect(sideways).toEqual(upright)
  })
})
