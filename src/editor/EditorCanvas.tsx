import { useEffect, useRef, useState } from 'react'
import { Canvas, type FabricObject } from 'fabric'
import type { ElementPatch, LabelDoc, TextElement } from '../model/labelDoc'
import { elementsInDrawOrder } from '../model/labelDoc'
import { dotsToMm, dotsToPt, mmToDots, ptToDots } from '../model/units'
import { toFabricObject } from '../render/toFabric'

/** Fabric objects carry the id of the document element they represent. */
type TaggedObject = FabricObject & { elementId?: string }

export interface EditorCanvasProps {
  doc: LabelDoc
  selectedId: string | null
  zoom: number
  onSelect(id: string | null): void
  onUpdate(id: string, patch: ElementPatch): void
}

export function EditorCanvas({ doc, selectedId, zoom, onSelect, onUpdate }: EditorCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<Canvas | null>(null)
  const [epoch, setEpoch] = useState(0)

  /**
   * Handlers are read through a ref so the canvas is built exactly once. Wiring
   * them as effect dependencies would tear down and rebuild the canvas on every
   * render, which loses the selection and cancels any drag in progress.
   */
  const handlers = useRef({ doc, onSelect, onUpdate })
  handlers.current = { doc, onSelect, onUpdate }

  /**
   * Set while a canvas-originated edit propagates into the document, so the
   * rebuild effect can skip that round trip — the canvas already shows the
   * result, and rebuilding mid-gesture would drop the user's selection.
   */
  const fromCanvas = useRef(false)

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

    const selectionChanged = () => {
      const active = canvas.getActiveObject() as TaggedObject | undefined
      handlers.current.onSelect(active?.elementId ?? null)
    }
    canvas.on('selection:created', selectionChanged)
    canvas.on('selection:updated', selectionChanged)
    canvas.on('selection:cleared', () => handlers.current.onSelect(null))
    canvas.on('object:modified', (event) => {
      const object = event.target as TaggedObject | undefined
      if (!object?.elementId) return
      fromCanvas.current = true
      handlers.current.onUpdate(object.elementId, readGeometry(object, handlers.current.doc))
    })

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
    if (fromCanvas.current) {
      fromCanvas.current = false
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
          object = (await toFabricObject(element)) as TaggedObject | null
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
  }, [doc, selectedId, epoch])

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

  object.set({ scaleX: 1, scaleY: 1 })
  return patch
}
