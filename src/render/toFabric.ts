import { Ellipse, Line, Rect, Textbox, type FabricObject } from 'fabric'
import { mmToDots, ptToDots } from '../model/units'
import type { LabelElement, ShapeElement, TextElement } from '../model/labelDoc'

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
    default:
      return null
  }
}

/** Geometry every element shares, in dots. */
function placement(element: LabelElement) {
  return {
    left: mmToDots(element.x),
    top: mmToDots(element.y),
    angle: element.rotation,
    // Rotate about the top-left corner so a rotation never moves the anchor the
    // user positioned; rotating about the centre makes nudging angles feel like
    // the element is also drifting.
    originX: 'left' as const,
    originY: 'top' as const,
    objectCaching: false,
  }
}

function textToFabric(element: TextElement): Textbox {
  return new Textbox(element.text, {
    ...placement(element),
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
    ...placement(element),
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
        ...placement(element),
        stroke: INK,
        strokeWidth,
        strokeUniform: true,
      })
  }
}
