/** The given byte arrays, end to end, in one new array. */
export function concatBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** Consecutive views of `bytes`, each `size` long but the last, sharing its buffer. */
export function sliceBytes(bytes: Uint8Array, size: number): Uint8Array[] {
  const slices: Uint8Array[] = []
  for (let offset = 0; offset < bytes.length; offset += size) {
    slices.push(bytes.subarray(offset, Math.min(offset + size, bytes.length)))
  }
  return slices
}
