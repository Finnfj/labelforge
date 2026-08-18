/**
 * The font catalogue, and the guarantee that a face is loaded before it is used.
 *
 * That second part is why this module exists. Canvas is not the DOM: setting
 * `ctx.font` to a family the browser has not loaded does not start a load, and
 * nothing ever redraws when one finishes. It substitutes silently, and the
 * result is a perfectly plausible bitmap in the wrong typeface going to the
 * print head — the same class of failure as printing a stale raster, and just as
 * invisible.
 *
 * `document.fonts.ready` does not save us either. It settles fonts that layout
 * has *used*, and ours are only ever named from a canvas, so it resolves happily
 * with every face still unloaded. The load has to be asked for explicitly.
 */
import type { LabelDoc } from '../model/labelDoc'
import { ptToDots } from '../model/units'

export type FontKind = 'bundled' | 'system' | 'user'

export interface FontDef {
  /** The CSS family name, and what goes in the document. */
  family: string
  label: string
  kind: FontKind
  /** Shown under the picker when this font is selected. */
  note?: string
}

/**
 * Bundled with the app, so a label made here prints the same anywhere.
 *
 * Chosen for 203 dpi rather than for looks. At 8 pt an em is about 22 dots and a
 * stem is one or two, so what survives is generous x-height, open counters and
 * even stem weight; delicate faces close up under the head's own dot gain.
 */
export const BUNDLED_FONTS: FontDef[] = [
  {
    family: 'Fira Sans',
    label: 'Fira Sans',
    kind: 'bundled',
    note: 'Drawn for low-resolution screens, which is nearly this problem.',
  },
  {
    family: 'Archivo Narrow',
    label: 'Archivo Narrow',
    kind: 'bundled',
    note: 'Condensed — buys horizontal room on narrow stock.',
  },
  {
    family: 'JetBrains Mono',
    label: 'JetBrains Mono',
    kind: 'bundled',
    note: 'Monospaced, with 0/O and 1/l/I drawn apart. For serials and codes.',
  },
]

/**
 * CSS generic families. Kept because every label saved before the bundled fonts
 * existed names one, and rewriting those would change how they print without
 * being asked.
 *
 * Labelled for what they are: `sans-serif` is Arial on Windows, Liberation or
 * DejaVu on Linux, Roboto on Android. Same document, different metrics,
 * different line breaks, and until now nothing said so.
 */
export const SYSTEM_FONTS: FontDef[] = [
  { family: 'sans-serif', label: 'Sans', kind: 'system' },
  { family: 'serif', label: 'Serif', kind: 'system' },
  { family: 'monospace', label: 'Mono', kind: 'system' },
]

const GENERIC_FAMILIES = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
])

/**
 * Whether a family is a CSS keyword rather than a typeface.
 *
 * These always resolve to something, so asking whether one is "available" has no
 * answer worth acting on, and a warning about one would be pure noise.
 */
export function isGenericFamily(family: string): boolean {
  return GENERIC_FAMILIES.has(family.trim().toLowerCase())
}

/** Fonts the user supplied, registered this session. Keyed by CSS family. */
const userFonts = new Map<string, string>()

/**
 * Make a user-supplied font usable, under a family name we choose.
 *
 * The caller picks the family — a content hash, not the name inside the file. A
 * font that calls itself "Arial" would otherwise collide with the real Arial in
 * the CSS matching path and resolve to whichever the browser preferred.
 *
 * Throws on a file that is not a font. That has to be loud: the alternative is
 * an upload that appears to work and prints in a substitute face.
 */
export async function registerUserFont(
  family: string,
  bytes: ArrayBuffer,
  displayName = family,
): Promise<void> {
  if (userFonts.has(family)) return
  let face: FontFace
  try {
    face = new FontFace(family, bytes)
    await face.load()
  } catch (error) {
    throw new Error(
      `${displayName} could not be read as a font. ` +
        `Supported formats are .woff2, .woff, .ttf and .otf. ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    )
  }
  document.fonts.add(face)
  userFonts.set(family, displayName)
}

/** Registered this session, so the picker can offer it. */
export function isUserFontRegistered(family: string): boolean {
  return userFonts.has(family)
}

export function forgetUserFont(family: string): void {
  userFonts.delete(family)
}

/**
 * Load every font a document's text needs, and report the ones that will not
 * render.
 *
 * Returns rather than throws. One missing font must not cost the whole raster —
 * the same judgement `skipped` already encodes. The caller warns; the label
 * still prints, in a substitute face, and the user is told which.
 */
export async function ensureDocumentFonts(doc: LabelDoc): Promise<string[]> {
  if (typeof document === 'undefined' || !document.fonts) return []

  // One request per family and size. The text goes in too: for a family split
  // across unicode-ranges, that is what decides which files are actually needed.
  const wanted = new Map<string, { spec: string; text: string; family: string; px: number }>()
  for (const element of doc.elements) {
    if (element.kind !== 'text') continue
    if (isGenericFamily(element.fontFamily)) continue
    const px = Math.max(1, Math.round(ptToDots(element.fontSizePt)))
    // Weight and style belong in the shorthand. Ask for `16px "Fira Sans"` and
    // only the 400 face loads, so bold text rasterises against a face that is
    // still unloaded and comes out as the browser's synthetic bold — which is
    // precisely the silent substitution this function exists to prevent. Fabric
    // sets the same three properties, so this has to match what it will ask for.
    const style = element.italic ? 'italic ' : ''
    const weight = element.bold ? 'bold ' : ''
    const spec = `${style}${weight}${px}px "${cssEscape(element.fontFamily)}"`
    const existing = wanted.get(spec)
    if (existing) existing.text += element.text
    else wanted.set(spec, { spec, text: element.text, family: element.fontFamily, px })
  }

  const missing = new Set<string>()
  for (const { spec, text, family, px } of wanted.values()) {
    // This is what actually pulls the bytes in, for any face that is in the font
    // set — the bundled @font-face declarations and anything `registerUserFont`
    // added. Nothing else triggers it, canvas least of all.
    try {
      await document.fonts.load(spec, text)
    } catch {
      // An invalid shorthand rejects rather than resolving false. The checks
      // below decide, so there is nothing useful to do here.
    }

    // Two questions, needing two different instruments.
    //
    // `check()` answers "is every face in the set that this would use loaded?",
    // which catches a registered font whose bytes have not arrived. It cannot
    // answer "does this family exist at all" — a family nothing matches has no
    // unloaded faces, so check returns **true** for a font that is simply not
    // installed. That is the likelier failure, and it needs the measurement.
    let ready = true
    try {
      ready = document.fonts.check(spec)
    } catch {
      ready = false
    }
    if (!ready || !familyResolves(family, px, text)) missing.add(family)
  }
  return [...missing]
}

/**
 * Whether naming this family changes how text is measured.
 *
 * The only way to ask the browser whether a family exists. Put the family in
 * front of a generic fallback and measure; if the width is identical to that
 * fallback alone, nothing matched the family and the fallback is what would be
 * drawn. Two different fallbacks are tried and both have to match before the
 * family is called missing — one coincidence is possible, two is not.
 */
function familyResolves(family: string, px: number, text: string): boolean {
  const ctx = measureContext()
  if (!ctx) return true // Cannot tell; do not cry wolf.
  // A longer probe makes a coincidental tie less likely. Blank text would make
  // every measurement zero, so it falls back to a fixed string.
  const probe = (text.trim() || 'AaBbGg0123 WWiill').slice(0, 64)

  for (const fallback of ['monospace', 'serif']) {
    ctx.font = `${px}px ${fallback}`
    const base = ctx.measureText(probe).width
    ctx.font = `${px}px "${cssEscape(family)}", ${fallback}`
    if (Math.abs(ctx.measureText(probe).width - base) > 0.01) return true
  }
  return false
}

let measureCanvas: HTMLCanvasElement | null = null

function measureContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  measureCanvas ??= document.createElement('canvas')
  return measureCanvas.getContext('2d')
}

/** Quote a family for use inside a CSS font shorthand. */
function cssEscape(family: string): string {
  return family.replace(/["\\]/g, '\\$&')
}
