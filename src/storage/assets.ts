import { del, entries, get, set } from 'idb-keyval'
import { assetStore } from './db'
import { newId } from '../model/labelDoc'

/**
 * Uploaded image storage.
 *
 * Object URLs are cached per asset so that repeated rasterisation — which
 * happens on every keystroke via the live preview — does not allocate a new URL
 * each time and leak it. They are revoked only when the asset is deleted.
 */
const urlCache = new Map<string, string>()

export async function putAsset(blob: Blob): Promise<string> {
  const id = newId()
  await set(id, blob, assetStore)
  return id
}

export async function getAsset(id: string): Promise<Blob | undefined> {
  return get<Blob>(id, assetStore)
}

export async function deleteAsset(id: string): Promise<void> {
  const url = urlCache.get(id)
  if (url) {
    URL.revokeObjectURL(url)
    urlCache.delete(id)
  }
  await del(id, assetStore)
}

/** Resolve an asset to a URL usable by an <img> or Fabric image. */
export async function resolveAssetUrl(id: string): Promise<string> {
  const cached = urlCache.get(id)
  if (cached) return cached
  const blob = await getAsset(id)
  if (!blob) throw new Error(`Image asset ${id} is missing.`)
  const url = URL.createObjectURL(blob)
  urlCache.set(id, url)
  return url
}

/** Base64 data URL, for embedding in a portable export file. */
export async function assetToDataUrl(id: string): Promise<string> {
  const blob = await getAsset(id)
  if (!blob) throw new Error(`Image asset ${id} is missing.`)
  return blobToDataUrl(blob)
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function dataUrlToAsset(id: string, dataUrl: string): Promise<void> {
  const response = await fetch(dataUrl)
  await set(id, await response.blob(), assetStore)
}

/** Asset ids currently held, for pruning orphans. */
export async function listAssetIds(): Promise<string[]> {
  return (await entries(assetStore)).map(([key]) => String(key))
}
