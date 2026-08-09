import { StaticCanvas, type FabricObject } from 'fabric'
import { elementsInDrawOrder, isToneElement, type LabelDoc } from '../model/labelDoc'
import { mmToDots } from '../model/units'
import type { PackedBitmap } from '../model/bitmap'
import { toFabricObject, type AssetResolver } from './toFabric'
import { toAlphaMask, toLuminance } from './luminance'
import { threshold } from './threshold'
import { floydSteinberg } from './dither'
import { composite } from './composite'
import { pack1bpp } from './pack1bpp'
import { padToHead, type HeadAlign } from './padToHead'

export interface RasterizeOptions {
  /** Pad the result out to the head width. Omit to get a label-sized bitmap. */
  headWidthDots?: number
  align?: HeadAlign
  offsetDots?: number
  /** Resolves image assets. Omit and image elements are skipped. */
  resolveAsset?: AssetResolver
  /** Threshold for the crisp plane, 0–255. */
  thresholdLevel?: number
}

export interface RasterizeResult {
  bitmap: PackedBitmap
  labelWidthDots: number
  labelHeightDots: number
}

/**
 * Turn a document into the exact bitmap the printer will receive.
 *
 * Elements are rendered onto two separate transparent planes and binarised
 * differently: photographs get error diffusion so they read as tone, everything
 * else gets a hard threshold so edges stay sharp. They are then merged by the
 * crisp plane's own alpha coverage rather than OR-ed, so crisp content owns its
 * pixels outright — see `composite.ts`.
 */
export async function rasterize(
  doc: LabelDoc,
  options: RasterizeOptions = {},
): Promise<RasterizeResult> {
  const widthDots = mmToDots(doc.size.widthMm)
  const heightDots = mmToDots(doc.size.heightMm)

  // Web fonts that have not finished loading would silently rasterise in a
  // fallback face, producing a label that does not match what was designed.
  if (typeof document !== 'undefined' && document.fonts) await document.fonts.ready

  const crispObjects: FabricObject[] = []
  const toneObjects: FabricObject[] = []
  for (const element of elementsInDrawOrder(doc)) {
    const object = await toFabricObject(element, { resolveAsset: options.resolveAsset })
    if (!object) continue
    ;(isToneElement(element) ? toneObjects : crispObjects).push(object)
  }

  const crisp = renderPlane(crispObjects, widthDots, heightDots)
  const tone = renderPlane(toneObjects, widthDots, heightDots)

  const pixels = widthDots * heightDots
  const crispBits = threshold(toLuminance(crisp, pixels), options.thresholdLevel ?? 128)
  const crispMask = toAlphaMask(crisp, pixels)
  const toneBits = toneObjects.length
    ? floydSteinberg(toLuminance(tone, pixels), widthDots, heightDots)
    : new Uint8Array(pixels)

  const merged = composite(crispBits, crispMask, toneBits)
  let bitmap = pack1bpp(merged, widthDots, heightDots)

  if (options.headWidthDots) {
    bitmap = padToHead(bitmap, options.headWidthDots, options.align ?? 'left', options.offsetDots ?? 0)
  }

  return { bitmap, labelWidthDots: widthDots, labelHeightDots: heightDots }
}

/** Render objects to a transparent canvas at exactly one canvas unit per dot. */
function renderPlane(
  objects: readonly object[],
  widthDots: number,
  heightDots: number,
): Uint8ClampedArray {
  const canvas = new StaticCanvas(undefined, {
    width: widthDots,
    height: heightDots,
    renderOnAddRemove: false,
    // Device pixel ratio must not leak into the output buffer: on a HiDPI screen
    // Fabric would otherwise render at 2x and every dot coordinate would double.
    enableRetinaScaling: false,
    backgroundColor: undefined,
  })

  for (const object of objects) canvas.add(object as never)
  canvas.renderAll()

  const element = canvas.getElement()
  const ctx = element.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  const data = ctx.getImageData(0, 0, widthDots, heightDots).data
  canvas.dispose()
  return data
}
