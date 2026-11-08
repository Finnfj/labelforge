import { describe, expect, it } from 'vitest'
import { VirtualPrinterDriver } from './VirtualPrinterDriver'
import { checkerboard } from '../diagnostics/testPatterns'
import { DEFAULT_PRINT_SETTINGS, type PrintProgress } from '../types'
import { DEFAULT_CHUNK_SIZE } from '../dialects/x2/constants'
import { planStreamBytes } from '../dialect'
import { testDialect } from '../dialects/testing/testDialect'
import { x2 } from '../dialects/x2'

/*
 * Recording a print, through a dialect that is not x2.
 *
 * What a print says is the dialect's business and is tested there; the exact x2
 * bytes this driver records are pinned in wire.snapshot.test.ts. What is left here
 * is how it records them.
 */

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ')

/** No pacing delay: these assert ordering, not timing. */
const driver = (bandRows = 4) =>
  new VirtualPrinterDriver(Infinity, { dialect: testDialect({ bandRows }) })

describe('VirtualPrinterDriver', () => {
  it('records each command on a line of its own, and the raster in chunks', async () => {
    // A real printer would see one stream; a log is read by a person, so each
    // command keeps its own line and its name.
    const p = driver(8)
    await p.connect()
    const lines: string[] = []
    p.on('wire', (w) => lines.push(w.note ?? `raster ${w.bytes.length}`))
    await p.print({ bitmap: checkerboard(384, 8), settings: DEFAULT_PRINT_SETTINGS })

    // 8 rows of 48 bytes is 384 bytes of raster: four full chunks and the rest.
    expect(DEFAULT_CHUNK_SIZE).toBe(90)
    expect(lines).toEqual([
      'start',
      'raster 90',
      'raster 90',
      'raster 90',
      'raster 90',
      'raster 24',
      'stop',
      'end',
    ])
  })

  it('records exactly the bytes of the plan, in order', async () => {
    const dialect = testDialect()
    const p = new VirtualPrinterDriver(Infinity, { dialect })
    await p.connect()
    const bitmap = checkerboard(64, 12)
    const settings = { ...DEFAULT_PRINT_SETTINGS, copies: 2 }
    await p.print({ bitmap, settings })

    const expected = dialect
      .planPrint(bitmap, settings)
      .copies.flatMap((copy) => copy.jobs)
      .flatMap((job) => [...job.parts, ...job.epilogue].map((p) => hex(p.bytes)))
    expect(p.printouts[0].wire.map(hex).join(' ')).toBe(expected.join(' '))
  })

  it('reports progress over the stream bytes, ending at 100%', async () => {
    const dialect = testDialect()
    const p = new VirtualPrinterDriver(Infinity, { dialect })
    await p.connect()
    const seen: PrintProgress[] = []
    p.on('progress', (x) => seen.push(x))
    const bitmap = checkerboard(384, 12)
    await p.print({ bitmap, settings: DEFAULT_PRINT_SETTINGS })

    // The same total the BLE driver reports for the same plan.
    const total = planStreamBytes(dialect.planPrint(bitmap, DEFAULT_PRINT_SETTINGS))
    expect(seen[0].phase).toBe('prepare')
    expect(seen[0].total).toBe(total)
    const last = seen[seen.length - 1]
    expect(last.phase).toBe('done')
    expect(last.sent).toBe(total)
    for (const s of seen) expect(s.sent).toBeLessThanOrEqual(s.total)
  })

  it('aborts mid-transfer without recording a printout', async () => {
    const p = driver(64)
    await p.connect()
    const controller = new AbortController()
    p.on('progress', (x) => {
      if (x.phase === 'transfer' && x.sent > 0) controller.abort()
    })
    await expect(
      p.print(
        { bitmap: checkerboard(384, 64), settings: DEFAULT_PRINT_SETTINGS },
        { signal: controller.signal },
      ),
    ).rejects.toThrow()
    expect(p.printouts).toHaveLength(0)
    // An aborted job must leave the printer usable, not stuck in "printing".
    expect(p.state).toBe('connected')
  })

  it('says which dialect it prints in, x2 unless told otherwise', () => {
    const dialect = testDialect()
    expect(new VirtualPrinterDriver(Infinity, { dialect }).dialect).toBe(dialect)
    expect(new VirtualPrinterDriver(Infinity).dialect).toBe(x2)
  })

  it('refuses to print while disconnected', async () => {
    await expect(
      driver().print({ bitmap: checkerboard(8, 8), settings: DEFAULT_PRINT_SETTINGS }),
    ).rejects.toThrow(/not connected/i)
  })
})
