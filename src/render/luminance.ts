/**
 * RGBA -> 8-bit luminance, compositing over white.
 *
 * Labels are printed on white stock, so a semi-transparent pixel should behave as
 * if it were laid over paper, and a fully transparent one must come out white
 * regardless of its colour channels. (The vendor SDK instead treats alpha as a
 * hard on/off and uses a naive `(r+g+b)/3` mean; we use the Rec. 601 weights,
 * which is why our thresholding decisions differ from theirs on coloured input.)
 */
export function toLuminance(rgba: Uint8ClampedArray | Uint8Array, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) {
    const p = i * 4
    const a = rgba[p + 3] / 255
    // composite over white
    const r = rgba[p] * a + 255 * (1 - a)
    const g = rgba[p + 1] * a + 255 * (1 - a)
    const b = rgba[p + 2] * a + 255 * (1 - a)
    out[i] = (0.299 * r + 0.587 * g + 0.114 * b + 0.5) | 0
  }
  return out
}

/** Alpha channel as a coverage mask, used to decide which layer owns a pixel. */
export function toAlphaMask(
  rgba: Uint8ClampedArray | Uint8Array,
  pixelCount: number,
  cutoff = 127,
): Uint8Array {
  const out = new Uint8Array(pixelCount)
  for (let i = 0; i < pixelCount; i++) out[i] = rgba[i * 4 + 3] > cutoff ? 1 : 0
  return out
}
