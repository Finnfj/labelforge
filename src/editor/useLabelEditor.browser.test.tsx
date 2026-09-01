import { beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  elementsInDrawOrder,
  type DraftElement,
  type LabelElement,
  type TextElement,
} from '../model/labelDoc'
import { useLabelEditor, type LabelEditor } from './useLabelEditor'

/**
 * The document operations the toolbar and the keyboard both drive.
 *
 * A browser test rather than a unit one only because the state lives in a hook. The
 * behaviour under test is all document logic: what a paste lands on, what a cut
 * leaves behind, and what happens at the ends of the draw order.
 */

let api: LabelEditor
let root: Root | null = null
let host: HTMLDivElement | null = null

function Harness() {
  api = useLabelEditor()
  return null
}

beforeEach(async () => {
  // The hook restores an autosave, so a leftover document from another test — or
  // from opening the app in this browser profile — would decide what these assert.
  localStorage.clear()
  host?.remove()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root!.render(<Harness />)
  })
})

const TEXT: DraftElement = {
  kind: 'text',
  text: 'Text',
  fontFamily: 'Fira Sans',
  fontSizePt: 10,
  align: 'left',
  x: 4,
  y: 6,
  widthMm: 24,
  heightMm: 6,
  rotation: 0,
} as DraftElement

const run = async (fn: () => void) => {
  await act(async () => {
    fn()
  })
}
const add = async (patch: Partial<DraftElement> = {}) => {
  let id = ''
  await run(() => {
    id = api.addElement({ ...TEXT, ...patch } as DraftElement)
  })
  return id
}
const byId = (id: string) => api.doc.elements.find((e) => e.id === id) as LabelElement
/** Every element these tests add is text, so narrowing here keeps the cast in one place. */
const textOf = (id: string) => (byId(id) as TextElement).text

describe('clipboard', () => {
  it('offers nothing to paste until something is copied', async () => {
    expect(api.canPaste).toBe(false)
    await add()
    await run(() => api.copySelected())
    expect(api.canPaste).toBe(true)
  })

  it('copies without touching the original', async () => {
    const id = await add()
    await run(() => api.copySelected())
    await run(() => api.paste())

    expect(api.doc.elements).toHaveLength(2)
    expect(byId(id).x).toBe(4)
    expect(byId(id).y).toBe(6)
  })

  it('offsets the pasted copy so it does not hide the original', async () => {
    await add()
    await run(() => api.copySelected())
    await run(() => api.paste())

    const pasted = byId(api.selectedId!)
    expect(pasted.x).toBe(6)
    expect(pasted.y).toBe(8)
    expect(textOf(pasted.id)).toBe('Text')
  })

  it('selects what it pasted, so the next action is about the copy', async () => {
    const id = await add()
    await run(() => api.copySelected())
    await run(() => api.paste())
    expect(api.selectedId).not.toBe(id)
    expect(api.selected?.id).toBe(api.selectedId)
  })

  it('puts the copy on top of the stack', async () => {
    await add()
    const other = await add({ y: 20 })
    await run(() => api.select(other))
    await run(() => api.copySelected())
    await run(() => api.paste())
    expect(elementsInDrawOrder(api.doc).at(-1)!.id).toBe(api.selectedId)
  })

  it('cascades repeated pastes instead of stacking them', async () => {
    // Three pastes of one copy should step away from the original, not land on top
    // of each other where the second and third are invisible.
    await add()
    await run(() => api.copySelected())
    const xs: number[] = []
    for (let i = 0; i < 3; i++) {
      await run(() => api.paste())
      xs.push(byId(api.selectedId!).x)
    }
    expect(xs).toEqual([6, 8, 10])
  })

  it('measures the cascade from the original, not from the last paste', async () => {
    // Undoing in the middle of a run must not shift where the next paste lands,
    // which is why the offset counts pastes rather than reading the last one.
    await add()
    await run(() => api.copySelected())
    await run(() => api.paste())
    await run(() => api.undo())
    await run(() => api.paste())
    expect(byId(api.selectedId!).x).toBe(8)
  })

  it('starts a fresh cascade on the next copy', async () => {
    await add()
    await run(() => api.copySelected())
    await run(() => api.paste())
    await run(() => api.paste())
    await run(() => api.select(api.doc.elements[0].id))
    await run(() => api.copySelected())
    await run(() => api.paste())
    expect(byId(api.selectedId!).x).toBe(6)
  })

  it('cuts the element away and pastes it back', async () => {
    const id = await add()
    await run(() => api.cutSelected())
    expect(api.doc.elements).toHaveLength(0)
    expect(api.selectedId).toBeNull()

    await run(() => api.paste())
    expect(api.doc.elements).toHaveLength(1)
    expect(textOf(api.selectedId!)).toBe('Text')
    expect(api.selectedId).not.toBe(id)
  })

  it('undoes a cut as one step', async () => {
    await add()
    await run(() => api.cutSelected())
    await run(() => api.undo())
    expect(api.doc.elements).toHaveLength(1)
  })

  it('ignores copy and cut with nothing selected', async () => {
    await add()
    await run(() => api.select(null))
    await run(() => api.copySelected())
    await run(() => api.cutSelected())
    expect(api.canPaste).toBe(false)
    expect(api.doc.elements).toHaveLength(1)
  })
})

describe('layering', () => {
  it('steps the selection towards the front and back', async () => {
    const first = await add()
    const second = await add({ y: 20 })
    expect(elementsInDrawOrder(api.doc).map((e) => e.id)).toEqual([first, second])

    await run(() => api.select(first))
    await run(() => api.raiseSelected())
    expect(elementsInDrawOrder(api.doc).map((e) => e.id)).toEqual([second, first])

    await run(() => api.lowerSelected())
    expect(elementsInDrawOrder(api.doc).map((e) => e.id)).toEqual([first, second])
  })

  it('costs no undo step at the end of the stack', async () => {
    // Otherwise Forward on the topmost element banks a history entry, and the undo
    // that should have removed the second element instead restores an identical
    // document — which reads as undo being broken.
    await add()
    const top = await add({ y: 20 })
    await run(() => api.select(top))
    await run(() => api.raiseSelected())

    await run(() => api.undo())
    expect(api.doc.elements, 'undo landed on a no-op step').toHaveLength(1)
  })

  it('does nothing with no selection', async () => {
    await add()
    await run(() => api.select(null))
    await run(() => api.raiseSelected())
    expect(api.doc.elements).toHaveLength(1)
  })
})
