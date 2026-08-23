import { describe, expect, it, vi } from 'vitest'
import { BlePrinterDriver, IncompatiblePrinterError } from './BlePrinterDriver'
import { MockTransport } from '../transport/MockTransport'
import { encodeImage } from '../protocol/encodeImage'
import { checkerboard } from '../diagnostics/testPatterns'
import { createPackedBitmap } from '../../model/bitmap'
import { DEFAULT_PRINT_SETTINGS, type PrintProgress } from '../types'
import { CreditWindow } from '../protocol/CreditWindow'
import { VirtualPrinterDriver } from './VirtualPrinterDriver'
import { PaperType, SEEK_SAFE_JOB_BYTES } from '../protocol/constants'
import { findProfile } from '../profiles'

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ')

/** Answers identity queries with plausible ASCII so probing does not time out. */
function identityResponder() {
  return (bytes: Uint8Array) => {
    const key = hex(bytes)
    const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
    // Deliberately silent on model, matching a real P50S.
    if (key === '10 ff 20 f1') return text('V2.10')
    if (key === '10 ff 20 f2') return text('SN12345678')
    if (key === '10 ff 30 11') return text('AA:BB:CC:DD:EE:FF')
    if (key === '10 ff 50 f1') return Uint8Array.of(0x00, 0x5a) // 90
    if (key === '1f 20 00') return Uint8Array.of(0xff, 0x00)
    return undefined
  }
}

/**
 * Identity queries, plus the end-of-job acknowledgement.
 *
 * `4F 4B` answers a stream, not an opcode. A 30 mm label is acknowledged about
 * 300 ms after its last byte while it is still printing, and a tall one only when
 * the buffer finally drains — both are "I have consumed everything you sent". This
 * fires on a short quiet period after a stream that ends a job, rather than keying
 * on `1F 11 50`, which is merely what usually happens to be last and stopped being
 * last the moment the tear advance moved to the follow-up.
 */
function printerResponder(transport: MockTransport) {
  const identity = identityResponder()
  let tail: string[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  return (bytes: Uint8Array) => {
    const reply = identity(bytes)
    if (reply) return reply
    tail = [...tail, ...hex(bytes).split(' ')].slice(-4)
    const end = tail.join(' ')
    if (end.endsWith('1f c0 01 01') || end.endsWith('1f 11 50')) {
      clearTimeout(timer)
      timer = setTimeout(() => transport.emit('status', Uint8Array.of(0x4f, 0x4b)), 5)
    }
    return undefined
  }
}

/** A connected driver whose printer answers identity and acknowledges its jobs. */
function acknowledging(options: { doneTimeoutMs?: number } = {}) {
  const transport = new MockTransport()
  transport.autoRespond = printerResponder(transport)
  transport.creditsPerWrite = 1
  return { transport, driver: new BlePrinterDriver(transport, options) }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/**
 * How many times a command appears in the whole job stream.
 *
 * Not `writes.filter(...)`: a command no longer occupies a transfer of its own,
 * and can straddle two. Counting in the concatenated stream is what the printer
 * would see.
 */
function occurrences(writes: Uint8Array[], command: string): number {
  const haystack = hex(concat(writes))
  let count = 0
  for (let at = haystack.indexOf(command); at >= 0; at = haystack.indexOf(command, at + 1)) count++
  return count
}

/**
 * Take a job apart the way the printer's parser does.
 *
 * Write boundaries carry no meaning here and are not asserted on. The driver
 * chunks the whole job — commands and raster together — so a command can and does
 * straddle two transfers, exactly as the capture shows the vendor app doing. So
 * the writes are concatenated first, and the raster is found by reading its own
 * header rather than by guessing which transfer it landed in.
 *
 * Two earlier versions of this helper split on length and then on write position.
 * Both encoded an assumption about chunking that the code has now outgrown twice;
 * parsing the stream cannot go stale the same way.
 */
function splitJob(writes: Uint8Array[]) {
  const stream = concat(writes)
  const at = stream.findIndex((_, i) => stream[i] === 0x1f && stream[i + 1] === 0x10)
  expect(at, 'no raster header in the stream').toBeGreaterThan(0)

  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength)
  const payload = view.getUint32(at + 6)
  const rasterEnd = at + 10 + payload
  expect(rasterEnd, 'raster runs past the end of the stream').toBeLessThanOrEqual(stream.length)

  return {
    /** The `1F 10` command entire, header and payload. */
    raster: stream.subarray(at, rasterEnd),
    /** Everything either side of it, which is the framing and nothing else. */
    framing: [
      ...splitCommands(stream.subarray(0, at)),
      ...splitCommands(stream.subarray(rasterEnd)),
    ],
  }
}

/**
 * Cut a run of framing bytes back into individual commands.
 *
 * Only needed because the assertions read better command-by-command than as one
 * long hex line. Every command in the framing is fixed-length and starts `1f`, so
 * a table of lengths is enough — and an unknown opcode failing loudly here is the
 * right outcome, since it would mean the framing grew something this test has
 * never seen.
 */
function splitCommands(bytes: Uint8Array): string[] {
  const LENGTHS: Record<string, number> = {
    '1f 80': 4, // setPaperTypeSilent
    '1f 70': 10, // setPrintParams
    '1f 60': 4, // setSpeed
    '1f c0': 4, // start / stopPrintJob
    '1f 11': 3, // alignPaperStart / alignPaperEnd
    '1f 12': 4, // locate
  }
  const out: string[] = []
  for (let at = 0; at < bytes.length;) {
    const key = hex(bytes.subarray(at, at + 2))
    const length = LENGTHS[key]
    expect(length, `unknown framing command ${key}`).toBeDefined()
    out.push(hex(bytes.subarray(at, at + length)))
    at += length
  }
  return out
}

/**
 * A bitmap that does not compress, which is what the threshold is really about.
 *
 * A checkerboard of any size deflates to a few hundred bytes — 384 x 1200 comes to
 * 409 — so it cannot stand in for a large job however tall it is. Dithered
 * photographs are the real case: 48 x 640 of one measured 23,273 bytes on the wire
 * against 30,720 raw. Deterministic, so the test does not drift.
 */
function noisyBitmap(widthDots: number, heightDots: number) {
  const bm = createPackedBitmap(widthDots, heightDots)
  let seed = 0x2545f491
  for (let i = 0; i < bm.data.length; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
    bm.data[i] = (seed >>> 16) & 0xff
  }
  return bm
}

async function connected(options?: { credits?: number; doneTimeoutMs?: number }) {
  const transport = new MockTransport()
  transport.autoRespond = printerResponder(transport)
  if (options?.credits) transport.creditsPerWrite = options.credits
  const driver = new BlePrinterDriver(transport, { doneTimeoutMs: options?.doneTimeoutMs })
  await driver.connect()
  transport.reset()
  return { transport, driver }
}

describe('BlePrinterDriver', () => {
  it('announces itself and reads identity on connect', async () => {
    const transport = new MockTransport({ autoRespond: identityResponder() })
    const driver = new BlePrinterDriver(transport)
    const capabilities = await driver.connect()

    // The vendor app sends setBTType immediately after connecting.
    expect(hex(transport.writes[0])).toBe('1f b2 00')
    // A real P50S never answers the model query, so the model comes from the
    // advertised BLE name instead of being reported as unknown.
    expect(capabilities.model).toBe('P50')
    expect(capabilities.firmware).toBe('V2.10')
    expect(capabilities.serial).toBe('SN12345678')
    expect(driver.state).toBe('connected')
    expect(capabilities.profileId).toBe('p50')
    expect(capabilities.support).toBe('confirmed')
    expect(capabilities.profileAssumed).toBe(false)
  })

  it('refuses an L11-family printer without writing anything to it', async () => {
    // The assertion that matters is the write count. Refusing *after* sending
    // bytes would be no better than the behaviour this replaced: a P15 would
    // still receive a job it cannot parse, and still do nothing about it.
    const transport = new MockTransport({
      autoRespond: identityResponder(),
      deviceName: 'P15R_0042_BLE',
    })
    const driver = new BlePrinterDriver(transport)

    await expect(driver.connect()).rejects.toThrow(IncompatiblePrinterError)
    expect(transport.writes).toHaveLength(0)
    expect(driver.state).toBe('error')
  })

  it('names the model it is refusing', async () => {
    const transport = new MockTransport({
      autoRespond: identityResponder(),
      deviceName: 'P12_0001',
    })
    const driver = new BlePrinterDriver(transport)

    await expect(driver.connect()).rejects.toThrow(/P15 \/ P12 \/ P7/)
  })

  it('connects an M60 on the shared dialect, and says it is unverified', async () => {
    const transport = new MockTransport({
      autoRespond: identityResponder(),
      deviceName: 'M60_7788_BLE',
    })
    const driver = new BlePrinterDriver(transport)
    const capabilities = await driver.connect()

    expect(capabilities.profileId).toBe('m60')
    expect(capabilities.support).toBe('unverified')
    expect(capabilities.profileAssumed).toBe(false)
    // Same dialect means the same opening command; nothing about the sequence
    // changes for a model in the x2 family.
    expect(hex(transport.writes[0])).toBe('1f b2 00')
  })

  it('assumes a P50 for a name it does not recognise, and admits it', async () => {
    // The prefixes are reverse-engineered, so an unexpected P50 variant is far
    // likelier than a genuinely foreign device. Refusing here would lock people
    // out of printers that work.
    const transport = new MockTransport({
      autoRespond: identityResponder(),
      deviceName: 'Wireless-Thing-9000',
    })
    const driver = new BlePrinterDriver(transport)
    const capabilities = await driver.connect()

    expect(capabilities.profileId).toBe('p50')
    expect(capabilities.profileAssumed).toBe(true)
    expect(driver.state).toBe('connected')
  })

  it('still refuses an incompatible model even when it was forced', async () => {
    // Locking is for a printer that was misidentified, not a way to talk to one
    // that cannot listen.
    const transport = new MockTransport({ autoRespond: identityResponder() })
    const driver = new BlePrinterDriver(transport, {
      profile: findProfile('l11'),
      lockProfile: true,
    })

    await expect(driver.connect()).rejects.toThrow(IncompatiblePrinterError)
    expect(transport.writes).toHaveLength(0)
  })

  it('honours a locked profile over what the printer calls itself', async () => {
    // The Diagnostics override: detection is a guess from an advertised name,
    // so someone whose printer is misidentified needs a way past it.
    const transport = new MockTransport({
      autoRespond: identityResponder(),
      deviceName: 'P15R_0042_BLE',
    })
    const driver = new BlePrinterDriver(transport, {
      profile: findProfile('p50'),
      lockProfile: true,
    })
    const capabilities = await driver.connect()

    expect(capabilities.profileId).toBe('p50')
    expect(transport.writes.length).toBeGreaterThan(0)
  })

  it('still connects when the printer answers nothing', async () => {
    // Reply formats are inferred, so a printer that stays silent must still be
    // usable rather than failing to connect.
    const transport = new MockTransport()
    const driver = new BlePrinterDriver(transport, { queryTimeoutMs: 20 })
    const capabilities = await driver.connect()
    expect(capabilities.firmware).toBe('Unknown')
    expect(capabilities.serial).toBe('Unknown')
    expect(driver.state).toBe('connected')
  })

  it('emits the vendor app print sequence, gap seek included', async () => {
    const { transport, driver } = await connected()
    await driver.print({ bitmap: checkerboard(384, 32), settings: DEFAULT_PRINT_SETTINGS })

    // Transcribed from an HCI capture of the vendor Android app — see
    // docs/PROTOCOL.md. The `1f 12 20 00` between the raster and stopPrintJob is
    // the sensor gap seek, and its position in the stream is load-bearing: sent
    // standalone the same command does nothing at all.
    expect(splitJob(transport.writes).framing).toEqual([
      '1f 80 02 20', //                      setPaperTypeSilent(gap)
      '1f 70 02 08 00 00 00 00 00 00', //    setPrintParams(density 8)
      '1f c0 01 00', //                      startPrintJob
      '1f 11 51', //                         alignPaperStart
      '1f 12 20 00', //                      locate(gap)
      '1f c0 01 01', //                      stopPrintJob
      '1f 11 50', //                         alignPaperEnd
    ])
  })

  it('transmits exactly the encoded image, chunked to the negotiated size', async () => {
    const { transport, driver } = await connected()
    const bitmap = checkerboard(384, 64)
    await driver.print({ bitmap, settings: DEFAULT_PRINT_SETTINGS })

    for (const write of transport.writes) expect(write.length).toBeLessThanOrEqual(90)
    expect(Array.from(splitJob(transport.writes).raster)).toEqual(Array.from(encodeImage(bitmap)))
  })

  it('sends no byte of a job without a credit in hand', async () => {
    // The bug this exists for, from a real wire log of an 80 mm label.
    //
    // A long raster drains the credit window and holds it at zero: the log shows
    // 47 consecutive credit-then-chunk pairs, the driver blocking on each. The
    // framing was written outside that loop, so the moment the last chunk went out
    // three more transfers followed in 3 ms with nothing granted — into a printer
    // whose next grant was 60 ms away. `writeValueWithoutResponse` does not tell
    // you when that is thrown away. The first of the three was the gap seek, and
    // the label came out unregistered.
    //
    // Short labels never reached that state, which is why it took an 80 mm one to
    // find. The window here is deliberately small so any job is long enough.
    const { transport, driver } = acknowledging({ doneTimeoutMs: 5 })
    await driver.connect()
    transport.reset()
    transport.creditsPerWrite = 0
    transport.openCreditWindow(2)

    await driver.print({
      bitmap: checkerboard(384, 400),
      settings: { ...DEFAULT_PRINT_SETTINGS, copies: 2 },
    })

    expect(transport.blindWrites.map(hex)).toEqual([])
  })

  it('follows an oversized job with a small one carrying the gap seek', async () => {
    // A P50S only honours the seek in a job it read before the motor started, and
    // above ~18 KB it did not. Confirmed by experiment: the same design at 30 mm
    // registers and at 80 mm does not. See docs/PROTOCOL.md.
    // Credits flowing, so chunks pace at 5 ms rather than the creditless 30 —
    // an over-threshold job is ~190 chunks and the difference is 5 s of test.
    // The mock never sends the end-of-job OK, and the follow-up waits for it, so
    // the wait has to be cut short — which keeps the timeout path under test too.
    const { transport, driver } = await connected({ credits: 1, doneTimeoutMs: 5 })
    const bitmap = noisyBitmap(384, 360)
    expect(encodeImage(bitmap).length).toBeGreaterThan(SEEK_SAFE_JOB_BYTES)
    await driver.print({ bitmap, settings: { ...DEFAULT_PRINT_SETTINGS, followUpSeek: true } })

    // Two complete jobs, in order, each with its own seek.
    expect(occurrences(transport.writes, '1f c0 01 00')).toBe(2)
    expect(occurrences(transport.writes, '1f 12 20 00')).toBe(2)

    // The second carries a raster, because a seek with nothing in front of it is
    // documented as inert — and it is blank, so it costs 1 mm and a few bytes.
    const stream = concat(transport.writes)
    const second = stream.subarray(hex(stream).indexOf('1f 12 20 00') / 3 + 4)
    expect(second.length).toBeLessThan(200)
    expect(hex(second)).toContain('1f 10')

    // The tear-off advance happens once, at the very end. Twice, with the retract
    // between them, walked the paper past the boundary before the seek ran.
    expect(occurrences(transport.writes, '1f 11 50')).toBe(1)
    expect(hex(stream).endsWith('1f 11 50')).toBe(true)
    // And the retract happens only for the label, never before the seek.
    expect(occurrences(transport.writes, '1f 11 51')).toBe(1)
  })

  it('sends each follow-up only after the printer says it has finished', async () => {
    // The bug the first hardware trial found. An 80 mm label takes ~8.5 s to print
    // after the last byte lands, the wait was a flat 5 s, and the follow-up went
    // out mid-print — queued behind the raster it exists to get past. What has to
    // hold is the ordering, whatever the timings: no job starts before the one
    // before it has been acknowledged.
    const { transport, driver } = acknowledging()
    await driver.connect()
    transport.reset()

    const order: string[] = []
    const underlying = transport.autoRespond!
    transport.autoRespond = (bytes) => {
      if (hex(bytes).includes('1f c0 01 00')) order.push('job')
      return underlying(bytes)
    }
    transport.on('wire', (w) => {
      if (w.direction === 'in' && hex(w.bytes) === '4f 4b') order.push('ok')
    })

    await driver.print({
      bitmap: noisyBitmap(384, 360),
      settings: { ...DEFAULT_PRINT_SETTINGS, followUpSeek: true },
    })

    expect(order).toEqual(['job', 'ok', 'job', 'ok'])
  }, 30_000)

  it('can be told to leave the roll where the label ended', async () => {
    // The follow-up registers a roll that needs it and costs a blank label on one
    // that does not — a full-height label already ends at the gap, and seeking
    // from there advances to the next one. Nothing on this firmware reports which
    // case you are in, so it is a choice rather than a behaviour.
    const { transport, driver } = await connected({ credits: 1 })
    await driver.print({
      bitmap: noisyBitmap(384, 360),
      settings: { ...DEFAULT_PRINT_SETTINGS, followUpSeek: false },
    })
    expect(occurrences(transport.writes, '1f c0 01 00')).toBe(1)
    expect(occurrences(transport.writes, '1f 12 20 00')).toBe(1)
  }, 20_000)

  it('does not seek from a position the printer never confirmed', async () => {
    // A trial where `4F 4B` never arrived ran the whole wait and then sent the
    // follow-up anyway: the paper went through the gap and 20 mm into the next
    // label. Without the acknowledgement there is nothing to say the printer has
    // stopped, and a seek from an unknown position lands nowhere useful. Leaving
    // the roll unregistered is recoverable; that is not.
    const transport = new MockTransport({ autoRespond: identityResponder() })
    transport.creditsPerWrite = 1
    // Silent on the epilogue, so the end-of-job wait can only time out.
    const identity = identityResponder()
    transport.autoRespond = (bytes) => (hex(bytes) === '1f 11 50' ? undefined : identity(bytes))
    const driver = new BlePrinterDriver(transport, { doneTimeoutMs: 1 })
    await driver.connect()
    transport.reset()

    const warnings: string[] = []
    driver.on('log', (l) => {
      if (l.level === 'warn') warnings.push(l.message)
    })
    await driver.print({
      // Wide and short on purpose. The follow-up is decided by encoded size and
      // the wait by row count, so this is over the threshold while costing under
      // two seconds to time out — 360 rows of the same volume would cost
      // seventeen.
      bitmap: noisyBitmap(4000, 40),
      settings: { ...DEFAULT_PRINT_SETTINGS, followUpSeek: true },
    })

    expect(occurrences(transport.writes, '1f 12 20 00')).toBe(1)
    // Both halves of it: the label may be incomplete, and the roll was left alone.
    expect(warnings.join(' ')).toMatch(/never confirmed it finished/i)
    expect(warnings.join(' ')).toMatch(/left where the label ended/i)
  }, 40_000)

  it('waits for the printer to finish even when nothing follows', async () => {
    // Without this, `done` fired while a full-height label still had ten seconds
    // to print, and a job the printer never finished looked exactly like one it
    // did. A truncated label with nothing said about it is the worst of the two.
    const identity = identityResponder()
    const transport = new MockTransport({
      autoRespond: (bytes) => (hex(bytes) === '1f 11 50' ? undefined : identity(bytes)),
    })
    transport.creditsPerWrite = 1
    const driver = new BlePrinterDriver(transport, { doneTimeoutMs: 1 })
    await driver.connect()
    transport.reset()

    const warnings: string[] = []
    driver.on('log', (l) => {
      if (l.level === 'warn') warnings.push(l.message)
    })
    // Small, so no follow-up is in play: the wait is the only thing under test.
    await driver.print({ bitmap: checkerboard(384, 64), settings: DEFAULT_PRINT_SETTINGS })
    expect(warnings.join(' ')).toMatch(/never confirmed it finished/i)
  })

  it('leaves a normal-sized job alone', async () => {
    const { transport, driver } = await connected()
    await driver.print({ bitmap: checkerboard(384, 64), settings: DEFAULT_PRINT_SETTINGS })
    expect(occurrences(transport.writes, '1f c0 01 00')).toBe(1)
    expect(occurrences(transport.writes, '1f 12 20 00')).toBe(1)
  })

  it('emits the same bytes as the virtual printer for an oversized label too', async () => {
    // The small-label case below did not cover the follow-up, and the drivers
    // promptly disagreed about it: the virtual one sent the seek job's stream and
    // stopped, leaving off the tear advance that ends the print. Anything the
    // oversize path does has to be in both.
    const { transport, driver } = acknowledging()
    await driver.connect()
    transport.reset()
    const bitmap = noisyBitmap(384, 360)
    const settings = { ...DEFAULT_PRINT_SETTINGS, followUpSeek: true }
    await driver.print({ bitmap, settings })

    const virtual = new VirtualPrinterDriver(Infinity)
    await virtual.connect()
    await virtual.print({ bitmap, settings })

    expect(hex(concat([...virtual.printouts[0].wire]))).toBe(hex(concat(transport.writes)))
  }, 30_000)

  it('emits the same bytes as the virtual printer, in the same order', async () => {
    // Both build from cmd.printJobFraming, so this cannot drift — but only the
    // *bytes* are shared. Transfer boundaries are not: the real driver chunks the
    // whole stream and the virtual one keeps each command on its own line so the
    // log stays readable. Comparing the concatenation is what the claim in the UI
    // actually means.
    const { transport, driver } = await connected()
    const bitmap = checkerboard(384, 64)
    await driver.print({ bitmap, settings: DEFAULT_PRINT_SETTINGS })

    const virtual = new VirtualPrinterDriver(Infinity)
    await virtual.connect()
    await virtual.print({ bitmap, settings: DEFAULT_PRINT_SETTINGS })

    expect(hex(concat(transport.writes))).toBe(hex(concat([...virtual.printouts[0].wire])))
  })

  it('seeks the boundary its paper type actually has', async () => {
    // The trailer used to hard-code gap mode. On continuous stock that told the
    // printer "continuous" and then asked it to find a gap there is none of.
    const { transport, driver } = await connected()
    await driver.print({
      bitmap: checkerboard(64, 16),
      settings: { ...DEFAULT_PRINT_SETTINGS, paperType: PaperType.Continuous },
    })
    const framing = splitJob(transport.writes).framing
    expect(framing).toContain('1f 80 02 10') // setPaperTypeSilent(continuous)
    expect(framing).toContain('1f 12 10 00') // locate(none) — matching
    expect(framing).not.toContain('1f 12 20 00')
  })

  it('repeats the job framing, and the gap seek, per copy', async () => {
    // A silent printer must not stall a multi-copy run, so the wait for the
    // end-of-job "OK" is cut short here rather than being skipped: that keeps the
    // timeout path itself under test.
    const transport = new MockTransport({ autoRespond: identityResponder() })
    const driver = new BlePrinterDriver(transport, { doneTimeoutMs: 5 })
    await driver.connect()
    transport.reset()

    await driver.print({
      bitmap: checkerboard(64, 16),
      settings: { ...DEFAULT_PRINT_SETTINGS, copies: 3 },
    })
    expect(occurrences(transport.writes, '1f c0 01 00')).toBe(3)
    // Each copy has to seek, or only the first lands on a label.
    expect(occurrences(transport.writes, '1f 12 20 00')).toBe(3)
  })

  it('carries on to the next copy when the printer sends its end-of-job OK', async () => {
    const transport = new MockTransport({ autoRespond: identityResponder() })
    // Long enough that a timeout would fail the test: only a real "OK" can let
    // the second copy start.
    const driver = new BlePrinterDriver(transport, { doneTimeoutMs: 60_000 })
    await driver.connect()
    transport.reset()

    // Deferred rather than sent from autoRespond: that fires while the write is
    // still in flight, so the driver would not yet be listening and would sit out
    // the whole timeout — which is the bug this test exists to catch.
    transport.on('wire', (event) => {
      if (event.direction === 'out' && hex(event.bytes) === '1f 11 50') {
        setTimeout(() => transport.emit('status', Uint8Array.of(0x4f, 0x4b)), 0)
      }
    })

    await driver.print({
      bitmap: checkerboard(64, 16),
      settings: { ...DEFAULT_PRINT_SETTINGS, copies: 2 },
    })
    expect(occurrences(transport.writes, '1f c0 01 00')).toBe(2)
  })

  it('reports progress that ends complete and never overshoots', async () => {
    const { driver } = await connected()
    const seen: PrintProgress[] = []
    driver.on('progress', (p) => seen.push(p))
    await driver.print({ bitmap: checkerboard(384, 48), settings: DEFAULT_PRINT_SETTINGS })

    expect(seen[0].phase).toBe('prepare')
    const last = seen.at(-1)!
    expect(last.phase).toBe('done')
    expect(last.sent).toBe(last.total)
    for (const p of seen) expect(p.sent).toBeLessThanOrEqual(p.total)
  })

  it('aborts mid-transfer and leaves the printer usable', async () => {
    const { driver } = await connected()
    const controller = new AbortController()
    driver.on('progress', (p) => {
      if (p.phase === 'transfer' && p.sent > 0) controller.abort()
    })
    await expect(
      driver.print(
        { bitmap: checkerboard(384, 600), settings: DEFAULT_PRINT_SETTINGS },
        { signal: controller.signal },
      ),
    ).rejects.toThrow()
    expect(driver.state).toBe('connected')
  })

  it('surfaces every byte for the diagnostics log', async () => {
    // Counting transfers used to stand in for this and no longer can: a small
    // label is now one chunk plus the epilogue, so a count would pass while
    // saying nothing. Compare the bytes instead, which is what the log is for —
    // a byte missing from it is a byte nobody can diagnose.
    const { transport, driver } = await connected()
    const logged: Uint8Array[] = []
    driver.on('wire', (w) => {
      if (w.dir === 'out') logged.push(w.bytes)
    })
    await driver.print({ bitmap: checkerboard(64, 16), settings: DEFAULT_PRINT_SETTINGS })
    expect(hex(concat(logged))).toBe(hex(concat(transport.writes)))
    expect(splitJob(logged).framing).toContain('1f 12 20 00')
  })

  it('refuses to print while disconnected', async () => {
    const driver = new BlePrinterDriver(new MockTransport())
    await expect(
      driver.print({ bitmap: checkerboard(8, 8), settings: DEFAULT_PRINT_SETTINGS }),
    ).rejects.toThrow(/not connected/i)
  })

  it('drops back to disconnected and reports why when the link is lost', async () => {
    const { transport, driver } = await connected()
    const errors: string[] = []
    driver.on('error', (e) => errors.push(e.message))

    transport.simulateLinkLoss('The printer went out of range.')

    expect(driver.state).toBe('disconnected')
    expect(driver.capabilities).toBeNull()
    expect(errors).toContain('The printer went out of range.')
    // Stale capabilities would let the UI keep offering to print into the void.
    await expect(
      driver.print({ bitmap: checkerboard(8, 8), settings: DEFAULT_PRINT_SETTINGS }),
    ).rejects.toThrow(/not connected/i)
  })
})

describe('CreditWindow', () => {
  it('does not block when the printer never grants credits', async () => {
    // A printer without flow control must not stall the whole job waiting for a
    // signal that is never coming.
    const window = new CreditWindow()
    await expect(window.acquire({ timeoutMs: 50 })).resolves.toBeUndefined()
    expect(window.hasFlowControl).toBe(false)
    expect(window.delayMs).toBe(30)
  })

  it('ignores frames that are not credit grants', () => {
    // A real P50S sends `02 dc 00` on this channel alongside the `01 01` grants.
    // Reading byte 1 regardless of frame type — as the vendor SDK does — would
    // bank 220 phantom credits and disable flow control for the whole session,
    // which shows up as bands missing from long labels and nothing else.
    const window = new CreditWindow()
    window.onNotify(Uint8Array.of(0x02, 0xdc, 0x00))
    expect(window.available).toBe(0)
    expect(window.hasFlowControl).toBe(false)

    window.onNotify(Uint8Array.of(0x01, 0x01))
    expect(window.available).toBe(1)
    expect(window.hasFlowControl).toBe(true)
  })

  it('opens with a window of 4, as observed on real hardware', () => {
    const window = new CreditWindow()
    window.onNotify(Uint8Array.of(0x01, 0x04))
    expect(window.available).toBe(4)
  })

  it('treats a value of 4 as a window and anything else as an increment', () => {
    const window = new CreditWindow()
    window.onNotify(Uint8Array.of(0x01, 0x04))
    expect(window.available).toBe(4)
    window.onNotify(Uint8Array.of(0x01, 0x02))
    expect(window.available).toBe(6)
    window.onNotify(Uint8Array.of(0x01, 0x04))
    expect(window.available).toBe(4)
  })

  it('consumes a credit per acquire and switches to the fast delay', async () => {
    const window = new CreditWindow()
    window.onNotify(Uint8Array.of(0x01, 0x02))
    expect(window.delayMs).toBe(5)
    await window.acquire()
    expect(window.available).toBe(1)
    await window.acquire()
    expect(window.available).toBe(0)
  })

  it('waits for a credit once flow control is active, then proceeds', async () => {
    const window = new CreditWindow()
    window.onNotify(Uint8Array.of(0x01, 0x01))
    await window.acquire()

    let resolved = false
    const pending = window.acquire({ timeoutMs: 5000 }).then(() => {
      resolved = true
    })
    await Promise.resolve()
    expect(resolved).toBe(false)

    window.onNotify(Uint8Array.of(0x01, 0x01))
    await pending
    expect(resolved).toBe(true)
  })

  it('recovers rather than hanging if credits stop arriving', async () => {
    vi.useFakeTimers()
    try {
      const window = new CreditWindow()
      window.onNotify(Uint8Array.of(0x01, 0x01))
      await window.acquire()

      const pending = window.acquire({ timeoutMs: 1000 })
      vi.advanceTimersByTime(1001)
      await expect(pending).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('is abortable while waiting', async () => {
    const window = new CreditWindow()
    window.onNotify(Uint8Array.of(0x01, 0x01))
    await window.acquire()

    const controller = new AbortController()
    const pending = window.acquire({ timeoutMs: 5000, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toBeDefined()
  })
})

describe('gap calibration', () => {
  it('locates three times before asking for the height, as the vendor SDK requires', async () => {
    // The vendor's own comment: ask for the height before locating a few labels
    // and the value comes back inaccurate.
    const transport = new MockTransport({
      autoRespond: (bytes) => {
        const key = hex(bytes)
        if (key === '1d 0c') return Uint8Array.of(0x4f, 0x4b) // OK
        if (key === '10 ff 50 f2') return Uint8Array.of(0x00, 0xf0) // 240 dots
        return identityResponder()(bytes)
      },
    })
    const driver = new BlePrinterDriver(transport, { queryTimeoutMs: 50 })
    await driver.connect()
    transport.reset()

    const passes: number[] = []
    const result = await driver.calibrateLabelGap({ onPass: (pass) => passes.push(pass) })

    const sent = transport.writes.map(hex)
    expect(sent.filter((b) => b === '1d 0c')).toHaveLength(3)
    expect(passes).toEqual([1, 2, 3])
    // The height query must come after the last locate, not before.
    expect(sent.lastIndexOf('1d 0c')).toBeLessThan(sent.indexOf('10 ff 50 f2'))
    expect(result.labelHeightDots).toBe(240)
  })

  it('reports no height rather than a wrong one when the printer stays silent', async () => {
    const transport = new MockTransport()
    const driver = new BlePrinterDriver(transport, { queryTimeoutMs: 20 })
    await driver.connect()
    const result = await driver.calibrateLabelGap({ passes: 2 })
    expect(result.labelHeightDots).toBeNull()
    expect(result.passes).toEqual([null, null])
  })

  it('refuses to calibrate while disconnected', async () => {
    const driver = new BlePrinterDriver(new MockTransport())
    await expect(driver.calibrateLabelGap()).rejects.toThrow(/not connected/i)
  })
})
