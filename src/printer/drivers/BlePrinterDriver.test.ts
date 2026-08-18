import { describe, expect, it, vi } from 'vitest'
import { BlePrinterDriver, IncompatiblePrinterError } from './BlePrinterDriver'
import { MockTransport } from '../transport/MockTransport'
import { encodeImage } from '../protocol/encodeImage'
import { checkerboard } from '../diagnostics/testPatterns'
import { DEFAULT_PRINT_SETTINGS, type PrintProgress } from '../types'
import { CreditWindow } from '../protocol/CreditWindow'
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
 * Split a job's writes into framing commands and raster chunks.
 *
 * The raster is everything between `alignPaperStart` and the gap seek. Telling them
 * apart by length used to work and no longer does — `setPrintParams` is 10 bytes,
 * longer than a chunk of a tiny label — and prefix-matching fails too, because the
 * first raster chunk begins with the `1f 10` image opcode. Bracketing by position is
 * both exact and a free assertion that the boundaries are where they should be.
 */
function splitJob(writes: Uint8Array[]) {
  const start = writes.findIndex((b) => hex(b) === '1f 11 51')
  const end = writes.findIndex((b) => hex(b) === '1f 12 20 00')
  expect(start, 'alignPaperStart missing').toBeGreaterThanOrEqual(0)
  expect(end, 'gap seek missing or before the raster').toBeGreaterThan(start)
  return {
    raster: writes.slice(start + 1, end),
    framing: [...writes.slice(0, start + 1), ...writes.slice(end)],
  }
}

async function connected(options?: { credits?: number }) {
  const transport = new MockTransport({ autoRespond: identityResponder() })
  if (options?.credits) transport.creditsPerWrite = options.credits
  const driver = new BlePrinterDriver(transport)
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
    expect(splitJob(transport.writes).framing.map(hex)).toEqual([
      '1f 80 02 20', //                      setPaperTypeSilent(gap)
      '1f 70 02 08 00 00 00 00 00 00', //    setPrintParams(density 8)
      '1f 60 01 01', //                      setSpeed(medium) — not sent by the app
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

    const chunks = splitJob(transport.writes).raster
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(90)

    const joined = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
    let at = 0
    for (const chunk of chunks) {
      joined.set(chunk, at)
      at += chunk.length
    }
    expect(Array.from(joined)).toEqual(Array.from(encodeImage(bitmap)))
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
    expect(transport.writes.filter((b) => hex(b) === '1f c0 01 00')).toHaveLength(3)
    // Each copy has to seek, or only the first lands on a label.
    expect(transport.writes.filter((b) => hex(b) === '1f 12 20 00')).toHaveLength(3)
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
    expect(transport.writes.filter((b) => hex(b) === '1f c0 01 00')).toHaveLength(2)
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
    const { driver } = await connected()
    const wire: Array<{ dir: string; length: number }> = []
    driver.on('wire', (w) => wire.push({ dir: w.dir, length: w.bytes.length }))
    await driver.print({ bitmap: checkerboard(64, 16), settings: DEFAULT_PRINT_SETTINGS })
    expect(wire.filter((w) => w.dir === 'out').length).toBeGreaterThan(5)
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
