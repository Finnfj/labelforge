import { describe, expect, it, vi } from 'vitest'
import { BlePrinterDriver, IncompatiblePrinterError } from './BlePrinterDriver'
import { MockTransport } from '../transport/MockTransport'
import { checkerboard } from '../diagnostics/testPatterns'
import { DEFAULT_PRINT_SETTINGS, type PrintProgress } from '../types'
import { CreditWindow } from './CreditWindow'
import { findProfile } from '../profiles'
import { planStreamBytes } from '../dialect'
import { concatBytes } from '../../lib/bytes'
import { START, testDialect, testPrinter } from '../dialects/testing/testDialect'

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

describe('BlePrinterDriver connecting', () => {
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
})

/*
 * Printing, through a dialect that is not x2.
 *
 * What a print says is the dialect's business and is tested there; the exact x2
 * bytes this driver writes are pinned in wire.snapshot.test.ts. What is left here
 * is what the driver adds: every job as one credited stream in chunks, its
 * epilogue after it, and the waits the plan asks for.
 */

/** A connected driver printing in the test dialect to a printer that speaks it. */
async function printing(
  options: { silent?: boolean; doneTimeoutMs?: number; bandRows?: number; waitMs?: number } = {},
) {
  const transport = new MockTransport()
  transport.creditsPerWrite = 1
  const dialect = testDialect({ bandRows: options.bandRows, waitMs: options.waitMs })
  const driver = new BlePrinterDriver(transport, {
    dialect,
    queryTimeoutMs: 20,
    doneTimeoutMs: options.doneTimeoutMs ?? 1,
  })
  await driver.connect()
  const printer = testPrinter(transport, { silent: options.silent })
  transport.reset()
  return { transport, driver, printer, dialect }
}

function warningsOf(driver: BlePrinterDriver): string[] {
  const warnings: string[] = []
  driver.on('log', (l) => {
    if (l.level === 'warn') warnings.push(l.message)
  })
  return warnings
}

describe('BlePrinterDriver printing a plan', () => {
  it('sends each job as one stream in chunks, then its epilogue as a write of its own', async () => {
    // A command can and does straddle two chunks: the printer parses a byte
    // stream, and chunking the whole job is what keeps every byte credited.
    const { transport, driver, dialect } = await printing()
    const bitmap = checkerboard(384, 8)
    await driver.print({ bitmap, settings: DEFAULT_PRINT_SETTINGS })

    // Two jobs of 3 + 192 + 1 bytes, at 90 a chunk, and the end byte after the last.
    expect(transport.writes.map((w) => w.length)).toEqual([90, 90, 16, 90, 90, 16, 1])
    const plan = dialect.planPrint(bitmap, DEFAULT_PRINT_SETTINGS)
    const expected = plan.copies
      .flatMap((copy) => copy.jobs)
      .flatMap((job) => [...job.parts.map((p) => p.bytes), ...job.epilogue.map((c) => c.bytes)])
    expect(hex(transport.written)).toBe(hex(concatBytes(expected)))
  })

  it('sends no byte of a job without a credit in hand', async () => {
    // The bug this exists for, from a real wire log of an 80 mm label: a long
    // raster drained the credit window, and the framing written outside the chunk
    // loop went out with nothing granted. The first of it was the gap seek, and
    // the label came out unregistered. The window here is small so any job is
    // long enough to drain it.
    const { transport, driver } = await printing({ bandRows: 16 })
    transport.creditsPerWrite = 0
    transport.openCreditWindow(2)
    await driver.print({
      bitmap: checkerboard(384, 48),
      settings: { ...DEFAULT_PRINT_SETTINGS, copies: 2 },
    })
    expect(transport.writes.length).toBeGreaterThan(10)
    expect(transport.blindWrites.map(hex)).toEqual([])
  })

  it('waits for each job to be acknowledged before sending the next', async () => {
    // Back-to-back lost two thirds of a label: the printer accepted the first job,
    // printed it, answered once and dropped the rest.
    const { transport, driver } = await printing({ doneTimeoutMs: 5000, waitMs: 5000 })
    const order: string[] = []
    transport.on('wire', (w) => {
      if (w.direction === 'out' && w.bytes[0] === START) order.push('job')
      if (w.direction === 'in' && hex(w.bytes) === '4f 4b') order.push('ok')
    })
    await driver.print({ bitmap: checkerboard(64, 12), settings: DEFAULT_PRINT_SETTINGS })

    expect(order).toEqual(['job', 'ok', 'job', 'ok', 'job', 'ok'])
  })

  it('waits at least as long as the plan says before giving up', async () => {
    const { driver } = await printing({ silent: true, waitMs: 60 })
    const started = Date.now()
    await driver.print({ bitmap: checkerboard(64, 4), settings: DEFAULT_PRINT_SETTINGS })
    expect(Date.now() - started).toBeGreaterThanOrEqual(55)
  })

  it('stops the copy and says so when a job that has to be acknowledged is not', async () => {
    // Pressing on would send the next job into a printer still moving paper.
    // Half a label plus a warning beats a whole one printed somewhere unpredictable.
    const { driver, printer } = await printing({ silent: true })
    const warnings = warningsOf(driver)
    await driver.print({ bitmap: checkerboard(64, 12), settings: DEFAULT_PRINT_SETTINGS })

    expect(printer.jobsRead).toBe(1)
    expect(warnings[0]).toMatch(/label is incomplete/i)
    // The copy still waits out its last job's wait, so the printer has stopped
    // before anything else is sent, and says it never heard the end.
    expect(warnings[1]).toMatch(/never confirmed it finished/i)
    expect(warnings).toHaveLength(2)
  })

  it('goes on to the next copy after one was cut short', async () => {
    const { driver, printer } = await printing({ silent: true })
    await driver.print({
      bitmap: checkerboard(64, 12),
      settings: { ...DEFAULT_PRINT_SETTINGS, copies: 2 },
    })
    expect(printer.jobsRead).toBe(2)
  })

  it('waits for the printer to finish even when nothing follows', async () => {
    // Without this, `done` fired while a full-height label still had ten seconds
    // to print, and a job the printer never finished looked like one it did.
    const { driver } = await printing({ silent: true })
    const warnings = warningsOf(driver)
    await driver.print({ bitmap: checkerboard(64, 4), settings: DEFAULT_PRINT_SETTINGS })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/never confirmed it finished/i)
  })

  it('carries on as soon as the printer says done, without waiting out the timeout', async () => {
    // A timeout this long would fail the test: only a real "OK" lets it finish.
    const { driver, printer } = await printing({ doneTimeoutMs: 60_000, waitMs: 60_000 })
    await driver.print({
      bitmap: checkerboard(64, 8),
      settings: { ...DEFAULT_PRINT_SETTINGS, copies: 2 },
    })
    expect(printer.jobsRead).toBe(4)
  })

  it('reports progress over the stream bytes, ending complete and never overshooting', async () => {
    const { driver, dialect } = await printing()
    const bitmap = checkerboard(384, 8)
    const seen: PrintProgress[] = []
    driver.on('progress', (p) => seen.push(p))
    await driver.print({ bitmap, settings: DEFAULT_PRINT_SETTINGS })

    const total = planStreamBytes(dialect.planPrint(bitmap, DEFAULT_PRINT_SETTINGS))
    expect(seen[0].phase).toBe('prepare')
    expect(seen[0].total).toBe(total)
    const last = seen.at(-1)!
    expect(last.phase).toBe('done')
    expect(last.sent).toBe(total)
    for (const p of seen) expect(p.sent).toBeLessThanOrEqual(p.total)
  })

  it('aborts mid-transfer and leaves the printer usable', async () => {
    const { driver } = await printing({ bandRows: 64 })
    const controller = new AbortController()
    driver.on('progress', (p) => {
      if (p.phase === 'transfer' && p.sent > 0) controller.abort()
    })
    await expect(
      driver.print(
        { bitmap: checkerboard(384, 64), settings: DEFAULT_PRINT_SETTINGS },
        { signal: controller.signal },
      ),
    ).rejects.toThrow()
    expect(driver.state).toBe('connected')
  })

  it('surfaces every byte for the diagnostics log', async () => {
    // A byte missing from the log is a byte nobody can diagnose.
    const { transport, driver } = await printing()
    const logged: Uint8Array[] = []
    driver.on('wire', (w) => {
      if (w.dir === 'out') logged.push(w.bytes)
    })
    await driver.print({ bitmap: checkerboard(64, 8), settings: DEFAULT_PRINT_SETTINGS })
    expect(hex(concatBytes(logged))).toBe(hex(transport.written))
  })

  it('refuses to print while disconnected', async () => {
    const driver = new BlePrinterDriver(new MockTransport(), { dialect: testDialect() })
    await expect(
      driver.print({ bitmap: checkerboard(8, 8), settings: DEFAULT_PRINT_SETTINGS }),
    ).rejects.toThrow(/not connected/i)
  })

  it('drops back to disconnected and reports why when the link is lost', async () => {
    const { transport, driver } = await printing()
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
