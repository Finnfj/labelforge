import { Ellipse, FabricImage, Line, Rect, Textbox, type FabricObject } from 'fabric'
import { mmToDots, ptToDots } from '../model/units'
import type {
  BarcodeElement,
  LabelElement,
  QrElement,
  ShapeElement,
  TextElement,
} from '../model/labelDoc'
import { renderCode } from './barcode'

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

export async function toFabricObject(element: LabelElement): Promise<FabricObject | null> {
  switch (element.kind) {
    case 'text':
      return textToFabric(element)
    case 'shape':
      return shapeToFabric(element)
    case 'barcode':
    case 'qr':
      return codeToFabric(element)
    default:
      return null
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
