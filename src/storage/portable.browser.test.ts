import { describe, expect, it } from 'vitest'
import { exportDoc, importDoc, ImportError } from './templates'
import { putAsset, getAsset } from './assets'
import { createEmptyDoc, type LabelDoc } from '../model/labelDoc'

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
    const restored = await importDoc(await exportDoc(doc))
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
    const restored = await importDoc(await exportDoc(doc))
    expect(restored.elements).toHaveLength(2)
  })

  it('accepts a bare document, which is what the autosave value looks like', async () => {
    const doc = sampleDoc()
    const restored = await importDoc(JSON.stringify(doc))
    expect(restored.name).toBe('Shelf label')
  })

  it('rejects malformed JSON with a readable message', async () => {
    await expect(importDoc('{ not json')).rejects.toThrow(ImportError)
  })

  it('rejects a valid JSON file that is not a label', async () => {
    await expect(importDoc('{"hello":"world"}')).rejects.toThrow(ImportError)
  })

  it('rejects a document with an impossible size rather than importing it', async () => {
    const bad = { ...sampleDoc(), size: { widthMm: 0, heightMm: -5 } }
    await expect(importDoc(JSON.stringify(bad))).rejects.toThrow(ImportError)
  })
})
