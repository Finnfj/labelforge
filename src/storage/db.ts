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
export const templateStore = createStore('labelforge-templates', 'templates')
