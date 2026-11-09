import { describe, expect, it, vi } from 'vitest'
import { BlePrinterDriver, IncompatiblePrinterError, PrintFailedError } from './BlePrinterDriver'
import { MockTransport } from '../transport/MockTransport'
import { checkerboard } from '../diagnostics/testPatterns'
import { DEFAULT_PRINT_SETTINGS, type PrintProgress, type PrintSettings } from '../types'
import type { PackedBitmap } from '../../model/bitmap'
import { CreditWindow } from './CreditWindow'
import { ALL_NAME_PREFIXES, ALL_SERVICES, findProfile, type DrivenProfile } from '../profiles'
import { planStreamBytes } from '../dialect'
import { concatBytes } from '../../lib/bytes'
import {
  DONE,
  DONE_WITH_WARNING,
  FAILED,
  FAILED_REASON,
  FRAME,
  START,
  WARNING,
  testDialect,
  testPrinter,
} from '../dialects/testing/testDialect'
import { x2 } from '../dialects/x2'
import type { CreditPacing } from '../dialect'

/** A profile no real printer has, speaking the test dialect, not yet confirmed. */
function experimentalProfile(): DrivenProfile {
  return {
    id: 'test-experimental',
    label: 'Test printer',
    namePrefixes: [],
    support: 'experimental',
    dialect: testDialect({ acknowledged: true }),
  }
}

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

    // The dialect's handshake goes out first, before anything is asked.
    expect(transport.writes[0]).toEqual(x2.conversation.handshake[0].bytes)
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
    expect(transport.writes[0]).toEqual(x2.conversation.handshake[0].bytes)
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

  it('asks the chooser for every known printer, and opens the service its dialect names', async () => {
    // The browser grants only services named before its chooser opens, and which
    // one a printer speaks is known only once its name is read.
    const transport = new MockTransport({ autoRespond: identityResponder() })
    await new BlePrinterDriver(transport, { queryTimeoutMs: 20 }).connect()
    expect(transport.connectOptions?.devices).toEqual({
      namePrefixes: ALL_NAME_PREFIXES,
      services: ALL_SERVICES,
    })
    expect(transport.layout).toBe(x2.link.gatt)
  })

  it('refuses an experimental printer without the opt-in, before opening its service', async () => {
    const transport = new MockTransport()
    const driver = new BlePrinterDriver(transport, {
      profile: experimentalProfile(),
      lockProfile: true,
    })
    const refusal = driver.connect()
    await expect(refusal).rejects.toBeInstanceOf(IncompatiblePrinterError)
    await expect(refusal).rejects.toThrow(/experimental/i)
    expect(transport.layout).toBeNull()
    expect(transport.writes).toHaveLength(0)
  })

  it('drives an experimental printer in its own dialect once opted in', async () => {
    const profile = experimentalProfile()
    const transport = new MockTransport()
    const driver = new BlePrinterDriver(transport, {
      profile,
      lockProfile: true,
      allowExperimental: true,
      queryTimeoutMs: 20,
    })
    const caps = await driver.connect()
    expect(caps.support).toBe('experimental')
    expect(driver.dialect).toBe(profile.dialect)
    expect(transport.layout).toBe(profile.dialect!.link.gatt)
  })
})

/*
 * Printing, through a dialect that is not x2.
 *
 * What a print says is the dialect's business and is tested there; the exact x2
 * bytes this driver writes are pinned in wire.snapshot.test.ts. What is left here
 * is what the driver adds: every job as one stream, in the chunks its link cuts and
 * paced as its link says, its epilogue after it, and the waits the plan asks for.
 */

/** A connected driver printing in the test dialect to a printer that speaks it. */
async function printing(
  options: {
    silent?: boolean
    reply?: number
    doneTimeoutMs?: number
    bandRows?: number
    waitMs?: number
    acknowledged?: boolean
  } = {},
) {
  const transport = new MockTransport()
  transport.creditsPerWrite = options.acknowledged ? 0 : 1
  const dialect = testDialect({
    bandRows: options.bandRows,
    waitMs: options.waitMs,
    acknowledged: options.acknowledged,
  })
  const driver = new BlePrinterDriver(transport, {
    dialect,
    queryTimeoutMs: 20,
    doneTimeoutMs: options.doneTimeoutMs ?? 1,
  })
  await driver.connect()
  const printer = testPrinter(transport, {
    silent: options.silent,
    reply: options.reply,
    framed: options.acknowledged,
  })
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

    // Two jobs of 3 + 192 + 1 bytes, at the test link's 64 a chunk, and the end byte
    // after the last.
    expect(transport.writes.map((w) => w.length)).toEqual([64, 64, 64, 4, 64, 64, 64, 4, 1])
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
      if (w.direction === 'in' && w.bytes[0] === DONE) order.push('done')
    })
    await driver.print({ bitmap: checkerboard(64, 12), settings: DEFAULT_PRINT_SETTINGS })

    expect(order).toEqual(['job', 'done', 'job', 'done', 'job', 'done'])
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

  it('writes the chunks its link frames, and on an acknowledged link waits for no credit', async () => {
    // No credit ever arrives here. A driver still waiting on credits would fall
    // back to its credit-less delay; one that knew no link but x2's would not
    // frame the chunks at all.
    const { transport, driver, printer, dialect } = await printing({ acknowledged: true })
    const bitmap = checkerboard(64, 8)
    await driver.print({ bitmap, settings: DEFAULT_PRINT_SETTINGS })

    const plan = dialect.planPrint(bitmap, DEFAULT_PRINT_SETTINGS)
    const expected = plan.copies.flatMap((copy) =>
      copy.jobs.flatMap((job) => [
        ...dialect.link.chunk(concatBytes(job.parts.map((p) => p.bytes)), dialect.link.chunkSize),
        ...job.epilogue.map((c) => c.bytes),
      ]),
    )
    expect(transport.writes.map(hex)).toEqual(expected.map(hex))
    expect(transport.writes.slice(0, -1).every((w) => w[0] === FRAME)).toBe(true)
    expect(printer.jobsRead).toBe(2)
  })

  it('ends the print when the printer reports it failed, and says why', async () => {
    // Silence is carried past, since the label may be fine. A printer that says it
    // gave up has said the label is not, so nothing more is sent.
    const { driver, printer } = await printing({ reply: FAILED })
    await expect(
      driver.print({
        bitmap: checkerboard(64, 8),
        settings: { ...DEFAULT_PRINT_SETTINGS, copies: 2 },
      }),
    ).rejects.toThrow(new PrintFailedError(FAILED_REASON))
    expect(printer.jobsRead).toBe(1)
    expect(driver.state).toBe('connected')
  })

  it('takes no "done" for a job while its stream is still going out', async () => {
    // A late answer to something earlier, such as a probe, can land mid-stream. Taken
    // as this job's, it would end the wait before the printer had read the job.
    const { transport, driver, printer } = await printing({
      doneTimeoutMs: 5000,
      waitMs: 5000,
    })
    const read = transport.autoRespond!
    let first = true
    transport.autoRespond = (bytes) => {
      if (first) {
        first = false
        transport.emit('status', Uint8Array.of(DONE))
      }
      return read(bytes)
    }
    const order: string[] = []
    driver.on('wire', (w) => {
      if (w.dir === 'out' && w.bytes[0] === START) order.push('job')
      if (w.dir === 'in' && w.bytes[0] === DONE) order.push('done')
    })
    await driver.print({ bitmap: checkerboard(64, 12), settings: DEFAULT_PRINT_SETTINGS })
    // The stray "done" landed while the first job was going out, and was dropped: the
    // second job waited for the first's own. Taken, it would have gone straight away.
    expect(printer.jobsRead).toBe(3)
    expect(order).toEqual(['job', 'done', 'done', 'job', 'done', 'job', 'done'])
  })

  it('goes on past a silent step the plan says is not worth stopping for', async () => {
    const transport = new MockTransport()
    transport.creditsPerWrite = 1
    const base = testDialect()
    const dialect = {
      ...base,
      planPrint: (bitmap: PackedBitmap, settings: PrintSettings) => {
        const plan = base.planPrint(bitmap, settings)
        const probe = {
          parts: [],
          epilogue: [{ bytes: Uint8Array.of(0x77), note: 'probe' }],
          waitMs: 1,
          goOnIfSilent: true,
        }
        return { copies: plan.copies.map((c) => ({ ...c, jobs: [probe, ...c.jobs] })) }
      },
    }
    const driver = new BlePrinterDriver(transport, {
      dialect,
      queryTimeoutMs: 20,
      doneTimeoutMs: 1,
    })
    await driver.connect()
    const printer = testPrinter(transport)
    const warnings = warningsOf(driver)
    await driver.print({ bitmap: checkerboard(64, 4), settings: DEFAULT_PRINT_SETTINGS })
    expect(printer.jobsRead).toBe(1)
    expect(warnings).toEqual([])
  })

  it('passes on a warning the printer adds to a job it finished', async () => {
    const { driver } = await printing({ reply: DONE_WITH_WARNING })
    const warnings = warningsOf(driver)
    await driver.print({ bitmap: checkerboard(64, 4), settings: DEFAULT_PRINT_SETTINGS })
    expect(warnings).toEqual([WARNING])
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

  it('says which dialect it prints in, x2 unless told otherwise', () => {
    // The print panel asks it for the density range and whether a label fits.
    const dialect = testDialect()
    expect(new BlePrinterDriver(new MockTransport(), { dialect }).dialect).toBe(dialect)
    expect(new BlePrinterDriver(new MockTransport()).dialect).toBe(x2)
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

/**
 * A pacing unlike x2's: `01 n` adds n credits, `02 n` sets the window to n, and
 * anything else grants nothing. What x2's own frames mean is tested on x2's link.
 */
const PACING: CreditPacing = {
  kind: 'credits',
  readGrant: (bytes) =>
    bytes.length < 2
      ? null
      : bytes[0] === 0x01
        ? { add: bytes[1] }
        : bytes[0] === 0x02
          ? { set: bytes[1] }
          : null,
  delayWithCreditsMs: 3,
  delayWithoutCreditsMs: 40,
}

describe('CreditWindow', () => {
  it('does not block when the printer never grants credits', async () => {
    // A printer without flow control must not stall the whole job waiting for a
    // signal that is never coming.
    const window = new CreditWindow(PACING)
    await expect(window.acquire({ timeoutMs: 50 })).resolves.toBeUndefined()
    expect(window.hasFlowControl).toBe(false)
    expect(window.delayMs).toBe(PACING.delayWithoutCreditsMs)
  })

  it('ignores a notification its pacing reads as no grant', () => {
    // Banking credits from a frame that grants none would disable flow control for
    // the rest of the session, which shows up as bands missing from long labels.
    const window = new CreditWindow(PACING)
    window.onNotify(Uint8Array.of(0x03, 0xdc, 0x00))
    expect(window.available).toBe(0)
    expect(window.hasFlowControl).toBe(false)

    window.onNotify(Uint8Array.of(0x01, 0x01))
    expect(window.available).toBe(1)
    expect(window.hasFlowControl).toBe(true)
  })

  it('sets the window where the grant says so, and adds to it otherwise', () => {
    const window = new CreditWindow(PACING)
    window.onNotify(Uint8Array.of(0x02, 0x04))
    expect(window.available).toBe(4)
    window.onNotify(Uint8Array.of(0x01, 0x02))
    expect(window.available).toBe(6)
    window.onNotify(Uint8Array.of(0x02, 0x04))
    expect(window.available).toBe(4)
  })

  it('consumes a credit per acquire and switches to the faster delay', async () => {
    const window = new CreditWindow(PACING)
    window.onNotify(Uint8Array.of(0x01, 0x02))
    expect(window.delayMs).toBe(PACING.delayWithCreditsMs)
    await window.acquire()
    expect(window.available).toBe(1)
    await window.acquire()
    expect(window.available).toBe(0)
  })

  it('waits for a credit once flow control is active, then proceeds', async () => {
    const window = new CreditWindow(PACING)
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
      const window = new CreditWindow(PACING)
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
    const window = new CreditWindow(PACING)
    window.onNotify(Uint8Array.of(0x01, 0x01))
    await window.acquire()

    const controller = new AbortController()
    const pending = window.acquire({ timeoutMs: 5000, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toBeDefined()
  })
})

describe('gap calibration', () => {
  it("hands calibration to the dialect, asking through the driver's queries", async () => {
    // How many passes and in what order is x2's business, tested on x2. What the
    // driver owes is a working way to ask, and the dialect's answer back.
    const transport = new MockTransport({ autoRespond: () => Uint8Array.of(0x42) })
    const base = testDialect()
    const dialect = {
      ...base,
      conversation: {
        ...base.conversation,
        calibrateLabelGap: async (ask: (c: Uint8Array) => Promise<Uint8Array | null>) => {
          const reply = await ask(Uint8Array.of(0x99))
          return { labelHeightDots: reply ? reply[0] : null, passes: [reply] }
        },
      },
    }
    const driver = new BlePrinterDriver(transport, { dialect, queryTimeoutMs: 50 })
    await driver.connect()
    transport.reset()

    const result = await driver.calibrateLabelGap()
    expect(transport.writes.map(hex)).toEqual(['99'])
    expect(result.labelHeightDots).toBe(0x42)
  })

  it('refuses to calibrate a printer whose dialect has no gap to find', async () => {
    const driver = new BlePrinterDriver(new MockTransport(), {
      dialect: testDialect(),
      queryTimeoutMs: 20,
    })
    await driver.connect()
    await expect(driver.calibrateLabelGap()).rejects.toThrow(/no label gap/i)
  })

  it('refuses to calibrate while disconnected', async () => {
    const driver = new BlePrinterDriver(new MockTransport())
    await expect(driver.calibrateLabelGap()).rejects.toThrow(/not connected/i)
  })
})
