import { describe, expect, it } from 'vitest'
import { exportDoc, importDoc, ImportError } from './templates'
import { putAsset, getAsset } from './assets'
import { deleteFont, getFont, putFont } from './fonts'
import { createEmptyDoc, type LabelDoc, type TextElement } from '../model/labelDoc'
import firaSansUrl from '@fontsource/fira-sans/files/fira-sans-latin-400-normal.woff2?url'

/** A real font file, so FontFace actually accepts it. */
async function fontBlob(): Promise<Blob> {
  return new Blob([await (await fetch(firaSansUrl)).arrayBuffer()])
}

function pngBlob(): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = 8
  canvas.height = 8
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#123456'
  ctx.fillRect(0, 0, 8, 8)
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'))
}

function sampleDoc(): LabelDoc {
  const doc = createEmptyDoc(40, 30, 'Shelf label')
  doc.elements = [
    {
      id: 't1',
      kind: 'text',
      text: 'Bay 4',
      fontFamily: 'sans-serif',
      fontSizePt: 12,
      align: 'left',
      x: 2,
      y: 2,
      widthMm: 30,
      heightMm: 8,
      rotation: 0,
      z: 1,
    },
  ]
  return doc
}

describe('portable export and import', () => {
  it('round-trips a document', async () => {
    const doc = sampleDoc()
    const { doc: restored } = await importDoc(await exportDoc(doc))
    expect(restored).toEqual(doc)
  })

  it('carries images inside the file so it stays self-contained', async () => {
    const assetId = await putAsset(await pngBlob())
    const doc = sampleDoc()
    doc.elements.push({
      id: 'i1',
      kind: 'image',
      assetId,
      mode: 'lineart',
      fit: 'contain',
      x: 2,
      y: 12,
      widthMm: 10,
      heightMm: 10,
      rotation: 0,
      z: 2,
    })

    const json = await exportDoc(doc)
    expect(json).toContain('data:image/png;base64,')

    // Simulate arriving on a machine that has never seen the asset.
    const { del } = await import('idb-keyval')
    const { assetStore } = await import('./db')
    await del(assetId, assetStore)
    expect(await getAsset(assetId)).toBeUndefined()

    await importDoc(json)
    expect(await getAsset(assetId)).toBeInstanceOf(Blob)
  })

  it('still exports when an image asset has gone missing', async () => {
    const doc = sampleDoc()
    doc.elements.push({
      id: 'i1',
      kind: 'image',
      assetId: 'does-not-exist',
      mode: 'lineart',
      fit: 'contain',
      x: 2,
      y: 12,
      widthMm: 10,
      heightMm: 10,
      rotation: 0,
      z: 2,
    })
    const { doc: restored } = await importDoc(await exportDoc(doc))
    expect(restored.elements).toHaveLength(2)
  })

  it('accepts a bare document, which is what the autosave value looks like', async () => {
    const doc = sampleDoc()
    const { doc: restored } = await importDoc(JSON.stringify(doc))
    expect(restored.name).toBe('Shelf label')
  })

  it('rejects malformed JSON with a readable message', async () => {
    await expect(importDoc('{ not json')).rejects.toThrow(ImportError)
  })

  it('rejects a valid JSON file that is not a label', async () => {
    await expect(importDoc('{"hello":"world"}')).rejects.toThrow(ImportError)
  })

  it('names an uploaded font without carrying its bytes, by default', async () => {
    // The deliberate asymmetry with images: embedding a font in a file you hand
    // to someone else is redistribution, which most font licences forbid.
    const font = await putFont(await fontBlob(), 'Shelf Sans.woff2')
    const doc = sampleDoc()
    doc.elements[0] = { ...(doc.elements[0] as TextElement), fontFamily: font.family }

    const json = await exportDoc(doc)
    expect(json).toContain(font.family)
    expect(json).toContain('Shelf Sans')
    expect(json).not.toContain('data:font')
    expect(json).not.toContain('base64')

    // Arriving on a machine that has never seen it.
    await deleteFont(font.family)
    const { doc: restored, missingFonts } = await importDoc(json)
    expect(missingFonts).toEqual(['Shelf Sans'])
    // The label still opens, still names the font it wants, and is not rewritten
    // behind the user's back.
    expect(restored.elements[0]).toMatchObject({ fontFamily: font.family })
  })

  it('carries the bytes when embedding is asked for', async () => {
    const font = await putFont(await fontBlob(), 'Shelf Sans.woff2')
    const doc = sampleDoc()
    doc.elements[0] = { ...(doc.elements[0] as TextElement), fontFamily: font.family }

    const json = await exportDoc(doc, { embedFonts: true })
    expect(json).toContain('base64')

    await deleteFont(font.family)
    expect(await getFont(font.family)).toBeUndefined()

    const { missingFonts } = await importDoc(json)
    expect(missingFonts).toEqual([])
    expect(await getFont(font.family)).toBeDefined()
  })

  it('gives the same family name to the same bytes', async () => {
    // Content addressing is what lets a by-reference export resolve on another
    // machine: both ends have to compute the same name from the same file.
    const a = await putFont(await fontBlob(), 'One Name.woff2')
    const b = await putFont(await fontBlob(), 'Another Name.woff2')
    expect(b.family).toBe(a.family)
  })

  it('says nothing about fonts for a label that uses none', async () => {
    const { missingFonts } = await importDoc(await exportDoc(sampleDoc()))
    expect(missingFonts).toEqual([])
  })

  it('still reads a version 1 file, which predates fonts entirely', async () => {
    const legacy = JSON.stringify({ format: 'labelforge', version: 1, doc: sampleDoc() })
    const { doc, missingFonts } = await importDoc(legacy)
    expect(doc.name).toBe('Shelf label')
    expect(missingFonts).toEqual([])
  })

  it('rejects a document with an impossible size rather than importing it', async () => {
    const bad = { ...sampleDoc(), size: { widthMm: 0, heightMm: -5 } }
    await expect(importDoc(JSON.stringify(bad))).rejects.toThrow(ImportError)
  })
})
