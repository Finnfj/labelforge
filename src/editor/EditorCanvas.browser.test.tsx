import { describe, expect, it, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { EditorCanvas } from './EditorCanvas'
import { createEmptyDoc, type LabelDoc } from '../model/labelDoc'

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

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  host?.remove()
  root = null
  host = null
})

async function mount(doc: LabelDoc, zoom = 2) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <StrictMode>
        <EditorCanvas
          doc={doc}
          selectedId={null}
          zoom={zoom}
          onSelect={() => {}}
          onUpdate={() => {}}
        />
      </StrictMode>,
    )
  })
  // Fabric paints on requestAnimationFrame; give it a couple of frames.
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
  })
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
