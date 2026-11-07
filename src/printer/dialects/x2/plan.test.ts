import { describe, expect, it } from 'vitest'
import type { PackedBitmap } from '../../../model/bitmap'
import { noisyBitmap } from '../../../test/bitmaps'
import type { PlannedJob } from '../../dialect'
import { checkerboard } from '../../diagnostics/testPatterns'
import { printDurationMs, SEEK_SAFE_JOB_BYTES } from './constants'
import { encodeImage } from './encodeImage'
import { DEFAULT_PRINT_SETTINGS, type PrintSettings } from '../../types'
import { planX2Print } from './plan'
import { splitBudgetBytes } from './splitJob'
import { x2 } from '.'

/*
 * The x2 print plan, asserted directly: what each job of a print says, in order.
 *
 * These used to be asserted through the BLE driver, by parsing its writes back
 * into commands and waiting out real timers. The plan is a pure function, so they
 * are now plain values. What the drivers do with a plan — chunking, credits,
 * waiting — is tested in the drivers, with a dialect that is not x2. The exact
 * bytes both drivers put on the wire are pinned in drivers/wire.snapshot.test.ts.
 */

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ')

/** A job's parts as hex commands, with the raster shown as one word. */
const commands = (job: PlannedJob) =>
  job.parts.map((p) => (p.kind === 'raster' ? 'raster' : hex(p.bytes)))

const planOf = (bitmap: PackedBitmap, settings: Partial<PrintSettings> = {}) =>
  planX2Print(bitmap, { ...DEFAULT_PRINT_SETTINGS, ...settings })

/** The jobs of one copy, which is every copy. */
const plan = (bitmap: PackedBitmap, settings: Partial<PrintSettings> = {}) =>
  planOf(bitmap, settings).copies[0].jobs

const START = '1f c0 01 00'
const RETRACT = '1f 11 51'
const SEEK_GAP = '1f 12 20 00'
const TEAR_OFF = '1f 11 50'

describe('planX2Print', () => {
  it('is the vendor app print sequence for a label that fits, gap seek included', () => {
    // Transcribed from an HCI capture of the vendor Android app; see
    // docs/PROTOCOL.md. The seek between the raster and stopPrintJob is the sensor
    // gap seek, and its position is load-bearing: sent standalone it does nothing.
    const [job, ...rest] = plan(checkerboard(384, 32))
    expect(rest).toEqual([])
    expect(commands(job)).toEqual([
      '1f 80 02 20', //                      setPaperTypeSilent(gap)
      '1f 70 02 08 00 00 00 00 00 00', //    setPrintParams(density 8)
      START, //                              startPrintJob
      RETRACT, //                            alignPaperStart
      'raster',
      SEEK_GAP, //                           locate(gap)
      '1f c0 01 01', //                      stopPrintJob
    ])
    // The tear-off advance is a write of its own, after the job stream.
    expect(job.epilogue.map((c) => hex(c.bytes))).toEqual([TEAR_OFF])
  })

  it('carries exactly the encoded image as the raster', () => {
    const bitmap = checkerboard(384, 64)
    const raster = plan(bitmap)[0].parts.find((p) => p.kind === 'raster')!
    expect(Array.from(raster.bytes)).toEqual(Array.from(encodeImage(bitmap)))
  })

  it('names every command for the diagnostics log', () => {
    const notes = plan(checkerboard(384, 32))[0].parts.flatMap((p) =>
      p.kind === 'command' ? [p.note] : [],
    )
    expect(notes).toEqual([
      'setPaperTypeSilent',
      'setPrintParams',
      'startPrintJob',
      'alignPaperStart',
      'locate',
      'stopPrintJob',
    ])
  })

  it('splits a label too big to seek, and only the last band seeks', () => {
    // Splitting is the only thing that registers a label this size (ADR 0001). Two
    // seeks would cost a blank label: the first registers the roll, the second runs
    // a full pitch to the next gap.
    const bitmap = noisyBitmap(384, 360)
    expect(encodeImage(bitmap).length).toBeGreaterThan(SEEK_SAFE_JOB_BYTES)
    const jobs = plan(bitmap)
    expect(jobs.length).toBeGreaterThan(1)
    for (const job of jobs.slice(0, -1)) expect(commands(job)).not.toContain(SEEK_GAP)
    expect(commands(jobs.at(-1)!)).toContain(SEEK_GAP)
  })

  it('leaves a label that already fits as a single job', () => {
    const bitmap = noisyBitmap(384, 64)
    expect(encodeImage(bitmap).length).toBeLessThan(SEEK_SAFE_JOB_BYTES)
    expect(plan(bitmap)).toHaveLength(1)
  })

  it('retracts in every band when closing the paper seam, which is the default', () => {
    // The first band's retract undoes the tear-off advance behind it; the others
    // undo the take-up their own job start costs. One per job, before its raster:
    // the only position where it moves paper.
    const jobs = plan(noisyBitmap(384, 360))
    expect(jobs.length).toBeGreaterThan(1)
    for (const job of jobs) {
      const parts = commands(job)
      expect(parts.filter((p) => p === RETRACT)).toHaveLength(1)
      expect(parts.indexOf(RETRACT)).toBeLessThan(parts.indexOf('raster'))
    }
  })

  it('retracts only in the first band when the paper seam is left open', () => {
    // Then the take-up's rows are given up at each boundary instead, and a retract
    // mid-label would wind back over the image.
    const jobs = plan(noisyBitmap(384, 360), { closeSplitSeam: false })
    expect(jobs.length).toBeGreaterThan(1)
    expect(commands(jobs[0])).toContain(RETRACT)
    for (const job of jobs.slice(1)) expect(commands(job)).not.toContain(RETRACT)
  })

  it('advances to the tear bar once, after the last band', () => {
    // Between bands it would walk the paper out to the tear position in the middle
    // of the image.
    const jobs = plan(noisyBitmap(384, 360))
    for (const job of jobs.slice(0, -1)) expect(job.epilogue).toEqual([])
    expect(jobs.at(-1)!.epilogue.map((c) => hex(c.bytes))).toEqual([TEAR_OFF])
  })

  it('can be told not to split, and then prints one job whose seek goes unread', () => {
    // Kept reachable on purpose: splitting costs a job per band, and turned off a
    // tall label prints whole and the roll drifts a gap-width per print.
    const jobs = plan(noisyBitmap(384, 360), { splitForSeek: false })
    expect(jobs).toHaveLength(1)
    expect(commands(jobs[0])).toContain(SEEK_GAP)
  })

  it('waits for each band before the next, then for the whole label', () => {
    // The printer takes no job while it is working on one. Sending the next band
    // into a printer still moving paper is what lost the label.
    const bitmap = noisyBitmap(384, 360)
    const [copy] = planOf(bitmap).copies
    expect(copy.jobs.length).toBeGreaterThan(1)
    for (const job of copy.jobs.slice(0, -1)) expect(job.waitMs).toBeGreaterThan(0)
    // The last band is followed by the copy's own wait, for the label to print.
    expect(copy.jobs.at(-1)!.waitMs).toBeNull()
    expect(copy.finishWaitMs).toBe(printDurationMs(bitmap.heightDots))
  })

  it('seeks the boundary its stock actually has', () => {
    // On continuous stock there is no gap to find.
    const parts = commands(plan(checkerboard(64, 16), { stock: 'continuous' })[0])
    expect(parts).toContain('1f 80 02 10') // setPaperTypeSilent(continuous)
    expect(parts).toContain('1f 12 10 00') // locate(none), matching
    expect(parts).not.toContain(SEEK_GAP)
  })

  it('tells the printer each stock by its own byte', () => {
    const paperType = (stock: PrintSettings['stock']) =>
      commands(plan(checkerboard(64, 16), { stock })[0])[0]
    expect(paperType('gap')).toBe('1f 80 02 20')
    expect(paperType('continuous')).toBe('1f 80 02 10')
    expect(paperType('black-mark')).toBe('1f 80 02 30')
  })

  it('sends a speed only when one is asked for, as the levels the SDK names', () => {
    // Left out, the preamble is the captured vendor sequence exactly.
    const speedOf = (speed?: PrintSettings['speed']) =>
      commands(plan(checkerboard(64, 16), { speed })[0]).filter((c) => c.startsWith('1f 60'))
    expect(speedOf()).toEqual([])
    expect(speedOf('low')).toEqual(['1f 60 01 00'])
    expect(speedOf('medium')).toEqual(['1f 60 01 01'])
    expect(speedOf('high')).toEqual(['1f 60 01 02'])
  })

  it('prints at density 8 unless asked for another level', () => {
    // 8 is what the vendor app sends, and the dialect's default.
    const params = (density?: number) => commands(plan(checkerboard(64, 16), { density })[0])[1]
    expect(x2.density).toEqual({ min: 1, max: 15, default: 8 })
    expect(params()).toBe('1f 70 02 08 00 00 00 00 00 00')
    expect(params(3)).toBe('1f 70 02 03 00 00 00 00 00 00')
  })

  it('repeats the whole label per copy, configuration and gap seek included', () => {
    // Each copy has to seek, or only the first lands on a label. Configuration
    // rides along inside every job, as the capture shows.
    const { copies } = planOf(checkerboard(64, 16), { copies: 3 })
    expect(copies).toHaveLength(3)
    for (const { jobs } of copies) {
      expect(jobs).toHaveLength(1)
      expect(commands(jobs[0])).toEqual(expect.arrayContaining(['1f 80 02 20', START, SEEK_GAP]))
      expect(jobs[0].epilogue.map((c) => hex(c.bytes))).toEqual([TEAR_OFF])
    }
  })

  it('plans every band of the label again for each copy', () => {
    const { copies } = planOf(noisyBitmap(384, 360), { copies: 2 })
    expect(copies[0].jobs.length).toBeGreaterThan(1)
    expect(copies[1]).toEqual(copies[0])
  })
})

describe('x2.assessJob', () => {
  it('says a label fits when its raster is within the read-ahead', () => {
    // A checkerboard compresses to almost nothing, however large.
    const bitmap = checkerboard(384, 640)
    const assessment = x2.assessJob(bitmap)
    expect(assessment).toEqual({
      bytes: encodeImage(bitmap).length,
      readAheadBytes: splitBudgetBytes(),
      fits: true,
      compressed: true,
    })
  })

  it('says a label does not fit when its raster is over the read-ahead', () => {
    // Then its gap seek would be read too late, and the plan splits it into bands.
    const bitmap = noisyBitmap(384, 360)
    const assessment = x2.assessJob(bitmap)
    expect(assessment.bytes).toBeGreaterThan(SEEK_SAFE_JOB_BYTES)
    expect(assessment.fits).toBe(false)
    expect(planOf(bitmap).copies[0].jobs.length).toBeGreaterThan(1)
  })

  it('says a label does not fit exactly when the plan splits it', () => {
    // The planner keeps 15% headroom under the 16 KB limit. The panel's note once
    // used the limit itself, so a label in between was split without a word.
    const between = noisyBitmap(384, 300)
    const bytes = encodeImage(between).length
    expect(bytes).toBeGreaterThan(splitBudgetBytes())
    expect(bytes).toBeLessThanOrEqual(SEEK_SAFE_JOB_BYTES)
    for (let rows = 240; rows <= 320; rows += 8) {
      const bitmap = noisyBitmap(384, rows)
      const split = planOf(bitmap).copies[0].jobs.length > 1
      expect(x2.assessJob(bitmap).fits, `${rows} rows`).toBe(!split)
    }
  })

  it('reports the raster as compressed, so a simpler picture can make it smaller', () => {
    expect(x2.assessJob(checkerboard(64, 16)).compressed).toBe(true)
  })
})
