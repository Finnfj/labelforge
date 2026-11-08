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
 * each copy is followed by `EE` as a write of its own. The printer reports a job
 * done with `DD`, and failed with `FA`. Credits come as `01 <count>`, every one an
 * increment.
 */

export const START = 0xaa
export const STOP = 0xbb
export const END = 0xee
export const DONE = 0xdd
export const FAILED = 0xfa
/** Done, with a warning: the job printed, but the printer has something to say. */
export const DONE_WITH_WARNING = 0xd1
/** Leads every chunk when the link frames its chunks. */
export const FRAME = 0xf0

/** What the test conversation says a failure was. */
export const FAILED_REASON = 'The test printer gave up.'
/** What the test conversation passes on with a job done with a warning. */
export const WARNING = 'The test printer is running low.'

export interface TestDialectOptions {
  /** Rows per band, so a few rows already make a multi-band print. */
  bandRows?: number
  /** Every wait, between jobs and at the end of a copy, in milliseconds. */
  waitMs?: number
  /**
   * Pace by acknowledged writes rather than credits, and frame each chunk with a
   * leading `F0`: a link unlike x2's in both respects.
   */
  acknowledged?: boolean
}

export function testDialect(options: TestDialectOptions = {}): Dialect {
  const bandRows = options.bandRows ?? 4
  const waitMs = options.waitMs ?? 10
  const acknowledged = options.acknowledged ?? false
  return {
    // A range unlike x2's, so nothing can lean on 1 to 15.
    density: { min: 0, max: 4, default: 2 },
    takesSpeed: false,
    link: {
      gatt: {
        service: 'test-service',
        write: 'test-write',
        status: 'test-status',
        credits: acknowledged ? undefined : 'test-credits',
        writeMode: acknowledged ? 'with-response' : 'fastest-offered',
      },
      chunkSize: 16,
      chunk(stream, chunkSize) {
        const chunks: Uint8Array[] = []
        for (let offset = 0; offset < stream.length; offset += chunkSize) {
          const slice = stream.subarray(offset, Math.min(offset + chunkSize, stream.length))
          chunks.push(acknowledged ? Uint8Array.of(FRAME, ...slice) : slice)
        }
        return chunks
      },
      pacing: acknowledged
        ? { kind: 'acknowledged' }
        : {
            kind: 'credits',
            readGrant: (bytes) =>
              bytes.length >= 2 && bytes[0] === 0x01 ? { add: bytes[1] } : null,
            delayWithCreditsMs: 0,
            delayWithoutCreditsMs: 1,
          },
    },
    conversation: {
      handshake: [],
      identify: async (_ask, advertisedName) => ({
        model: advertisedName,
        firmware: null,
        serial: null,
        mac: null,
      }),
      status: async () => ({ batteryPercent: null, labelHeightDots: null, fault: 'unknown' }),
      readReply: (bytes) =>
        bytes[0] === DONE
          ? { kind: 'done' }
          : bytes[0] === DONE_WITH_WARNING
            ? { kind: 'done', warning: WARNING }
            : bytes[0] === FAILED
              ? { kind: 'failed', reason: FAILED_REASON }
              : { kind: 'other' },
    },
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
 * It reads the stream the way a printer would, whatever the write boundaries and
 * any `F0` framing, and reports each job done with `DD` once it has read the job's
 * stop byte; or with whatever `reply` says instead.
 */
export function testPrinter(
  transport: MockTransport,
  options: { silent?: boolean; reply?: number; framed?: boolean } = {},
) {
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
          const reply = options.reply ?? DONE
          setTimeout(() => transport.emit('status', Uint8Array.of(reply)), 1)
        }
    }
  }
  transport.autoRespond = (bytes) => {
    for (const byte of options.framed ? bytes.subarray(1) : bytes) read(byte)
    return undefined
  }
  return printer
}
