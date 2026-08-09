/**
 * The canonical label document.
 *
 * This — not Fabric's serialisation — is the source of truth. Fabric is a view
 * built from it by the editor adapters, which costs two small translation layers
 * and buys three things: the renderer and its tests are independent of the canvas
 * library, saved labels survive a Fabric upgrade or replacement, and undo/redo
 * snapshots a small plain object rather than canvas state.
 *
 * All geometry is in millimetres with a top-left origin, matching how label stock
 * is specified. Conversion to dots happens once, at render time.
 */

/** Millimetres. */
export type Mm = number

export interface ElementBase {
  id: string
  name?: string
  locked?: boolean
  hidden?: boolean
  x: Mm
  y: Mm
  widthMm: Mm
  heightMm: Mm
  /** Degrees clockwise, about the element's top-left corner. */
  rotation: number
  /** Draw order; higher is on top. */
  z: number
}

export type TextAlign = 'left' | 'center' | 'right'

export interface TextElement extends ElementBase {
  kind: 'text'
  text: string
  fontFamily: string
  fontSizePt: number
  bold?: boolean
  italic?: boolean
  align: TextAlign
  lineHeight?: number
  /** Shrink to fit the box rather than overflowing it. */
  autoShrink?: boolean
}

export type BarcodeSymbology =
  | 'code128'
  | 'ean13'
  | 'ean8'
  | 'code39'
  | 'itf14'
  | 'datamatrix'
  | 'gs1-128'

export interface BarcodeElement extends ElementBase {
  kind: 'barcode'
  symbology: BarcodeSymbology
  value: string
  showText: boolean
}

export interface QrElement extends ElementBase {
  kind: 'qr'
  value: string
  ecLevel: 'L' | 'M' | 'Q' | 'H'
}

export interface ImageElement extends ElementBase {
  kind: 'image'
  assetId: string
  /**
   * `lineart` thresholds; `photo` dithers. This is the single most consequential
   * per-element choice in the app — dithering line art muddies it, and
   * thresholding a photo reduces it to blobs.
   */
  mode: 'lineart' | 'photo'
  threshold?: number
  invert?: boolean
  fit: 'contain' | 'cover' | 'stretch'
}

export interface IconElement extends ElementBase {
  kind: 'icon'
  iconId: string
}

export interface ShapeElement extends ElementBase {
  kind: 'shape'
  shape: 'rect' | 'ellipse' | 'line'
  filled: boolean
  strokeMm: Mm
  radiusMm?: Mm
}

export type LabelElement =
  | TextElement
  | BarcodeElement
  | QrElement
  | ImageElement
  | IconElement
  | ShapeElement

export type ElementKind = LabelElement['kind']

/**
 * An element before it has been added to a document.
 *
 * This must distribute over the union: a plain `Omit<LabelElement, 'id' | 'z'>`
 * collapses to only the keys every variant shares, which would silently reject
 * `text` and `shape` and leave the union unenforced.
 */
export type DraftElement = {
  [K in ElementKind]: Omit<Extract<LabelElement, { kind: K }>, 'id' | 'z'>
}[ElementKind]

/** A partial update, likewise distributed so variant-specific fields survive. */
export type ElementPatch = {
  [K in ElementKind]: Partial<Extract<LabelElement, { kind: K }>>
}[ElementKind]

export interface LabelDoc {
  schemaVersion: 1
  id: string
  name: string
  createdAt: number
  updatedAt: number
  size: { widthMm: Mm; heightMm: Mm; presetId?: string }
  paper: { type: 'gap' | 'continuous' }
  elements: LabelElement[]
}

/**
 * Elements whose edges must stay sharp, versus those that want tonal rendering.
 *
 * Only photographs belong in the tone plane. Everything else is thresholded,
 * because dithering breaks up barcode modules and glyph stems, and a dithered
 * barcode stops scanning.
 */
export function isToneElement(element: LabelElement): boolean {
  return element.kind === 'image' && element.mode === 'photo'
}

export const CURRENT_SCHEMA_VERSION = 1 as const

export function createEmptyDoc(widthMm: Mm, heightMm: Mm, name = 'Untitled label'): LabelDoc {
  const now = Date.now()
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: newId(),
    name,
    createdAt: now,
    updatedAt: now,
    size: { widthMm, heightMm },
    paper: { type: 'gap' },
    elements: [],
  }
}

export function newId(): string {
  // crypto.randomUUID needs a secure context; this app requires one anyway for
  // Web Bluetooth, but tests and older embedded views may not have it.
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

/** Next free z-index, so a newly added element lands on top. */
export function nextZ(doc: LabelDoc): number {
  return doc.elements.reduce((max, e) => Math.max(max, e.z), 0) + 1
}

export function elementsInDrawOrder(doc: LabelDoc): LabelElement[] {
  return [...doc.elements].filter((e) => !e.hidden).sort((a, b) => a.z - b.z)
}
