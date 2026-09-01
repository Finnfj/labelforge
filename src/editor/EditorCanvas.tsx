import { useEffect, useRef, useState } from 'react'
import { Canvas, type FabricObject } from 'fabric'
import type { BarcodeElement, ElementPatch, LabelDoc, TextElement } from '../model/labelDoc'
import { elementsInDrawOrder } from '../model/labelDoc'
import { dotsToMm, dotsToPt, mmToDots, ptToDots } from '../model/units'
import { ensureDocumentFonts } from '../render/fonts'
import { toFabricObject, type AssetResolver } from '../render/toFabric'

/** Fabric objects carry the id of the document element they represent. */
type TaggedObject = FabricObject & { elementId?: string }

export interface EditorCanvasProps {
  doc: LabelDoc
  selectedId: string | null
  zoom: number
  /**
   * Show the label turned a quarter turn, so a tall label can be worked on across
   * a wide screen.
   *
   * A property of the view and nothing else. The document keeps its dimensions and
   * every element keeps its coordinates, so the raster, the preview and the print
   * are bit-for-bit what they would have been — see the effect that applies it.
   */
  turned?: boolean
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
  turned = false,
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
      // Without this Fabric sets `touch-action: none` on its canvases and calls
      // preventDefault on every touchmove, so on a phone a zoomed label could not
      // be panned at all: the drag that should scroll the stage was swallowed by
      // a canvas that had nothing to do with it. With it, Fabric only suppresses
      // scrolling when the touch starts on the *already-active* object — so the
      // gesture becomes tap to select, then drag to move, and a drag anywhere
      // else scrolls. That is the standard mobile bargain and the right one here.
      allowTouchScrolling: true,
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
    // The rebuild that follows is what makes a resize stick. Fabric raises this on
    // gesture end, and the rebuild restores the active object, so nothing is
    // interrupted and no selection is lost.
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

  const shownWidth = (turned ? heightDots : widthDots) * zoom
  const shownHeight = (turned ? widthDots : heightDots) * zoom

  /**
   * Scale and, when asked for, a quarter turn — both as Fabric's viewport transform.
   *
   * The turn lives here rather than in a CSS `rotate()` on the canvas, and that is
   * the whole reason this works. Fabric maps a pointer into scene coordinates by
   * inverting this matrix, so dragging, resizing and the selection handles all come
   * out right for free. A CSS transform is invisible to that arithmetic — Fabric
   * measures the element's axis-aligned bounding box and would put every pointer in
   * the wrong place.
   *
   * It also keeps the turn out of the document. Objects stay at the coordinates the
   * elements give them, `readGeometry` reads scene coordinates back, and nothing
   * downstream of the editor can tell the canvas was turned.
   *
   * The matrix is [a, b, c, d, e, f] for x' = ax + cy + e, y' = bx + dy + f. A
   * quarter turn clockwise sends (x, y) to (h - y, x), scaled, which puts the label
   * in the top-left corner of a canvas whose width and height have swapped.
   */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setDimensions({ width: shownWidth, height: shownHeight })
    canvas.setViewportTransform(
      turned ? [0, zoom, -zoom, 0, shownWidth, 0] : [zoom, 0, 0, zoom, 0, 0],
    )
    canvas.requestRenderAll()
  }, [shownWidth, shownHeight, turned, zoom, epoch])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Rebuilding mid-typing would tear Fabric's hidden textarea out from under the
    // caret, so an open editing session suppresses it — the canvas already shows
    // what the user typed, and `text:editing:exited` triggers a rebuild on the way
    // out. Asking Fabric whether a session is open, rather than latching a flag
    // when one starts, is deliberate: the latch this replaces was cleared by
    // exactly one effect run, so two `text:changed` events batched into a single
    // React render left it set and silently swallowed the *following* edit.
    if (canvas.getObjects().some((object) => (object as { isEditing?: boolean }).isEditing)) {
      return
    }

    let cancelled = false
    void (async () => {
      // Fonts first, exactly as the rasteriser does it, and for the same reason
      // spelled out in render/fonts.ts: naming a family on a canvas neither starts
      // a load nor redraws when one finishes. Fabric measures a string once, when
      // the object is built, so building against an unloaded face caches the
      // *fallback* metrics — and then the real face arrives, the glyphs are painted
      // in it, and every offset computed from that cache is wrong.
      //
      // Left-aligned text hides it, starting at offset zero either way. Centred
      // text puts half the error on the left of every line, and the caret, placed
      // from the same stale advances, sits away from the words it is inside.
      //
      // Awaited before the loop rather than per element: it is one call for the
      // whole document, and it resolves immediately once the faces are in.
      await ensureDocumentFonts(doc)
      if (cancelled || canvasRef.current !== canvas) return

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
      style={{ width: shownWidth, height: shownHeight }}
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

  if (element?.kind === 'barcode' || element?.kind === 'qr') {
    // A code's box is the user's too, and for the same reason as text: it is a
    // frame the code is drawn inside, not a measurement of the code. The canvas
    // is the size of the box now (see `renderCode`), so this is not correcting a
    // mismatch — it is keeping the declared millimetres out of a round trip
    // through whole dots, which truncates anything finer than an eighth of a
    // millimetre, and keeping a code that will not fit its box from writing its
    // overflowing size over the box on the first drag.
    ;(patch as Partial<BarcodeElement>).widthMm = element.widthMm * (object.scaleX ?? 1)
    ;(patch as Partial<BarcodeElement>).heightMm = element.heightMm * scaleY
  }

  if (element?.kind === 'text') {
    // A text element's height is a box the user set, not a measurement of the
    // glyphs, so only a deliberate vertical resize may change it — a drag must
    // hand it back exactly as it came. The declared value is scaled rather than
    // re-read from the object for two reasons: millimetres round to whole dots on
    // the way out, so a round trip through `dotsToMm` quietly truncates anything
    // that is not a multiple of an eighth of a millimetre; and the document must
    // not depend on Fabric agreeing about the height at all, which it owns and
    // recomputes from the content (see `BoxedTextbox` in render/toFabric.ts).
    const text = element as TextElement
    ;(patch as Partial<TextElement>).heightMm = text.heightMm * scaleY
    if (scaleY !== 1) {
      // A vertical resize is a font-size change: the box and the type in it grow
      // together, which is what dragging the handle looks like it is doing.
      ;(patch as Partial<TextElement>).fontSizePt = dotsToPt(ptToDots(text.fontSizePt) * scaleY)
    }
  }

  // The scale is deliberately *not* reset here. This object is about to be replaced
  // by a fresh one built from the patched document, so resetting achieves nothing —
  // and if a rebuild is ever skipped, an object at scale 1 with its old intrinsic
  // size is drawn at the pre-resize size, which is the spring-back this had caused.
  // Sizing also cannot be reset uniformly: an Ellipse carries rx/ry, a Line its
  // points, and an image has no size but its scale.
  return patch
}
