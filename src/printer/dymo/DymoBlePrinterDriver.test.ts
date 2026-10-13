import { describe, expect, it } from 'vitest'
import { MockTransport } from '../transport/MockTransport'
import { createPackedBitmap, setDot } from '../../model/bitmap'
import { DEFAULT_PRINT_SETTINGS } from '../types'
import { MAGIC, PrintResult } from './constants'
import { DymoBlePrinterDriver, type DymoPrinterOptions } from './DymoBlePrinterDriver'

const status = (s: number) => Uint8Array.of(0x1b, 0x52, s)
const isProbe = (b: Uint8Array) => b.length === 3 && b[0] === 0x1b && b[1] === 0x41 && b[2] === 0
const isHeader = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xf0
const isLastChunk = (b: Uint8Array) =>
  b.length >= 2 && b[b.length - 2] === MAGIC[0] && b[b.length - 1] === MAGIC[1]

/**
 * A printer that answers the probe, then answers job writes with `respond`.
 * Timeouts are short so a wait that never resolves shows up as a warning, fast.
 */
function printer(
  respond: (bytes: Uint8Array, transport: MockTransport) => Uint8Array | undefined,
  options: DymoPrinterOptions = {},
) {
  const transport = new MockTransport({ deviceName: 'Letratag10B41D81FA5A' })
  transport.autoRespond = (b) => (isProbe(b) ? status(0) : respond(b, transport))
  const driver = new DymoBlePrinterDriver(transport, {
    probeTimeoutMs: 50,
    resultTimeoutMs: 200,
    ...options,
  })
  const warnings: string[] = []
  driver.on('log', (e) => {
    if (e.level === 'warn') warnings.push(e.message)
  })
  return { transport, driver, warnings }
}

/** What every capture shows: exactly one result, after the job's last chunk. */
const answersWith = (s: number) => (b: Uint8Array) => (isLastChunk(b) ? status(s) : undefined)

const job = (widthDots = 30, heightDots = 10) => ({
  bitmap: createPackedBitmap(widthDots, heightDots),
  settings: { ...DEFAULT_PRINT_SETTINGS, copies: 1 },
})

describe('DymoBlePrinterDriver', () => {
  it('reports identity recovered from the advertised name', async () => {
    const { driver } = printer(answersWith(PrintResult.Success))
    await driver.connect()
    expect(driver.capabilities).toMatchObject({
      model: 'DYMO LetraTag LT-200B',
      mac: '10:B4:1D:81:FA:5A',
      profileId: 'dymo',
      support: 'unverified',
      headWidthDots: 30,
    })
  })

  it('sends the standalone probe write before any job', async () => {
    const { transport, driver } = printer(answersWith(PrintResult.Success))
    await driver.connect()
    expect(transport.writes[0]).toEqual(Uint8Array.of(0x1b, 0x41, 0x00))
  })

  it('connects even if the probe is never answered', async () => {
    const transport = new MockTransport({ deviceName: 'Letratag10B41D81FA5A' })
    const driver = new DymoBlePrinterDriver(transport, { probeTimeoutMs: 20 })
    await expect(driver.connect()).resolves.toMatchObject({ profileId: 'dymo' })
  })

  it('finishes on the single result notification the captures show', async () => {
    // The regression: a rule discarding the first notification threw this one
    // away and every print ended in "never confirmed it finished".
    const { transport, driver, warnings } = printer(answersWith(PrintResult.Success))
    await driver.connect()
    const before = transport.writes.length
    await driver.print(job())
    expect(transport.writes[before].subarray(0, 4)).toEqual(Uint8Array.of(0xff, 0xf0, 0x12, 0x34))
    expect(warnings).toEqual([])
    expect(driver.state).toBe('connected')
  })

  it('waits past a provisional "printing" notification for the result', async () => {
    const { driver, warnings } = printer((b, transport) => {
      if (!isLastChunk(b)) return undefined
      setTimeout(() => transport.emit('status', status(PrintResult.Success)), 10)
      return status(PrintResult.SuccessAlt)
    })
    await driver.connect()
    await driver.print(job())
    expect(warnings).toEqual([])
  })

  it('does not take a stray success before the job is sent as its result', async () => {
    // Answering the header, mid-transfer: cannot be this job's result. With no real
    // result to follow, the wait has to run out — not end on the stray.
    // Emitted inside the write, not on a later tick: the mock's writes all complete
    // before any timer fires, so a deferred reply would land after the transfer.
    const { driver, warnings } = printer((b, transport) => {
      if (isHeader(b)) transport.emit('status', status(PrintResult.Success))
      return undefined
    })
    await driver.connect()
    await driver.print(job())
    expect(warnings.some((m) => /never confirmed/.test(m))).toBe(true)
  })

  it('reports a failure that arrives mid-transfer', async () => {
    const { driver } = printer((b, transport) => {
      if (isHeader(b)) transport.emit('status', status(PrintResult.Failed))
      return undefined
    })
    await driver.connect()
    await expect(driver.print(job())).rejects.toThrow(/status 2/)
  })

  it('warns rather than failing when no result ever arrives', async () => {
    const { driver, warnings } = printer(() => undefined)
    await driver.connect()
    await expect(driver.print(job())).resolves.toBeUndefined()
    expect(warnings.some((m) => /never confirmed/.test(m))).toBe(true)
  })

  it('rejects when the printer reports failure', async () => {
    const { driver } = printer(answersWith(PrintResult.Failed))
    await driver.connect()
    await expect(driver.print(job())).rejects.toThrow(/status 2/)
  })

  it('rejects with a specific message on a low battery', async () => {
    const { driver } = printer(answersWith(PrintResult.FailedLowBattery))
    await driver.connect()
    await expect(driver.print(job())).rejects.toThrow(/battery/i)
  })

  it('does not reject on a low-battery success, only warns', async () => {
    const { driver, warnings } = printer(answersWith(PrintResult.SuccessLowBattery))
    await driver.connect()
    await expect(driver.print(job())).resolves.toBeUndefined()
    expect(warnings.some((m) => /low battery/i.test(m))).toBe(true)
  })

  it('prints a tiny bitmap', async () => {
    const { driver } = printer(answersWith(PrintResult.Success))
    await driver.connect()
    const bm = createPackedBitmap(30, 5)
    setDot(bm, 0, 0, true)
    await expect(driver.print({ ...job(), bitmap: bm })).resolves.toBeUndefined()
  })
})
