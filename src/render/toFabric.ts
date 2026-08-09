import { Ellipse, FabricImage, Line, Rect, Textbox, type FabricObject } from 'fabric'
import { mmToDots, ptToDots } from '../model/units'
import type {
  BarcodeElement,
  IconElement,
  ImageElement,
  LabelElement,
  QrElement,
  ShapeElement,
  TextElement,
} from '../model/labelDoc'
import { renderCode } from './barcode'
import { findIcon, iconToDataUrl } from './icons'

/** Resolves an image asset id to a URL the browser can load. */
export type AssetResolver = (assetId: string) => Promise<string>

export interface RenderContext {
  resolveAsset?: AssetResolver
}

/**
 * The single translation from document elements to Fabric objects.
 *
 * The interactive editor and the print rasteriser both go through this function,
 * which is the whole reason the preview can be trusted: there is no second code
 * path that could drift. The editor displays the same objects at a canvas zoom;
 * the rasteriser renders them at zoom 1, where one canvas unit is one printer dot.
 *
 * Ink is always black. A thermal head has one colour, and letting users pick
 * others would only produce greys that threshold unpredictably.
 */
const INK = '#000000'

/** Elements not yet implemented render as nothing rather than breaking the page. */
export class UnsupportedElementError extends Error {
  constructor(kind: string) {
    super(`Element kind "${kind}" cannot be rendered by this build.`)
    this.name = 'UnsupportedElementError'
  }
}

export async function toFabricObject(
  element: LabelElement,
  context: RenderContext = {},
): Promise<FabricObject | null> {
  switch (element.kind) {
    case 'text':
      return textToFabric(element)
    case 'shape':
      return shapeToFabric(element)
    case 'barcode':
    case 'qr':
      return codeToFabric(element)
    case 'icon':
      return iconToFabric(element)
    case 'image':
      return imageToFabric(element, context)
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Image could not be loaded.'))
    image.src = src
  })
}

async function iconToFabric(element: IconElement): Promise<FabricObject | null> {
  const icon = findIcon(element.iconId)
  if (!icon) return null
  const width = mmToDots(element.widthMm)
  const height = mmToDots(element.heightMm)
  const size = Math.max(1, Math.min(width, height))
  const image = await loadImage(iconToDataUrl(icon, size))
  return new FabricImage(image, {
    ...placement(element, width, height),
    scaleX: 1,
    scaleY: 1,
  })
}

/**
 * Images are drawn into an offscreen canvas at the exact dot size they will
 * occupy, rather than handed to Fabric and scaled.
 *
 * Doing the fit ourselves keeps line art on whole-pixel boundaries, and lets
 * each image carry its own threshold: line art is binarised right here, so by
 * the time the crisp plane is thresholded the pixels are already pure black or
 * white and the global setting cannot second-guess them. Photographs are left
 * in greyscale for the dithering stage.
 */
async function imageToFabric(
  element: ImageElement,
  context: RenderContext,
): Promise<FabricObject | null> {
  if (!context.resolveAsset) return null
  const source = await loadImage(await context.resolveAsset(element.assetId))

  const width = mmToDots(element.widthMm)
  const height = mmToDots(element.heightMm)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.imageSmoothingEnabled = element.mode === 'photo'

  const { dx, dy, dw, dh } = fitRect(source.width, source.height, width, height, element.fit)
  ctx.drawImage(source, dx, dy, dw, dh)

  const pixels = ctx.getImageData(0, 0, width, height)
  applyImageTone(pixels.data, element)
  ctx.putImageData(pixels, 0, 0)

  return new FabricImage(canvas, {
    ...placement(element, width, height),
    scaleX: 1,
    scaleY: 1,
    imageSmoothing: false,
  })
}

function fitRect(
  sourceWidth: number,
  sourceHeight: number,
  boxWidth: number,
  boxHeight: number,
  fit: ImageElement['fit'],
) {
  if (fit === 'stretch') return { dx: 0, dy: 0, dw: boxWidth, dh: boxHeight }
  const scale =
    fit === 'cover'
      ? Math.max(boxWidth / sourceWidth, boxHeight / sourceHeight)
      : Math.min(boxWidth / sourceWidth, boxHeight / sourceHeight)
  const dw = sourceWidth * scale
  const dh = sourceHeight * scale
  return { dx: (boxWidth - dw) / 2, dy: (boxHeight - dh) / 2, dw, dh }
}

function applyImageTone(data: Uint8ClampedArray, element: ImageElement): void {
  const level = element.threshold ?? 128
  for (let i = 0; i < data.length; i += 4) {
    // Leave untouched area transparent. With `contain` the letterbox bars would
    // otherwise become opaque white and mask out whatever sits beneath the
    // image, which is not what "fit inside this box" should mean.
    if (data[i + 3] === 0) continue
    const alpha = data[i + 3] / 255
    // Composite over white paper first, so transparency does not read as black.
    let luma =
      (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) * alpha + 255 * (1 - alpha)
    if (element.invert) luma = 255 - luma
    const value = element.mode === 'lineart' ? (luma <= level ? 0 : 255) : luma
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
    data[i + 3] = 255
  }
}

/**
 * Codes are placed at their natural rasterised size, never stretched to fill the
 * element box — see `barcode.ts` for why fractional module widths break scanning.
 * They are centred in the box instead, so resizing the element still feels like
 * it controls the code's size, in whole-module steps.
 */
function codeToFabric(element: BarcodeElement | QrElement): FabricObject {
  const boxWidth = mmToDots(element.widthMm)
  const boxHeight = mmToDots(element.heightMm)
  const { canvas } = renderCode(element, boxWidth, boxHeight)

  return new FabricImage(canvas, {
    // Centre placement handles the "code is smaller than its box" case for free.
    ...placement(element, boxWidth, boxHeight),
    // Any scaling here would defeat the integer-module work done upstream.
    scaleX: 1,
    scaleY: 1,
    imageSmoothing: false,
  })
}

/**
 * Geometry every element shares, in dots.
 *
 * Elements are positioned by their centre and rotate about it, so an element
 * spins in place. Rotating about the top-left corner instead — the other obvious
 * choice — swings the content clean out of its box: a 20 mm square turned 90°
 * lands entirely to the left of where it was, usually off the label. Since
 * turning text to run along a narrow label is a normal thing to want, rotation
 * has to leave the element where the user put it.
 *
 * The document keeps storing `x`/`y` as the unrotated top-left, which is what
 * people expect to type into a position field.
 */
function placement(element: LabelElement, widthDots: number, heightDots: number) {
  return {
    left: mmToDots(element.x) + widthDots / 2,
    top: mmToDots(element.y) + heightDots / 2,
    angle: element.rotation,
    originX: 'center' as const,
    originY: 'center' as const,
    objectCaching: false,
  }
}

function textToFabric(element: TextElement): Textbox {
  return new Textbox(element.text, {
    ...placement(element, mmToDots(element.widthMm), mmToDots(element.heightMm)),
    width: mmToDots(element.widthMm),
    fontSize: ptToDots(element.fontSizePt),
    fontFamily: element.fontFamily,
    fontWeight: element.bold ? 'bold' : 'normal',
    fontStyle: element.italic ? 'italic' : 'normal',
    textAlign: element.align,
    lineHeight: element.lineHeight ?? 1.16,
    fill: INK,
    // No stroke: a stroked glyph at 203 dpi thickens into an unreadable blob.
    strokeWidth: 0,
    splitByGrapheme: false,
  })
}

function shapeToFabric(element: ShapeElement): FabricObject {
  const width = mmToDots(element.widthMm)
  const height = mmToDots(element.heightMm)
  // A stroke thinner than one dot would vanish entirely once thresholded.
  const strokeWidth = Math.max(1, mmToDots(element.strokeMm))
  const common = {
    ...placement(element, width, height),
    fill: element.filled ? INK : 'transparent',
    stroke: element.filled ? undefined : INK,
    strokeWidth: element.filled ? 0 : strokeWidth,
    strokeUniform: true,
  }

  switch (element.shape) {
    case 'rect':
      return new Rect({
        ...common,
        width,
        height,
        rx: element.radiusMm ? mmToDots(element.radiusMm) : 0,
        ry: element.radiusMm ? mmToDots(element.radiusMm) : 0,
      })
    case 'ellipse':
      return new Ellipse({ ...common, rx: width / 2, ry: height / 2 })
    case 'line':
      return new Line([0, 0, width, height], {
        ...placement(element, width, height),
        stroke: INK,
        strokeWidth,
        strokeUniform: true,
      })
  }
}
