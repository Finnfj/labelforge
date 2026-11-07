import { describe, expect, it } from 'vitest'
import { BlePrinterDriver } from './BlePrinterDriver'
import { VirtualPrinterDriver } from './VirtualPrinterDriver'
import { MockTransport } from '../transport/MockTransport'
import { checkerboard } from '../diagnostics/testPatterns'
import type { PackedBitmap } from '../../model/bitmap'
import { concatBytes } from '../../lib/bytes'
import { noisyBitmap } from '../../test/bitmaps'
import { DEFAULT_PRINT_SETTINGS, type PrintSettings } from '../types'
import { PaperType } from '../dialects/x2/constants'

/*
 * What each driver puts on the wire, write by write, pinned absolutely.
 *
 * The other driver tests either parse the stream or compare one driver with the
 * other, so a change that moved both drivers together would pass them. These
 * snapshots were taken before the print plan existed and must not change when the
 * code behind the drivers is reorganised. A write boundary is part of what is
 * pinned: the BLE driver's chunking is what keeps every byte under flow control,
 * and the virtual driver's one-command-per-line is what its log shows.
 *
 * Small prints are recorded as hex, one line per write. Large ones would make the
 * snapshot unreadably long, so they are recorded as the run of write lengths and a
 * SHA-256 of the whole stream, which together fix every byte and every boundary.
 */

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ')

const FULL_HEX_LIMIT = 2048

async function describeWrites(writes: { bytes: Uint8Array; note?: string }[]) {
  const total = writes.reduce((n, w) => n + w.bytes.length, 0)
  if (total <= FULL_HEX_LIMIT) {
    return writes.map((w) => (w.note ? `${hex(w.bytes)}  # ${w.note}` : hex(w.bytes)))
  }
  const stream = concatBytes(writes.map((w) => w.bytes))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', stream))
  const runs: string[] = []
  let last = -1
  let count = 0
  const flush = () => {
    if (count > 0) runs.push(count === 1 ? `${last}` : `${last}×${count}`)
  }
  for (const w of writes) {
    if (w.bytes.length === last) count++
    else {
      flush()
      last = w.bytes.length
      count = 1
    }
  }
  flush()
  return {
    writes: writes.length,
    bytes: total,
    lengths: runs.join(', '),
    notes: writes.flatMap((w) => (w.note ? [w.note] : [])).join(', ') || undefined,
    sha256: Array.from(digest, (v) => v.toString(16).padStart(2, '0')).join(''),
  }
}

/** Identity answers, and `4F 4B` shortly after a stream that ends a job. */
function printerResponder(transport: MockTransport) {
  let tail: string[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
  return (bytes: Uint8Array) => {
    const key = hex(bytes)
    if (key === '10 ff 20 f1') return text('V2.10')
    if (key === '10 ff 20 f2') return text('SN12345678')
    if (key === '10 ff 30 11') return text('AA:BB:CC:DD:EE:FF')
    tail = [...tail, ...key.split(' ')].slice(-4)
    const end = tail.join(' ')
    if (end.endsWith('1f c0 01 01') || end.endsWith('1f 11 50')) {
      clearTimeout(timer)
      timer = setTimeout(() => transport.emit('status', Uint8Array.of(0x4f, 0x4b)), 5)
    }
    return undefined
  }
}

async function bleWrites(bitmap: PackedBitmap, settings: PrintSettings) {
  const transport = new MockTransport()
  transport.autoRespond = printerResponder(transport)
  transport.creditsPerWrite = 1
  const driver = new BlePrinterDriver(transport, { queryTimeoutMs: 20 })
  await driver.connect()
  transport.reset()
  await driver.print({ bitmap, settings })
  return describeWrites(transport.writes.map((bytes) => ({ bytes })))
}

async function virtualWrites(bitmap: PackedBitmap, settings: PrintSettings) {
  const driver = new VirtualPrinterDriver(Infinity)
  await driver.connect()
  const writes: { bytes: Uint8Array; note?: string }[] = []
  driver.on('wire', (w) => writes.push({ bytes: w.bytes, note: w.note }))
  await driver.print({ bitmap, settings })
  return describeWrites(writes)
}

const CASES: Array<[string, () => PackedBitmap, PrintSettings]> = [
  ['a small label', () => checkerboard(384, 32), DEFAULT_PRINT_SETTINGS],
  ['a split label, paper seam closed', () => noisyBitmap(384, 360), DEFAULT_PRINT_SETTINGS],
  [
    'a split label, paper seam left open',
    () => noisyBitmap(384, 360),
    { ...DEFAULT_PRINT_SETTINGS, closeSplitSeam: false },
  ],
  [
    'a tall label with splitting turned off',
    () => noisyBitmap(384, 360),
    { ...DEFAULT_PRINT_SETTINGS, splitForSeek: false },
  ],
  [
    'two copies of a small label',
    () => checkerboard(64, 16),
    { ...DEFAULT_PRINT_SETTINGS, copies: 2 },
  ],
  [
    'two copies of a split label',
    () => noisyBitmap(384, 360),
    { ...DEFAULT_PRINT_SETTINGS, copies: 2 },
  ],
  [
    'a label on continuous paper',
    () => checkerboard(64, 16),
    { ...DEFAULT_PRINT_SETTINGS, paperType: PaperType.Continuous },
  ],
  [
    'a label asked for with a speed',
    () => checkerboard(64, 16),
    { ...DEFAULT_PRINT_SETTINGS, speed: 1 },
  ],
  [
    'a label asked for without a gap seek',
    () => checkerboard(64, 16),
    { ...DEFAULT_PRINT_SETTINGS, seekGap: false },
  ],
]

describe('what the BLE driver writes for', () => {
  it('connecting', async () => {
    const transport = new MockTransport()
    transport.autoRespond = printerResponder(transport)
    const driver = new BlePrinterDriver(transport, { queryTimeoutMs: 20 })
    await driver.connect()
    expect(await describeWrites(transport.writes.map((bytes) => ({ bytes })))).toMatchSnapshot()
  })

  for (const [name, bitmap, settings] of CASES) {
    it(
      name,
      async () => {
        expect(await bleWrites(bitmap(), settings)).toMatchSnapshot()
      },
      60_000,
    )
  }
})

describe('what the virtual printer writes for', () => {
  for (const [name, bitmap, settings] of CASES) {
    it(name, async () => {
      expect(await virtualWrites(bitmap(), settings)).toMatchSnapshot()
    })
  }
})
