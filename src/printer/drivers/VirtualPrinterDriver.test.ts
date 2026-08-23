import { describe, expect, it } from 'vitest'
import { VirtualPrinterDriver } from './VirtualPrinterDriver'
import { encodeImage } from '../protocol/encodeImage'
import { checkerboard } from '../diagnostics/testPatterns'
import { DEFAULT_PRINT_SETTINGS, type PrintProgress } from '../types'
import { DEFAULT_CHUNK_SIZE } from '../protocol/constants'

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ')

/** No pacing delay: these assert ordering, not timing. */
const driver = () => new VirtualPrinterDriver(Infinity)

/**
 * Split a printout's writes into framing commands and raster chunks.
 *
 * Bracketed by position rather than filtered by length. Length worked only while
 * the virtual driver still sent the 4-byte `setDensity`; the captured sequence
 * uses the 10-byte `setPrintParams`, which is longer than a chunk of a small
 * label. The same trap caught the BLE driver's test, and the same fix applies —
 * bracketing is exact, and asserts the boundaries are where they should be.
 */
function splitJob(wire: Uint8Array[]) {
  const start = wire.findIndex((b) => hex(b) === '1f 11 51')
  const end = wire.findIndex((b) => hex(b) === '1f 12 20 00')
  expect(start, 'alignPaperStart is missing').toBeGreaterThanOrEqual(0)
  expect(end, 'the gap seek is missing').toBeGreaterThan(start)
  return {
    framing: [...wire.slice(0, start + 1), ...wire.slice(end)].map(hex),
    chunks: wire.slice(start + 1, end),
  }
}

describe('VirtualPrinterDriver', () => {
  it('emits the documented print sequence', async () => {
    const p = driver()
    await p.connect()
    const bitmap = checkerboard(384, 32)
    await p.print({ bitmap, settings: DEFAULT_PRINT_SETTINGS })

    const [printout] = p.printouts
    expect(printout).toBeDefined()

    // The captured vendor sequence, which the BLE driver also asserts verbatim.
    // Both now build it from cmd.printJobFraming, so this test and its BLE twin
    // fail together if either side is changed alone.
    expect(splitJob(printout.wire).framing).toEqual([
      '1f 80 02 20', //                     setPaperTypeSilent(gap), mode 02
      '1f 70 02 08 00 00 00 00 00 00', //   setPrintParams(8)
      '1f c0 01 00', //                     startPrintJob
      '1f 11 51', //                        alignPaperStart
      '1f 12 20 00', //                     locate(Gap) — the alignment fix
      '1f c0 01 01', //                     stopPrintJob
      '1f 11 50', //                        alignPaperEnd
    ])
  })

  it('transmits exactly the encoded image, chunked', async () => {
    const p = driver()
    await p.connect()
    const bitmap = checkerboard(384, 64)
    await p.print({ bitmap, settings: DEFAULT_PRINT_SETTINGS })

    const expected = encodeImage(bitmap)
    const { chunks } = splitJob(p.printouts[0].wire)
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
    const wire = p.printouts[0].wire
    // Configuration rides along per copy, inside the job, as the capture shows —
    // it used to be sent once before the loop, which is not what the vendor app
    // does and not what the BLE driver does.
    for (const command of ['1f 80 02 20', '1f c0 01 00', '1f 12 20 00', '1f 11 50']) {
      expect(
        wire.filter((b) => hex(b) === command),
        command,
      ).toHaveLength(3)
    }
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
