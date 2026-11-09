import { describe, expect, it } from 'vitest'
import { CHUNK_SIZE } from './constants'
import { letratagLink } from './link'

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ')

/** What the link writes ahead of a stream this long: the job header. */
const headerFor = (length: number) => letratagLink.chunk(new Uint8Array(length), CHUNK_SIZE)[0]

describe('LetraTag link', () => {
  // The four jobs captured from the vendor app (docs/DYMO_PROTOCOL.md, "Header"): the
  // stream length each header carried and its checksum byte, read off the captures,
  // not derived from the formula.
  it.each([
    [1283, '03 05 00 00 3d'],
    [2331, '1b 09 00 00 59'],
    [3075, '03 0c 00 00 44'],
    [4091, 'fb 0f 00 00 3f'],
  ])('writes the header the vendor app wrote for a %i-byte stream', (length, tail) => {
    expect(hex(headerFor(length))).toBe(`ff f0 12 34 ${tail}`)
  })

  it('leads each slice with its index, and ends the last with 12 34', () => {
    const stream = Uint8Array.from({ length: 1200 }, (_, i) => i & 0xff)
    const [, ...pieces] = letratagLink.chunk(stream, CHUNK_SIZE)
    expect(pieces.map((p) => p.length)).toEqual([501, 501, 1 + 200 + 2])
    expect(pieces.map((p) => p[0])).toEqual([0, 1, 2])
    expect(hex(pieces[2].subarray(-2))).toBe('12 34')
    expect(pieces.flatMap((p, i) => [...p.subarray(1, i === 2 ? -2 : undefined)])).toEqual([
      ...stream,
    ])
  })

  it('skips index 27, as ysfchn/dymo-bluetooth does', () => {
    const pieces = letratagLink.chunk(new Uint8Array(30 * CHUNK_SIZE), CHUNK_SIZE).slice(1)
    expect(pieces.map((p) => p[0]).slice(25, 30)).toEqual([25, 26, 28, 29, 30])
  })

  it('frames nothing for a step that streams nothing', () => {
    // The probe goes as a write of its own; a header for an empty stream would be a
    // job the printer never asked for.
    expect(letratagLink.chunk(new Uint8Array(0), CHUNK_SIZE)).toEqual([])
  })
})
