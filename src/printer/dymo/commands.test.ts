import { describe, expect, it } from 'vitest'
import { createPackedBitmap } from '../../model/bitmap'
import { buildHeader, MAGIC } from './constants'
import { buildPrintJob } from './commands'

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ')

describe('buildHeader', () => {
  // Checksums confirmed by hand against all four jobs captured from the vendor
  // app (docs/DYMO_PROTOCOL.md, "Header") — not derived from this function.
  it.each([
    [1283, 0x3d],
    [2331, 0x59],
    [3075, 0x44],
    [4091, 0x3f],
  ])('reproduces the captured checksum for a %i-byte payload', (length, checksum) => {
    const header = buildHeader(length)
    expect(header.length).toBe(9)
    expect(hex(header.subarray(0, 4))).toBe('ff f0 12 34')
    expect(new DataView(header.buffer).getUint32(4, true)).toBe(length)
    expect(header[8]).toBe(checksum)
  })
})

describe('buildPrintJob', () => {
  it('sends the header as its own first write', () => {
    const bm = createPackedBitmap(30, 10)
    const [header] = buildPrintJob(bm)
    expect(header.length).toBe(9)
    expect(hex(header.subarray(0, 4))).toBe('ff f0 12 34')
  })

  it('fits a small job in one chunk, with the magic value appended', () => {
    const bm = createPackedBitmap(30, 10)
    const chunks = buildPrintJob(bm)
    expect(chunks).toHaveLength(2) // header + one payload chunk
    const chunk = chunks[1]
    expect(chunk[0]).toBe(0) // first sequence index
    expect(Array.from(chunk.subarray(-2))).toEqual(Array.from(MAGIC))
  })

  it('splits a large job into multiple 500-byte-data chunks and skips index 27', () => {
    // A payload over 27 * 500 bytes forces the skip-at-27 quirk to actually fire.
    // Each row becomes 8 raster bytes after the 2x stretch (4 bytes/column × 2), so
    // ~14000+ raster bytes needs at least 1750 rows.
    const bm = createPackedBitmap(30, 1800)
    const chunks = buildPrintJob(bm)
    const payloadChunks = chunks.slice(1)
    expect(payloadChunks.length).toBeGreaterThan(28)

    const indices = payloadChunks.map((c) => c[0])
    // 0..26 run consecutively, then jump straight to 28.
    expect(indices.slice(0, 27)).toEqual(Array.from({ length: 27 }, (_, i) => i))
    expect(indices[27]).toBe(28)

    // Every chunk but the last carries exactly 1 + CHUNK_SIZE bytes; only the
    // last is shorter and carries the trailing magic value.
    for (const c of payloadChunks.slice(0, -1)) expect(c.length).toBe(1 + 500)
    const last = payloadChunks.at(-1)!
    expect(Array.from(last.subarray(-2))).toEqual(Array.from(MAGIC))
  })
})
