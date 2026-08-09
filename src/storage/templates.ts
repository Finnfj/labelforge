import { del, entries, set } from 'idb-keyval'
import { z } from 'zod'
import { templateStore } from './db'
import { assetToDataUrl, dataUrlToAsset } from './assets'
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

/** Portable file format. Assets are inlined so a single file is self-contained. */
const portableSchema = z.object({
  format: z.literal('labelforge'),
  version: z.literal(1),
  doc: labelDocSchema,
  assets: z.record(z.string(), z.string()).optional(),
})

export const PORTABLE_EXTENSION = '.labelforge.json'

/**
 * Serialise a document with its images inlined as data URLs.
 *
 * Exports are self-contained on purpose: a label that silently loses its logo
 * when opened on another machine is worse than a slightly larger file.
 */
export async function exportDoc(doc: LabelDoc): Promise<string> {
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
  return JSON.stringify({ format: 'labelforge', version: 1, doc, assets }, null, 2)
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportError'
  }
}

/** Parse and validate a portable file, restoring its images into storage. */
export async function importDoc(json: string): Promise<LabelDoc> {
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
      return parseDoc(raw)
    } catch {
      throw new ImportError('That file is not a LabelForge label.')
    }
  }

  for (const [id, dataUrl] of Object.entries(parsed.data.assets ?? {})) {
    await dataUrlToAsset(id, dataUrl)
  }
  return parsed.data.doc as LabelDoc
}
