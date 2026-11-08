import { sliceRows, type PackedBitmap } from '../../../model/bitmap'
import type { Dialect, PlannedJob } from '../../dialect'
import type { MockTransport } from '../../transport/MockTransport'

/*
 * A dialect for tests, deliberately unlike x2.
 *
 * With it, the drivers are tested without a single x2 byte: if a driver still
 * knew anything about x2, these bytes would trip it. It is also what makes the
 * dialect interface real rather than hypothetical: two adapters sit behind it.
 * Never imported by app code.
 *
 * A job is `AA <length, big-endian u16> <rows, uncompressed> BB`. The last band of
 * each copy is followed by `EE` as a write of its own.
 */

export const START = 0xaa
export const STOP = 0xbb
export const END = 0xee

export interface TestDialectOptions {
  /** Rows per band, so a few rows already make a multi-band print. */
  bandRows?: number
  /** Every wait, between jobs and at the end of a copy, in milliseconds. */
  waitMs?: number
}

export function testDialect(options: TestDialectOptions = {}): Dialect {
  const bandRows = options.bandRows ?? 4
  const waitMs = options.waitMs ?? 10
  return {
    // A range unlike x2's, so nothing can lean on 1 to 15.
    density: { min: 0, max: 4, default: 2 },
    // Uncompressed, and banded by rows rather than bytes: every job fits, and the
    // picture never changes the size.
    assessJob: (bitmap) => ({ bytes: bitmap.data.length, fits: true, compressed: false }),
    planPrint(bitmap, settings) {
      const bands: PackedBitmap[] = []
      for (let from = 0; from < bitmap.heightDots; from += bandRows) {
        bands.push(sliceRows(bitmap, from, Math.min(bandRows, bitmap.heightDots - from)))
      }
      const jobs: PlannedJob[] = bands.map((band, i) => {
        const last = i === bands.length - 1
        const length = band.data.length
        return {
          parts: [
            {
              kind: 'command',
              bytes: Uint8Array.of(START, length >> 8, length & 0xff),
              note: 'start',
            },
            { kind: 'raster', bytes: band.data },
            { kind: 'command', bytes: Uint8Array.of(STOP), note: 'stop' },
          ],
          epilogue: last ? [{ bytes: Uint8Array.of(END), note: 'end' }] : [],
          waitMs: last ? null : waitMs,
        }
      })
      return {
        copies: Array.from({ length: settings.copies }, () => ({ jobs, finishWaitMs: waitMs })),
      }
    },
  }
}

/**
 * A printer that speaks the test dialect, for the BLE driver's tests.
 *
 * It reads the stream the way a printer would, whatever the write boundaries, and
 * reports each job done once it has read the job's stop byte. "Done" is `4F 4B`,
 * because recognising that is still the BLE driver's own x2 knowledge.
 */
export function testPrinter(transport: MockTransport, options: { silent?: boolean } = {}) {
  let state: 'idle' | 'length-hi' | 'length-lo' | 'rows' | 'stop' = 'idle'
  let remaining = 0
  const printer = { jobsRead: 0 }
  const read = (byte: number) => {
    switch (state) {
      case 'idle':
        if (byte === START) state = 'length-hi'
        return
      case 'length-hi':
        remaining = byte << 8
        state = 'length-lo'
        return
      case 'length-lo':
        remaining |= byte
        state = remaining > 0 ? 'rows' : 'stop'
        return
      case 'rows':
        if (--remaining === 0) state = 'stop'
        return
      case 'stop':
        if (byte !== STOP) throw new Error(`expected the stop byte, got ${byte}`)
        printer.jobsRead++
        state = 'idle'
        if (!options.silent) {
          setTimeout(() => transport.emit('status', Uint8Array.of(0x4f, 0x4b)), 1)
        }
    }
  }
  transport.autoRespond = (bytes) => {
    for (const byte of bytes) read(byte)
    return undefined
  }
  return printer
}
