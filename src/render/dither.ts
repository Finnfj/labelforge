/**
 * Floyd–Steinberg error diffusion, for photographs only.
 *
 * A thermal head prints one bit per dot, so a photo thresholded flat comes out as
 * a few black blobs. Diffusing the quantisation error into neighbouring pixels
 * trades spatial resolution for apparent tone and makes photos legible.
 *
 * Never run this over text, barcodes or QR codes: the scattered dots destroy the
 * sharp module edges a scanner relies on.
 *
 * Serpentine traversal (alternating scan direction per row) is used because it
 * avoids the diagonal "worm" artefacts that plain left-to-right diffusion
 * produces on smooth gradients.
 */
export function floydSteinberg(luma: Uint8Array, width: number, height: number): Uint8Array {
  // Work in floats so accumulated error isn't repeatedly truncated.
  const buf = Float32Array.from(luma)
  const out = new Uint8Array(luma.length)

  for (let y = 0; y < height; y++) {
    const leftToRight = (y & 1) === 0
    for (let k = 0; k < width; k++) {
      const x = leftToRight ? k : width - 1 - k
      const i = y * width + x
      const old = buf[i]
      const black = old <= 127
      out[i] = black ? 1 : 0
      const err = old - (black ? 0 : 255)

      // Mirror the kernel when scanning right-to-left.
      const fwd = leftToRight ? 1 : -1
      diffuse(buf, width, height, x + fwd, y, err * (7 / 16))
      diffuse(buf, width, height, x - fwd, y + 1, err * (3 / 16))
      diffuse(buf, width, height, x, y + 1, err * (5 / 16))
      diffuse(buf, width, height, x + fwd, y + 1, err * (1 / 16))
    }
  }
  return out
}

function diffuse(
  buf: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  amount: number,
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return
  buf[y * width + x] += amount
}
