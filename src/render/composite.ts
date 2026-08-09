/**
 * Merge the crisp (thresholded) plane over the tone (dithered) plane.
 *
 * Selection is by the crisp layer's own alpha coverage, not by OR-ing the two
 * planes together. That distinction matters: OR-ing would make white text drawn
 * on top of a photo disappear, because "white" is 0 in both planes and the photo's
 * black dots would win. With a mask, wherever crisp content exists it owns the
 * pixel outright — including where it is deliberately white.
 */
export function composite(
  crispBits: Uint8Array,
  crispMask: Uint8Array,
  toneBits: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(crispBits.length)
  for (let i = 0; i < out.length; i++) out[i] = crispMask[i] ? crispBits[i] : toneBits[i]
  return out
}
