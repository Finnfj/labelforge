import { describe, expect, it, vi } from 'vitest'
import { BlePrinterDriver } from './BlePrinterDriver'
import { MockTransport } from '../transport/MockTransport'
import { encodeImage } from '../protocol/encodeImage'
import { checkerboard } from '../diagnostics/testPatterns'
import { DEFAULT_PRINT_SETTINGS, type PrintProgress } from '../types'
import { CreditWindow } from '../protocol/CreditWindow'

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ')

/** Answers identity queries with plausible ASCII so probing does not time out. */
function identityResponder() {
  return (bytes: Uint8Array) => {
    const key = hex(bytes)
    const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
    if (key === '10 ff 20 f0') return text('P50S')
    if (key === '10 ff 20 f1') return text('V2.10')
    if (key === '10 ff 20 f2') return text('SN12345678')
    if (key === '10 ff 30 11') return text('AA:BB:CC:DD:EE:FF')
    if (key === '10 ff 50 f1') return Uint8Array.of(0x00, 0x5a) // 90
    if (key === '1f 20 00') return Uint8Array.of(0xff, 0x00)
    return undefined
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
    expect(capabilities.model).toBe('P50S')
    expect(capabilities.firmware).toBe('V2.10')
    expect(capabilities.serial).toBe('SN12345678')
    expect(driver.state).toBe('connected')
  })

  it('still connects when the printer answers nothing', async () => {
    // Reply formats are inferred, so a printer that stays silent must still be
    // usable rather than failing to connect.
    const transport = new MockTransport()
    const driver = new BlePrinterDriver(transport, { queryTimeoutMs: 20 })
    const capabilities = await driver.connect()
    expect(capabilities.model).toBe('Unknown')
    expect(capabilities.firmware).toBe('Unknown')
    expect(driver.state).toBe('connected')
  })

  it('emits the documented print sequence', async () => {
    const { transport, driver } = await connected()
    await driver.print({ bitmap: checkerboard(384, 32), settings: DEFAULT_PRINT_SETTINGS })

    const framing = transport.writes.filter((b) => b.length <= 5).map(hex)
    expect(framing).toEqual([
      '1f 80 01 20', // setPaperType(gap)
      '1f 70 01 08', // setDensity(8)
      '1f 60 01 01', // setSpeed(medium)
      '1f c0 01 00', // startPrintJob
      '1f 11 51', //    alignPaperStart
      '1f c0 01 01', // stopPrintJob
      '1f 11 50', //    alignPaperEnd
    ])
  })

  it('transmits exactly the encoded image, chunked to the negotiated size', async () => {
    const { transport, driver } = await connected()
    const bitmap = checkerboard(384, 64)
    await driver.print({ bitmap, settings: DEFAULT_PRINT_SETTINGS })

    const chunks = transport.writes.filter((b) => b.length > 5)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(90)

    const joined = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
    let at = 0
    for (const chunk of chunks) {
      joined.set(chunk, at)
      at += chunk.length
    }
    expect(Array.from(joined)).toEqual(Array.from(encodeImage(bitmap)))
  })

  it('repeats the job framing per copy', async () => {
    const { transport, driver } = await connected()
    await driver.print({
      bitmap: checkerboard(64, 16),
      settings: { ...DEFAULT_PRINT_SETTINGS, copies: 3 },
    })
    expect(transport.writes.filter((b) => hex(b) === '1f c0 01 00')).toHaveLength(3)
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
