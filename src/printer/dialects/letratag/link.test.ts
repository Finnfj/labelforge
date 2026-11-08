import { describe, expect, it } from 'vitest'
import { CHUNK_SIZE, MAGIC } from './constants'
import { jobHeader, letratagLink } from './link'

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ')

describe('LetraTag job header', () => {
  // The four jobs captured from the vendor app (docs/DYMO_PROTOCOL.md, "Header"): their
  // stream lengths and the checksum byte each carried. Read off the captures, not
  // derived from the formula.
  it.each([
    [1283, 0x3d],
    [2331, 0x59],
    [3075, 0x44],
    [4091, 0x3f],
  ])('reproduces the captured checksum for a %i-byte stream', (length, checksum) => {
    const header = jobHeader(length)
    expect(hex(header.subarray(0, 4))).toBe('ff f0 12 34')
    expect(new DataView(header.buffer).getUint32(4, true)).toBe(length)
    expect(header[8]).toBe(checksum)
  })
})

describe('LetraTag link', () => {
  it('sends the header first, as a write of its own', () => {
    const chunks = letratagLink.chunk(new Uint8Array(10), CHUNK_SIZE)
    expect(hex(chunks[0])).toBe(hex(jobHeader(10)))
  })

  it('leads each slice with its index, and ends the last with the magic', () => {
    const stream = Uint8Array.from({ length: 1200 }, (_, i) => i & 0xff)
    const [, ...pieces] = letratagLink.chunk(stream, CHUNK_SIZE)
    expect(pieces.map((p) => p.length)).toEqual([501, 501, 1 + 200 + 2])
    expect(pieces.map((p) => p[0])).toEqual([0, 1, 2])
    expect(hex(pieces[2].subarray(-2))).toBe(hex(MAGIC))
    expect(pieces.flatMap((p, i) => [...p.subarray(1, i === 2 ? -2 : undefined)])).toEqual([
      ...stream,
    ])
  })

  it('skips index 27, as the vendor app does', () => {
    const pieces = letratagLink.chunk(new Uint8Array(30 * CHUNK_SIZE), CHUNK_SIZE).slice(1)
    const indices = pieces.map((p) => p[0])
    expect(indices.slice(25, 30)).toEqual([25, 26, 28, 29, 30])
  })

  it('frames nothing for a job that streams nothing', () => {
    // The probe goes as a write of its own; a header for an empty stream would be a
    // job the printer never asked for.
    expect(letratagLink.chunk(new Uint8Array(0), CHUNK_SIZE)).toEqual([])
  })

  it('has every write acknowledged and no credits channel', () => {
    expect(letratagLink.pacing).toEqual({ kind: 'acknowledged' })
    expect(letratagLink.gatt.writeMode).toBe('with-response')
    expect(letratagLink.gatt.credits).toBeUndefined()
  })
})
