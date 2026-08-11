import { useEffect, useRef, useState } from 'react'
import { Canvas, type FabricObject } from 'fabric'
import type { ElementPatch, LabelDoc, TextElement } from '../model/labelDoc'
import { elementsInDrawOrder } from '../model/labelDoc'
import { dotsToMm, dotsToPt, mmToDots, ptToDots } from '../model/units'
import { toFabricObject, type AssetResolver } from '../render/toFabric'

/** Fabric objects carry the id of the document element they represent. */
type TaggedObject = FabricObject & { elementId?: string }

export interface EditorCanvasProps {
  doc: LabelDoc
  selectedId: string | null
  zoom: number
  onSelect(id: string | null): void
  onUpdate(id: string, patch: ElementPatch, options?: { transient?: boolean }): void
  resolveAsset?: AssetResolver
  /** Called with the Fabric instance once it exists. Used by tests. */
  onReady?(canvas: Canvas): void
}

export function EditorCanvas({
  doc,
  selectedId,
  zoom,
  onSelect,
  onUpdate,
  resolveAsset,
  onReady,
}: EditorCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const [epoch, setEpoch] = useState(0)

  /**
   * Handlers are read through a ref so the canvas is built exactly once. Wiring
   * them as effect dependencies would tear down and rebuild the canvas on every
   * render, which loses the selection and cancels any drag in progress.
   */
  const handlers = useRef({ doc, onSelect, onUpdate, onReady })
  handlers.current = { doc, onSelect, onUpdate, onReady }

  /**
   * Set while an *in-progress text edit* propagates into the document, so the
   * rebuild effect skips that round trip.
   *
   * Narrowly scoped on purpose. Rebuilding while Fabric has a live editing session
   * open would tear the textarea out from under the caret, so keystrokes must not
   * trigger one. Everything else — moves, resizes, rotations — *must* rebuild, so
   * that what is on the canvas is always what is in the document.
   *
   * This used to cover geometry too, and that was the resize bug: `readGeometry`
   * folds Fabric's scale factor into an intrinsic size and resets the scale, so
   * suppressing the rebuild left the object drawn at its pre-resize size while the
   * document already held the new one. It sprang back, then corrected itself as
   * soon as any unrelated change forced a rebuild.
   */
  const editingText = useRef(false)

  const widthDots = mmToDots(doc.size.widthMm)
  const heightDots = mmToDots(doc.size.heightMm)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    // Each Fabric instance gets its own mount point, not a shared element from
    // JSX. Fabric's dispose() is asynchronous and it wraps the element it was
    // given in a container of its own; under StrictMode's double-invoked effects
    // the first instance's teardown would otherwise land *after* the second had
    // wrapped that same element, leaving a canvas that renders nothing. Owning a
    // whole subtree per instance makes teardown unambiguous.
    const mount = document.createElement('div')
    const element = document.createElement('canvas')
    mount.appendChild(element)
    host.appendChild(mount)

    const canvas = new Canvas(element, {
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
      selection: false,
      enableRetinaScaling: false,
    })
    canvasRef.current = canvas
    setEpoch((e) => e + 1)
    handlers.current.onReady?.(canvas)

    const selectionChanged = () => {
      const active = canvas.getActiveObject() as TaggedObject | undefined
      handlers.current.onSelect(active?.elementId ?? null)
    }
    canvas.on('selection:created', selectionChanged)
    canvas.on('selection:updated', selectionChanged)
    canvas.on('selection:cleared', () => handlers.current.onSelect(null))
    // Deliberately does not set `editingText`: the rebuild that follows is what
    // makes the resize stick. Fabric raises this on gesture end, and the rebuild
    // restores the active object, so nothing is interrupted and no selection lost.
    canvas.on('object:modified', (event) => {
      const object = event.target as TaggedObject | undefined
      if (!object?.elementId) return
      handlers.current.onUpdate(object.elementId, readGeometry(object, handlers.current.doc))
    })

    // Editing text in place does not raise `object:modified` — Fabric reports it
    // through the editing lifecycle instead. Without these the typed text lives
    // only on the canvas and is discarded the next time the document rebuilds,
    // so it looks like edits are silently lost unless made in the Inspector.
    const readText = (event: { target?: unknown }, transient: boolean) => {
      const object = event.target as (TaggedObject & { text?: string }) | undefined
      if (!object?.elementId) return
      editingText.current = true
      handlers.current.onUpdate(object.elementId, { text: object.text ?? '' } as ElementPatch, {
        transient,
      })
    }
    // Keystrokes are transient so a sentence is one undo step, not thirty; the
    // commit happens when editing ends.
    canvas.on('text:changed', (event) => readText(event, true))
    canvas.on('text:editing:exited', (event) => readText(event, false))

    return () => {
      canvasRef.current = null
      void canvas.dispose().then(() => mount.remove())
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setDimensions({ width: widthDots * zoom, height: heightDots * zoom })
    canvas.setZoom(zoom)
    canvas.requestRenderAll()
  }, [widthDots, heightDots, zoom, epoch])

  useEffect(() => {
    if (editingText.current) {
      editingText.current = false
      return
    }
    const canvas = canvasRef.current
    if (!canvas) return

    let cancelled = false
    void (async () => {
      const built: TaggedObject[] = []
      for (const element of elementsInDrawOrder(doc)) {
        let object: TaggedObject | null = null
        try {
          object = (await toFabricObject(element, { resolveAsset })) as TaggedObject | null
        } catch {
          // A code whose value cannot be encoded (half-typed EAN, bad check
          // digit) must not blank the whole canvas while the user is still
          // typing. The Inspector reports the reason against that element.
          continue
        }
        if (!object) continue
        object.elementId = element.id
        object.set({ lockScalingFlip: true })
        if (element.locked) object.set({ selectable: false, evented: false })
        built.push(object)
      }
      if (cancelled || canvasRef.current !== canvas) return

      canvas.remove(...canvas.getObjects())
      for (const object of built) canvas.add(object)
      const active = built.find((o) => o.elementId === selectedId)
      if (active) canvas.setActiveObject(active)
      else canvas.discardActiveObject()
      canvas.requestRenderAll()
    })()

    return () => {
      cancelled = true
    }
  }, [doc, selectedId, epoch, resolveAsset])

  return (
    <div
      ref={hostRef}
      className="editor__paper"
      style={{ width: widthDots * zoom, height: heightDots * zoom }}
    />
  )
}

/**
 * Read a Fabric object's geometry back into document units.
 *
 * Fabric expresses a resize as a scale factor rather than a new size, which for
 * text would leave a 10 pt font "scaled to 2x" — visually right on screen but
 * meaningless once rasterised. So scale is folded into the intrinsic property
 * (font size, box size) and reset to 1, keeping the document canonical.
 */
function readGeometry(object: TaggedObject, doc: LabelDoc): ElementPatch {
  const element = doc.elements.find((e) => e.id === object.elementId)
  const scaleY = object.scaleY ?? 1

  // Objects are positioned by their centre (see `placement` in toFabric.ts), but
  // the document stores the unrotated top-left, so convert back.
  const width = object.getScaledWidth()
  const height = object.getScaledHeight()
  const patch = {
    x: dotsToMm((object.left ?? 0) - width / 2),
    y: dotsToMm((object.top ?? 0) - height / 2),
    widthMm: dotsToMm(width),
    heightMm: dotsToMm(height),
    rotation: object.angle ?? 0,
  } as ElementPatch

  if (element?.kind === 'text' && scaleY !== 1) {
    const current = (element as TextElement).fontSizePt
    ;(patch as Partial<TextElement>).fontSizePt = dotsToPt(ptToDots(current) * scaleY)
  }

  // The scale is deliberately *not* reset here. This object is about to be replaced
  // by a fresh one built from the patched document, so resetting achieves nothing —
  // and if a rebuild is ever skipped, an object at scale 1 with its old intrinsic
  // size is drawn at the pre-resize size, which is the spring-back this had caused.
  // Sizing also cannot be reset uniformly: an Ellipse carries rx/ry, a Line its
  // points, and an image has no size but its scale.
  return patch
}
