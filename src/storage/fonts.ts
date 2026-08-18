import { del, entries, get, set } from 'idb-keyval'
import { fontStore } from './db'
import { forgetUserFont, isUserFontRegistered, registerUserFont } from '../render/fonts'

/**
 * Fonts the user added.
 *
 * "Added", not "uploaded": nothing leaves the machine. The file is read in the
 * browser, registered with the browser's own font set and kept in IndexedDB on
 * this device. There is no server in this app to upload anything to.
 *
 * Content-addressed, unlike images. An image gets a random id because only the
 * machine that made it needs to find it again; a font has to be identifiable
 * across machines, so that a template exported without its bytes can say "this
 * label wants *that* font" and the receiving machine can answer. A hash of the
 * bytes is the only name both ends can compute independently.
 *
 * The hash is also why the CSS family name is not the one inside the file. A
 * font that calls itself "Arial" would collide with the system Arial in the CSS
 * matching path and resolve to whichever the browser preferred, which is exactly
 * the kind of silent substitution this app should not ship.
 */

export interface UserFontRecord {
  /** CSS family name, derived from the content hash. Goes in the document. */
  family: string
  /** What the user calls it. From the filename; only ever shown, never matched. */
  displayName: string
  sizeBytes: number
}

interface StoredFont extends UserFontRecord {
  blob: Blob
}

/** `lf-` prefixed so a user font is never mistaken for a bundled or system one. */
function familyFromHash(hash: ArrayBuffer): string {
  const hex = [...new Uint8Array(hash)]
    .slice(0, 6)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `lf-${hex}`
}

async function hashFamily(bytes: ArrayBuffer): Promise<string> {
  // Web Bluetooth already requires a secure context, so subtle.crypto is present
  // wherever this app can actually do anything.
  return familyFromHash(await crypto.subtle.digest('SHA-256', bytes))
}

/** Strip the extension; a filename is the only name we get for a font. */
function displayNameFor(fileName: string): string {
  return (
    fileName
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .trim() || 'Added font'
  )
}

/**
 * Store and register a font file.
 *
 * Registration happens first and is allowed to throw: a file that is not a font
 * must fail loudly rather than land in storage and quietly render as a fallback.
 */
export async function putFont(file: File | Blob, fileName?: string): Promise<UserFontRecord> {
  const bytes = await file.arrayBuffer()
  const family = await hashFamily(bytes)
  const displayName = displayNameFor(fileName ?? (file as File).name ?? family)

  await registerUserFont(family, bytes, displayName)

  const record: UserFontRecord = { family, displayName, sizeBytes: bytes.byteLength }
  await set(family, { ...record, blob: new Blob([bytes]) } satisfies StoredFont, fontStore)
  return record
}

export async function getFont(family: string): Promise<StoredFont | undefined> {
  return get<StoredFont>(family, fontStore)
}

export async function listFonts(): Promise<UserFontRecord[]> {
  const all = await entries<string, StoredFont>(fontStore)
  return all
    .map(([, v]) => ({ family: v.family, displayName: v.displayName, sizeBytes: v.sizeBytes }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
}

export async function deleteFont(family: string): Promise<void> {
  forgetUserFont(family)
  await del(family, fontStore)
}

/**
 * Register every stored font with the browser.
 *
 * Called once at startup. Without it a font survives a reload in IndexedDB but
 * not in the CSS font set, so every label using one would render as a fallback
 * until it was added again.
 */
export async function registerStoredFonts(): Promise<void> {
  const all = await entries<string, StoredFont>(fontStore)
  for (const [, stored] of all) {
    if (isUserFontRegistered(stored.family)) continue
    try {
      await registerUserFont(stored.family, await stored.blob.arrayBuffer(), stored.displayName)
    } catch {
      // A stored font that no longer loads is reported at rasterise time by
      // `fontFallbacks`, which names it against the label that wants it. Failing
      // startup over one bad record would be a worse trade.
    }
  }
}

/** Base64 data URL, for embedding in a portable export file. */
export async function fontToDataUrl(family: string): Promise<string> {
  const stored = await getFont(family)
  if (!stored) throw new Error(`Font ${family} is missing.`)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(stored.blob)
  })
}

export async function dataUrlToFont(
  family: string,
  displayName: string,
  dataUrl: string,
): Promise<void> {
  const blob = await (await fetch(dataUrl)).blob()
  const bytes = await blob.arrayBuffer()
  await registerUserFont(family, bytes, displayName)
  await set(
    family,
    { family, displayName, sizeBytes: bytes.byteLength, blob } satisfies StoredFont,
    fontStore,
  )
}
