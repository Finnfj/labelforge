/**
 * Hard threshold: the only correct binarisation for text, barcodes, QR codes,
 * icons and line art.
 *
 * Dithering these is the classic thermal-label mistake — it breaks up barcode
 * module edges and the code stops scanning. See `dither.ts`.
 */
export function threshold(luma: Uint8Array, level = 128): Uint8Array {
  const out = new Uint8Array(luma.length)
  for (let i = 0; i < luma.length; i++) out[i] = luma[i] <= level ? 1 : 0
  return out
}
