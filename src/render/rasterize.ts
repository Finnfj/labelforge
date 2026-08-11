import { StaticCanvas, type FabricObject } from 'fabric'
import { elementsInDrawOrder, isToneElement, type LabelDoc } from '../model/labelDoc'
import { mmToDots } from '../model/units'
import { appendBlankRows, type PackedBitmap } from '../model/bitmap'
import { toFabricObject, type AssetResolver } from './toFabric'
import { toAlphaMask, toLuminance } from './luminance'
import { threshold } from './threshold'
import { floydSteinberg } from './dither'
import { composite } from './composite'
import { pack1bpp } from './pack1bpp'
import { padToHead, type HeadAlign } from './padToHead'

export interface RasterizeOptions {
  /**
   * Pad the result out to this width and position the label within it.
   *
   * Omit for a label-sized bitmap, which is what the vendor app sends and now the
   * default: for a 40 mm label it transmits 320 dots and lets the printer place
   * them. Set it only to address a specific head column.
   */
  headWidthDots?: number
  /**
   * Widest raster the head can print, used purely as a limit.
   *
   * Separate from {@link headWidthDots} because "how wide the head is" and "pad out
   * to the head" stopped being the same question once padding became optional.
   */
  maxWidthDots?: number
  align?: HeadAlign
  offsetDots?: number
  /** Resolves image assets. Omit and image elements are skipped. */
  resolveAsset?: AssetResolver
  /** Threshold for the crisp plane, 0–255. */
  thresholdLevel?: number
  /** Supersampling factor for the crisp plane. 1 disables it. */
  supersample?: number
  /** Crop rather than fail when the label is wider than the head. */
  clipToHead?: boolean
  /**
   * Blank rows appended below the label, to advance into the inter-label gap.
   *
   * Applied here rather than at send time so the preview shows the whole raster
   * the printer receives, feed strip included.
   */
  feedAfterDots?: number
}

/**
 * Render the crisp plane at 3× and average down before thresholding.
 *
 * Since ink is pure black, thresholding the white-composited luminance at 128 is
 * really thresholding coverage at 50% — so the quality of the result depends
 * entirely on how good the coverage estimate is. Rasterising a glyph at 3× and
 * box-averaging gives a truer estimate than asking the browser for it at 203 dpi,
 * where font hinting distorts stems to fit a pixel grid that has nothing to do
 * with the print head.
 *
 * 3 rather than 2 or 4: it is odd, so a stem centred on a dot stays centred, and
 * it costs 9× the pixels of a plane that is only a few hundred dots across.
 */
const CRISP_SUPERSAMPLE = 3

export interface RasterizeResult {
  bitmap: PackedBitmap
  labelWidthDots: number
  labelHeightDots: number
  /** True when content was cropped because the label exceeds the head width. */
  clipped: boolean
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

  const crisp = renderPlane(
    crispObjects,
    widthDots,
    heightDots,
    options.supersample ?? CRISP_SUPERSAMPLE,
  )
  // The tone plane gains nothing: error diffusion consumes the greyscale it is
  // given, and a supersampled average is the same greyscale at more cost.
  const tone = renderPlane(toneObjects, widthDots, heightDots, 1)

  const pixels = widthDots * heightDots
  const crispBits = threshold(toLuminance(crisp, pixels), options.thresholdLevel ?? 128)
  const crispMask = toAlphaMask(crisp, pixels)
  const toneBits = toneObjects.length
    ? floydSteinberg(toLuminance(tone, pixels), widthDots, heightDots)
    : new Uint8Array(pixels)

  const merged = composite(crispBits, crispMask, toneBits)
  let bitmap = pack1bpp(merged, widthDots, heightDots)

  const limit = options.maxWidthDots ?? options.headWidthDots
  const clipped = limit != null && widthDots > limit

  if (options.headWidthDots) {
    bitmap = padToHead(
      bitmap,
      options.headWidthDots,
      options.align ?? 'left',
      options.offsetDots ?? 0,
      { clip: options.clipToHead },
    )
  } else if (clipped) {
    // Not padding, but still too wide for the head. padToHead with a target
    // narrower than the source crops to it, which is what is wanted here — and it
    // throws unless clipping was asked for, same as the padding path.
    bitmap = padToHead(bitmap, limit, 'left', 0, { clip: options.clipToHead })
  }

  bitmap = appendBlankRows(bitmap, options.feedAfterDots ?? 0)

  return { bitmap, labelWidthDots: widthDots, labelHeightDots: heightDots, clipped }
}

/** Render objects to a transparent canvas, optionally supersampled. */
function renderPlane(
  objects: readonly object[],
  widthDots: number,
  heightDots: number,
  supersample = 1,
): Uint8ClampedArray {
  const scale = Math.max(1, Math.round(supersample))
  const canvas = new StaticCanvas(undefined, {
    width: widthDots * scale,
    height: heightDots * scale,
    renderOnAddRemove: false,
    // Device pixel ratio must not leak into the output buffer: on a HiDPI screen
    // Fabric would otherwise render at 2x and every dot coordinate would double.
    enableRetinaScaling: false,
    backgroundColor: undefined,
  })
  if (scale !== 1) canvas.setZoom(scale)

  for (const object of objects) canvas.add(object as never)
  canvas.renderAll()

  const element = canvas.getElement()
  const ctx = element.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable')
  const data = ctx.getImageData(0, 0, widthDots * scale, heightDots * scale).data
  canvas.dispose()

  return scale === 1 ? data : boxDownsample(data, widthDots, heightDots, scale)
}

/**
 * Average a supersampled plane back down to one sample per dot.
 *
 * Colour is averaged in premultiplied space and then un-premultiplied, so a dot
 * that is mostly transparent does not have its colour dragged toward the black
 * of a neighbouring covered sample.
 */
function boxDownsample(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  scale: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4)
  const srcWidth = width * scale
  const samples = scale * scale

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < scale; sy++) {
        const row = (y * scale + sy) * srcWidth
        for (let sx = 0; sx < scale; sx++) {
          const i = (row + x * scale + sx) * 4
          const alpha = src[i + 3]
          r += src[i] * alpha
          g += src[i + 1] * alpha
          b += src[i + 2] * alpha
          a += alpha
        }
      }
      const o = (y * width + x) * 4
      if (a > 0) {
        out[o] = r / a
        out[o + 1] = g / a
        out[o + 2] = b / a
      }
      out[o + 3] = a / samples
    }
  }
  return out
}
