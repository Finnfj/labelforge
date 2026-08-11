import { describe, expect, it } from 'vitest'
import { VirtualPrinterDriver } from './VirtualPrinterDriver'
import { encodeImage } from '../protocol/encodeImage'
import { checkerboard } from '../diagnostics/testPatterns'
import { DEFAULT_PRINT_SETTINGS, type PrintProgress } from '../types'
import { DEFAULT_CHUNK_SIZE } from '../protocol/constants'

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ')

/** No pacing delay: these assert ordering, not timing. */
const driver = () => new VirtualPrinterDriver(Infinity)

describe('VirtualPrinterDriver', () => {
  it('emits the documented print sequence', async () => {
    const p = driver()
    await p.connect()
    const bitmap = checkerboard(384, 32)
    await p.print({ bitmap, settings: DEFAULT_PRINT_SETTINGS })

    const [printout] = p.printouts
    expect(printout).toBeDefined()

    // Framing commands, in order, ignoring the raster chunks between them.
    const framing = printout.wire.filter((b) => b.length <= 5).map(hex)
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

  it('transmits exactly the encoded image, chunked', async () => {
    const p = driver()
    await p.connect()
    const bitmap = checkerboard(384, 64)
    await p.print({ bitmap, settings: DEFAULT_PRINT_SETTINGS })

    const expected = encodeImage(bitmap)
    // Raster chunks are everything that is not a framing command.
    const chunks = p.printouts[0].wire.filter((b) => b.length > 5)
    const joined = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
    let at = 0
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(DEFAULT_CHUNK_SIZE)
      joined.set(c, at)
      at += c.length
    }
    expect(Array.from(joined)).toEqual(Array.from(expected))
  })

  it('repeats the job framing per copy', async () => {
    const p = driver()
    await p.connect()
    await p.print({
      bitmap: checkerboard(64, 16),
      settings: { ...DEFAULT_PRINT_SETTINGS, copies: 3 },
    })
    const starts = p.printouts[0].wire.filter((b) => hex(b) === '1f c0 01 00')
    expect(starts).toHaveLength(3)
  })

  it('reports progress ending at 100% of the declared total', async () => {
    const p = driver()
    await p.connect()
    const seen: PrintProgress[] = []
    p.on('progress', (x) => seen.push(x))
    await p.print({ bitmap: checkerboard(384, 64), settings: DEFAULT_PRINT_SETTINGS })

    expect(seen[0].phase).toBe('prepare')
    const last = seen[seen.length - 1]
    expect(last.phase).toBe('done')
    expect(last.sent).toBe(last.total)
    // Monotonic, never overshooting.
    for (const s of seen) expect(s.sent).toBeLessThanOrEqual(s.total)
  })

  it('aborts mid-transfer without recording a printout', async () => {
    const p = driver()
    await p.connect()
    const controller = new AbortController()
    p.on('progress', (x) => {
      if (x.phase === 'transfer' && x.sent > 0) controller.abort()
    })
    await expect(
      p.print(
        { bitmap: checkerboard(384, 400), settings: DEFAULT_PRINT_SETTINGS },
        {
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow()
    expect(p.printouts).toHaveLength(0)
    // An aborted job must leave the printer usable, not stuck in "printing".
    expect(p.state).toBe('connected')
  })

  it('refuses to print while disconnected', async () => {
    await expect(
      driver().print({ bitmap: checkerboard(8, 8), settings: DEFAULT_PRINT_SETTINGS }),
    ).rejects.toThrow(/not connected/i)
  })
})
