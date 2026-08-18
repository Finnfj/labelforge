import { z } from 'zod'
import { CURRENT_SCHEMA_VERSION, type LabelDoc } from './labelDoc'

/**
 * Validation for anything crossing the trust boundary: an imported `.label.json`
 * file, or a document read back from IndexedDB that an older build wrote.
 *
 * In-memory edits are not re-validated; the editor is trusted to produce valid
 * documents, and parsing on every keystroke would be wasted work.
 */

const mm = z.number().finite()
const positiveMm = z.number().finite().positive()

const base = {
  id: z.string().min(1),
  name: z.string().optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
  x: mm,
  y: mm,
  widthMm: positiveMm,
  heightMm: positiveMm,
  rotation: z.number().finite(),
  z: z.number().finite(),
}

const textElement = z.object({
  ...base,
  kind: z.literal('text'),
  text: z.string(),
  fontFamily: z.string().min(1),
  fontSizePt: z.number().positive(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']),
  lineHeight: z.number().positive().optional(),
  autoShrink: z.boolean().optional(),
})

const barcodeElement = z.object({
  ...base,
  kind: z.literal('barcode'),
  symbology: z.enum(['code128', 'ean13', 'ean8', 'code39', 'itf14', 'datamatrix', 'gs1-128']),
  value: z.string(),
  showText: z.boolean(),
})

const qrElement = z.object({
  ...base,
  kind: z.literal('qr'),
  value: z.string(),
  ecLevel: z.enum(['L', 'M', 'Q', 'H']),
})

const imageElement = z.object({
  ...base,
  kind: z.literal('image'),
  assetId: z.string().min(1),
  mode: z.enum(['lineart', 'photo']),
  threshold: z.number().min(0).max(255).optional(),
  dither: z.enum(['floyd-steinberg', 'atkinson', 'bayer']).optional(),
  ditherStrength: z.number().min(0).max(1).optional(),
  brightness: z.number().min(-100).max(100).optional(),
  contrast: z.number().min(-100).max(100).optional(),
  invert: z.boolean().optional(),
  fit: z.enum(['contain', 'cover', 'stretch']),
})

const iconElement = z.object({
  ...base,
  kind: z.literal('icon'),
  iconId: z.string().min(1),
})

const shapeElement = z.object({
  ...base,
  kind: z.literal('shape'),
  shape: z.enum(['rect', 'ellipse', 'line']),
  filled: z.boolean(),
  strokeMm: z.number().min(0),
  radiusMm: z.number().min(0).optional(),
})

export const labelElementSchema = z.discriminatedUnion('kind', [
  textElement,
  barcodeElement,
  qrElement,
  imageElement,
  iconElement,
  shapeElement,
])

export const labelDocSchema = z.object({
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  size: z.object({
    widthMm: positiveMm,
    heightMm: positiveMm,
    presetId: z.string().optional(),
  }),
  paper: z.object({ type: z.enum(['gap', 'continuous']) }),
  elements: z.array(labelElementSchema),
})

export class DocumentVersionError extends Error {
  constructor(found: unknown) {
    super(
      `This label was saved by a newer version of the app (schema ${String(found)}, ` +
        `this build understands ${CURRENT_SCHEMA_VERSION}).`,
    )
    this.name = 'DocumentVersionError'
  }
}

/**
 * Bring an older document up to the current schema, then validate it.
 *
 * There is only one version so far, so this is a pass-through — but the seam
 * exists now, because retrofitting migration after users have saved labels is
 * how people lose their work.
 */
export function migrate(raw: unknown): LabelDoc {
  const version = (raw as { schemaVersion?: unknown } | null)?.schemaVersion
  if (typeof version === 'number' && version > CURRENT_SCHEMA_VERSION) {
    throw new DocumentVersionError(version)
  }
  // Future: `if (version === 1) raw = upgrade1to2(raw)` and so on, in order.
  return labelDocSchema.parse(raw) as LabelDoc
}

export function parseDoc(raw: unknown): LabelDoc {
  return migrate(raw)
}
