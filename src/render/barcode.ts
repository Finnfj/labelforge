import { toCanvas } from 'bwip-js/browser'
import type { BarcodeElement, QrElement } from '../model/labelDoc'

/**
 * Barcode and QR rasterisation.
 *
 * Two rules decide whether a printed code actually scans, and both are handled
 * here rather than left to the layout engine:
 *
 * 1. **Modules must be a whole number of dots.** A barcode scaled by 1.37 has
 *    module edges landing mid-dot; thresholding then widens some bars and
 *    narrows others, and the ratios a scanner measures stop matching the
 *    symbology. So we only ever scale by an integer and centre the result in the
 *    element's box rather than stretching to fill it.
 * 2. **Quiet zones are mandatory.** bwip-js emits the bare symbol with no margin
 *    — Code128 "ABC123" comes out exactly 101 modules wide, the symbol and
 *    nothing else — so the specified quiet zone is added here. Without it a code
 *    placed near other content, or near the label edge, silently fails to read.
 */

/** Measured from bwip-js: at scale 1, a `height` of 10 mm renders 29 px, 20 mm renders 58 px. */
const PX_PER_MM_AT_SCALE_1 = 2.9

/** Measured from bwip-js: `includetext` adds this many pixels at scale 1. */
const TEXT_PX_AT_SCALE_1 = 8

/** At scale 1 bwip-js draws 1 px per module for linear symbologies. */
const LINEAR_MODULE_PX_AT_SCALE_1 = 1

/** At scale 1 bwip-js draws 2 px per module for matrix symbologies. */
const MATRIX_MODULE_PX_AT_SCALE_1 = 2

/** Quiet zone in modules: 10 each side for linear codes, 4 for matrix codes. */
const LINEAR_QUIET_MODULES = 10
const MATRIX_QUIET_MODULES = 4

const MATRIX_SYMBOLOGIES = new Set(['datamatrix'])

export class BarcodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BarcodeError'
  }
}

export interface RenderedCode {
  canvas: HTMLCanvasElement
  /** Width of one module in printer dots. Below 2, scanning gets unreliable. */
  moduleDots: number
}

function bwipId(element: BarcodeElement | QrElement): string {
  if (element.kind === 'qr') return 'qrcode'
  return element.symbology === 'gs1-128' ? 'gs1-128' : element.symbology
}

function isMatrix(element: BarcodeElement | QrElement): boolean {
  return element.kind === 'qr' || MATRIX_SYMBOLOGIES.has(element.symbology)
}

function draw(options: Record<string, unknown>): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  try {
    // bwip-js writes defaults back into the options object it is handed —
    // including `scaleX`/`scaleY`, which take precedence over `scale`. Reusing
    // an object across calls therefore pins every later render to the first
    // call's scale, silently producing one-dot modules that will not scan. Pass
    // a fresh copy every time.
    toCanvas(canvas, { ...options } as never)
  } catch (error) {
    // bwip-js throws for content a symbology cannot encode — an EAN-13 with the
    // wrong digit count, a bad check digit, non-numeric input. Surface that as a
    // typed error so the editor can show it against the element.
    throw new BarcodeError(error instanceof Error ? error.message : String(error))
  }
  return canvas
}

/**
 * Render a code at the largest integer module width that fits the given box.
 *
 * The returned canvas is white-backed and includes the quiet zone, so it can be
 * composited directly without any further margin handling.
 */
export function renderCode(
  element: BarcodeElement | QrElement,
  boxWidthDots: number,
  boxHeightDots: number,
): RenderedCode {
  const matrix = isMatrix(element)
  const quietModules = matrix ? MATRIX_QUIET_MODULES : LINEAR_QUIET_MODULES
  const modulePxAt1 = matrix ? MATRIX_MODULE_PX_AT_SCALE_1 : LINEAR_MODULE_PX_AT_SCALE_1
  const quietPxAt1 = quietModules * modulePxAt1

  // Caught here rather than left to bwip-js, which reports it as "bar code text
  // not specified" — accurate, useless to the person who just cleared the field to
  // type a new URL, and the single easiest way to reach this error.
  if (element.value.trim() === '') {
    throw new BarcodeError(
      element.kind === 'qr'
        ? 'No value yet — type the text or URL for this QR code.'
        : 'No value yet — type the text or number for this barcode.',
    )
  }

  const baseOptions: Record<string, unknown> = {
    bcid: bwipId(element),
    text: element.value,
    scale: 1,
    monochrome: true,
  }
  if (element.kind === 'qr') baseOptions.eclevel = element.ecLevel
  if (element.kind === 'barcode') {
    baseOptions.includetext = element.showText
    baseOptions.height = 10
  }

  // Measure at scale 1, then pick the largest integer scale that still fits.
  const probe = draw(baseOptions)
  const naturalWidthAt1 = probe.width + 2 * quietPxAt1
  const scale = Math.max(1, Math.floor(boxWidthDots / naturalWidthAt1))

  const finalOptions: Record<string, unknown> = { ...baseOptions, scale }
  if (element.kind === 'barcode') {
    // Solve for the bar height in bwip-js millimetres that lands on the box
    // height in dots once scaled, leaving room for the human-readable text.
    const textPx = element.showText ? TEXT_PX_AT_SCALE_1 * scale : 0
    const barPx = Math.max(scale * 4, boxHeightDots - textPx)
    finalOptions.height = Math.max(1, barPx / (PX_PER_MM_AT_SCALE_1 * scale))
  }

  const symbol = draw(finalOptions)
  const quietPx = quietPxAt1 * scale

  const canvas = document.createElement('canvas')
  canvas.width = symbol.width + 2 * quietPx
  canvas.height = symbol.height + 2 * quietPx
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new BarcodeError('2D canvas context unavailable')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(symbol, quietPx, quietPx)

  return { canvas, moduleDots: modulePxAt1 * scale }
}

/** Codes with modules under this many dots scan unreliably on a 203 dpi head. */
export const MIN_RELIABLE_MODULE_DOTS = 2

export interface CodeCheck {
  ok: boolean
  moduleDots?: number
  /** Set when the content cannot be encoded at all by the chosen symbology. */
  error?: string
  /** Set when it encodes, but will print too fine to scan dependably. */
  warning?: string
}

/**
 * Check a code for the editor without committing to rendering it.
 *
 * Worth surfacing early because both failure modes are invisible on screen: an
 * EAN-13 with a bad check digit simply refuses to encode, and a long payload
 * squeezed into a small box quietly drops to one-dot modules that look fine
 * zoomed in and then will not scan off the printed label.
 */
export function checkCode(
  element: BarcodeElement | QrElement,
  boxWidthDots: number,
  boxHeightDots: number,
): CodeCheck {
  try {
    const { moduleDots } = renderCode(element, boxWidthDots, boxHeightDots)
    if (moduleDots < MIN_RELIABLE_MODULE_DOTS) {
      return {
        ok: true,
        moduleDots,
        warning:
          `Modules are ${moduleDots} dot${moduleDots === 1 ? '' : 's'} wide. ` +
          `Below ${MIN_RELIABLE_MODULE_DOTS} this often fails to scan — make the element wider, ` +
          `or shorten the value.`,
      }
    }
    return { ok: true, moduleDots }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
