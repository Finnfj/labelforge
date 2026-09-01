import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Textbox, type Canvas } from 'fabric'
import { EditorCanvas } from './EditorCanvas'
import { createEmptyDoc, type LabelDoc, type TextAlign } from '../model/labelDoc'
import { mmToDots, ptToDots } from '../model/units'

/**
 * Centred text lands where the box centres it, and the caret lands on the glyphs.
 *
 * Both come apart in one specific way, and it is not obvious from reading either
 * bit of code: Fabric measures a string once, when the object is built. Name a font
 * the browser has not loaded and it measures the fallback, silently. When the real
 * face arrives later — pulled in by the print preview, or by anything else that
 * asks — the glyphs are *painted* in it while every cached measurement still
 * describes the fallback.
 *
 * Left-aligned text hides this: it starts at offset zero either way, so only the
 * far end of a long line is out. Centred text puts half the error on the left of
 * every line, which is what makes it visible, and the caret — positioned from the
 * same stale advances — sits away from the words it is supposed to be inside.
 */

let root: Root | null = null
let host: HTMLDivElement | null = null
let canvas: Canvas | null = null

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  host?.remove()
  root = null
  host = null
  canvas = null
})

const W_MM = 40
const H_MM = 30
const BOX = { x: 4, y: 6, widthMm: 24, heightMm: 6 }
const ZOOM = 2
const TEXT = 'Hello'

function docWithText(align: TextAlign, fontFamily = 'Fira Sans'): LabelDoc {
  const doc = createEmptyDoc(W_MM, H_MM)
  doc.elements = [
    {
      id: 't1',
      kind: 'text',
      text: TEXT,
      fontFamily,
      fontSizePt: 10,
      align,
      rotation: 0,
      z: 1,
      ...BOX,
    },
  ]
  return doc
}

async function mount(doc: LabelDoc) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(
      <EditorCanvas
        doc={doc}
        selectedId="t1"
        zoom={ZOOM}
        onSelect={() => {}}
        onUpdate={() => {}}
        onReady={(c) => {
          canvas = c
        }}
      />,
    )
  })
  await act(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
  })
  return canvas!.getObjects()[0] as Textbox
}

/** Where painted ink actually starts and ends across the label, in scene dots. */
function inkExtent() {
  const el = host!.querySelector('canvas.lower-canvas') as HTMLCanvasElement
  const ctx = el.getContext('2d', { willReadFrequently: true })!
  const { width: w, height: h } = el
  const d = ctx.getImageData(0, 0, w, h).data
  let min = Infinity
  let max = -Infinity
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (d[i + 3] > 128 && d[i] < 128) {
        if (x < min) min = x
        if (x > max) max = x
      }
    }
  }
  return { left: min / ZOOM, right: (max + 1) / ZOOM, centre: (min + max + 1) / 2 / ZOOM }
}

type Probe = Textbox & {
  _getCursorBoundaries(index?: number, skipCaching?: boolean): { left: number; leftOffset: number }
}

/** Where the caret would be drawn for a character index, in scene dots. */
function caretAt(text: Probe, index: number) {
  const boxLeft = Math.min(...text.getCoords().map((p) => p.x))
  const b = text._getCursorBoundaries(index, true)
  return boxLeft + text.width / 2 + b.left + b.leftOffset
}

describe('centred text', () => {
  it('paints the glyphs on the middle of the box', async () => {
    await mount(docWithText('center'))
    const ink = inkExtent()
    // A dot of slack: a glyph's side bearings are not symmetric, so the inked
    // pixels are never exactly centred even when the layout is. What this rules out
    // is the misplacement a stale measurement causes, which is a good many dots.
    expect(Math.abs(ink.centre - mmToDots(BOX.x + BOX.widthMm / 2))).toBeLessThan(1)
  })

  it('leaves equal margins either side', async () => {
    // The same claim from the other direction, and the one a user actually sees:
    // whatever is left over is shared evenly rather than piling up on one side.
    await mount(docWithText('center'))
    const ink = inkExtent()
    const before = ink.left - mmToDots(BOX.x)
    const after = mmToDots(BOX.x + BOX.widthMm) - ink.right
    expect(Math.abs(before - after)).toBeLessThan(2)
  })

  it('puts the caret on the glyphs rather than beside them', async () => {
    const text = (await mount(docWithText('center'))) as Probe
    await act(async () => {
      text.enterEditing()
    })
    const ink = inkExtent()
    const start = caretAt(text, 0)
    const end = caretAt(text, TEXT.length)
    await act(async () => {
      text.exitEditing()
    })

    // The caret before the first character belongs at the first glyph, and after
    // the last one at the end of the word. A couple of dots of slack, because a
    // caret sits on the advance while ink stops at the side bearing — and because
    // that difference is the thing being distinguished from a stale-metrics gap,
    // which is far larger.
    expect(Math.abs(start - ink.left)).toBeLessThan(2)
    expect(Math.abs(end - start - (ink.right - ink.left))).toBeLessThan(3)
  })
})

describe('font metrics', () => {
  it('asks for the document\u2019s fonts before it builds anything', async () => {
    // The fix for both bugs above, asserted where it can actually be observed.
    //
    // Fabric caches a string's width when the object is built, so the build has to
    // happen after the face is in. The rasteriser has always done this; the editor
    // did not, which is why the two could paint the same label differently and why
    // centred text drifted once the print preview pulled the font in.
    const original = document.fonts.load.bind(document.fonts)
    const asked: string[] = []
    let builtBeforeLoad = false
    document.fonts.load = ((spec: string, text?: string) => {
      asked.push(spec)
      return original(spec, text)
    }) as typeof document.fonts.load

    try {
      const before = asked.length
      const text = await mount(docWithText('center'))
      builtBeforeLoad = asked.length === before
      expect(text).toBeTruthy()
    } finally {
      document.fonts.load = original
    }

    expect(builtBeforeLoad, 'the editor built objects without asking for fonts').toBe(false)
    expect(asked.some((spec) => spec.includes('Fira Sans'))).toBe(true)
  })

  it('measures what a loaded face measures', async () => {
    // The consequence: what the editor built agrees with a measurement taken with
    // the face definitely present. Any gap here is the gap that shows on screen.
    const spec = `${Math.round(ptToDots(10))}px 'Fira Sans'`
    await document.fonts.load(spec, TEXT)
    const loaded = new Textbox(TEXT, {
      width: mmToDots(BOX.widthMm),
      fontSize: ptToDots(10),
      fontFamily: 'Fira Sans',
      textAlign: 'center',
    }).getLineWidth(0)

    const text = await mount(docWithText('center'))
    expect(text.getLineWidth(0)).toBeCloseTo(loaded, 1)
  })
})
