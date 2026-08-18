import { del, entries, set } from 'idb-keyval'
import { z } from 'zod'
import { templateStore } from './db'
import { assetToDataUrl, dataUrlToAsset } from './assets'
import { dataUrlToFont, fontToDataUrl, getFont } from './fonts'
import { newId, type LabelDoc } from '../model/labelDoc'
import { labelDocSchema, parseDoc } from '../model/labelDoc.schema'

export interface StoredTemplate {
  id: string
  name: string
  savedAt: number
  doc: LabelDoc
}

export async function saveTemplate(doc: LabelDoc, name?: string): Promise<StoredTemplate> {
  const template: StoredTemplate = {
    id: newId(),
    name: name?.trim() || doc.name || 'Untitled label',
    savedAt: Date.now(),
    doc: structuredClone(doc),
  }
  await set(template.id, template, templateStore)
  return template
}

export async function listTemplates(): Promise<StoredTemplate[]> {
  const rows = await entries<string, StoredTemplate>(templateStore)
  return rows.map(([, value]) => value).sort((a, b) => b.savedAt - a.savedAt)
}

export async function deleteTemplate(id: string): Promise<void> {
  await del(id, templateStore)
}

/**
 * Portable file format.
 *
 * Version 2 adds `fonts`. Version 1 files are still read — they have no
 * uploaded fonts by construction, so there is nothing to migrate.
 */
const portableFontSchema = z.object({
  displayName: z.string(),
  sizeBytes: z.number().nonnegative(),
  /** Present only when the exporter chose to embed the bytes. */
  dataUrl: z.string().optional(),
})

const portableSchema = z.object({
  format: z.literal('labelforge'),
  version: z.union([z.literal(1), z.literal(2)]),
  doc: labelDocSchema,
  assets: z.record(z.string(), z.string()).optional(),
  fonts: z.record(z.string(), portableFontSchema).optional(),
})

export type PortableFont = z.infer<typeof portableFontSchema>

/** Font families in a document that came from an upload rather than a bundle. */
function userFontFamilies(doc: LabelDoc): string[] {
  const families = new Set<string>()
  for (const element of doc.elements) {
    if (element.kind === 'text' && element.fontFamily.startsWith('lf-')) {
      families.add(element.fontFamily)
    }
  }
  return [...families]
}

/** Whether an export would have anything to offer embedding for. */
export async function hasEmbeddableFonts(doc: LabelDoc): Promise<boolean> {
  for (const family of userFontFamilies(doc)) {
    if (await getFont(family)) return true
  }
  return false
}

export const PORTABLE_EXTENSION = '.labelforge.json'

/**
 * Serialise a document with its images inlined as data URLs.
 *
 * Exports are self-contained on purpose: a label that silently loses its logo
 * when opened on another machine is worse than a slightly larger file.
 *
 * Uploaded fonts are the exception, and deliberately so. Putting font bytes in a
 * file you hand to someone else is redistribution, which most commercial font
 * licences forbid outright — so the same reasoning that makes inlining an image
 * obviously right makes inlining a font the user's call, not ours. By default
 * only the name and size travel, which is enough for the receiving end to say
 * exactly which font is missing instead of quietly substituting one.
 */
export async function exportDoc(
  doc: LabelDoc,
  options: { embedFonts?: boolean } = {},
): Promise<string> {
  const assets: Record<string, string> = {}
  for (const element of doc.elements) {
    if (element.kind !== 'image') continue
    if (assets[element.assetId]) continue
    try {
      assets[element.assetId] = await assetToDataUrl(element.assetId)
    } catch {
      // A missing asset should not block exporting the rest of the label.
    }
  }
  const fonts: Record<string, PortableFont> = {}
  for (const family of userFontFamilies(doc)) {
    const stored = await getFont(family)
    if (!stored) continue
    fonts[family] = {
      displayName: stored.displayName,
      sizeBytes: stored.sizeBytes,
      ...(options.embedFonts ? { dataUrl: await fontToDataUrl(family) } : {}),
    }
  }

  return JSON.stringify(
    {
      format: 'labelforge',
      version: 2,
      doc,
      assets,
      ...(Object.keys(fonts).length > 0 ? { fonts } : {}),
    },
    null,
    2,
  )
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

export interface ImportResult {
  doc: LabelDoc
  /**
   * Uploaded fonts the file named but did not carry, by display name.
   *
   * Not an error — the label opens and prints — but the caller has to say so,
   * because the substitute face it renders in looks entirely intentional.
   */
  missingFonts: string[]
}

/** Parse and validate a portable file, restoring its images into storage. */
export async function importDoc(json: string): Promise<ImportResult> {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new ImportError('That file is not valid JSON.')
  }

  const parsed = portableSchema.safeParse(raw)
  if (!parsed.success) {
    // Also accept a bare document, which is what someone gets if they copy the
    // autosave value out of local storage.
    try {
      return { doc: parseDoc(raw), missingFonts: [] }
    } catch {
      throw new ImportError('That file is not a LabelForge label.')
    }
  }

  for (const [id, dataUrl] of Object.entries(parsed.data.assets ?? {})) {
    await dataUrlToAsset(id, dataUrl)
  }

  // Fonts that came with their bytes are restored; ones that did not are
  // reported by name. Saying nothing here would leave the label rendering in a
  // substitute face that looks deliberate.
  const missingFonts: string[] = []
  for (const [family, font] of Object.entries(parsed.data.fonts ?? {})) {
    if (font.dataUrl) {
      try {
        await dataUrlToFont(family, font.displayName, font.dataUrl)
        continue
      } catch {
        // Embedded but unreadable counts as missing.
      }
    }
    if (!(await getFont(family))) missingFonts.push(font.displayName)
  }

  return { doc: parsed.data.doc as LabelDoc, missingFonts }
}
