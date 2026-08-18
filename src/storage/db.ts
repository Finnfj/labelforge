import { createStore } from 'idb-keyval'

/**
 * IndexedDB stores.
 *
 * Images live here as Blobs rather than as data URLs inside the document.
 * A base64 data URL is a third larger than the bytes it carries, and embedding
 * one in the document would push it through every undo snapshot and every
 * autosave — a single photo would make the editor visibly stutter.
 */
export const assetStore = createStore('labelforge', 'assets')
/**
 * User-supplied fonts, as Blobs, keyed by a hash of their own bytes.
 *
 * Content-addressed rather than given a random id like an asset, because two
 * machines holding the same font file have to agree on its name for a template
 * that references it to resolve on both.
 *
 * Its own database, and that is not a style choice. `createStore` opens at
 * version 1 and creates its object store in the upgrade callback — which does
 * not run if the database already exists at that version. Adding a second store
 * to `labelforge` would therefore work on a fresh browser and fail on every
 * browser that had already used this app, which is the worst way for it to fail.
 * `labelforge-templates` was split off for the same reason.
 */
export const fontStore = createStore('labelforge-fonts', 'fonts')
export const templateStore = createStore('labelforge-templates', 'templates')
