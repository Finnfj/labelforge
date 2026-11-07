import { describe, expect, it } from 'vitest'
import { createPackedBitmap, type PackedBitmap } from '../../../model/bitmap'
import type { PlannedJob } from '../../dialect'
import { checkerboard } from '../../diagnostics/testPatterns'
import { PaperType, printDurationMs, SEEK_SAFE_JOB_BYTES } from './constants'
import { encodeImage } from './encodeImage'
import { DEFAULT_PRINT_SETTINGS, type PrintSettings } from '../../types'
import { planX2Print } from './plan'

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

const plan = (bitmap: PackedBitmap, settings: Partial<PrintSettings> = {}) =>
  planX2Print(bitmap, { ...DEFAULT_PRINT_SETTINGS, ...settings }).jobs

/** A bitmap that does not compress, so a tall one has to be split. Deterministic. */
function noisyBitmap(widthDots: number, heightDots: number): PackedBitmap {
  const bm = createPackedBitmap(widthDots, heightDots)
  let seed = 0x2545f491
  for (let i = 0; i < bm.data.length; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
    bm.data[i] = (seed >>> 16) & 0xff
  }
  return bm
}

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

  it('waits for each band, and stops the copy if a middle band goes unanswered', () => {
    // The printer takes no job while it is working on one. Sending the next band
    // into a printer still moving paper is what lost the label.
    const bitmap = noisyBitmap(384, 360)
    const jobs = plan(bitmap)
    for (const job of jobs.slice(0, -1)) {
      expect(job.wait?.onSilence).toBe('stop-copy')
    }
    // The last band waits for the whole label to print. Silence there only warns,
    // because the label may well be fine.
    expect(jobs.at(-1)!.wait).toEqual({
      timeoutMs: printDurationMs(bitmap.heightDots),
      onSilence: 'warn',
    })
  })

  it('seeks the boundary its paper type actually has', () => {
    // On continuous stock there is no gap to find.
    const parts = commands(plan(checkerboard(64, 16), { paperType: PaperType.Continuous })[0])
    expect(parts).toContain('1f 80 02 10') // setPaperTypeSilent(continuous)
    expect(parts).toContain('1f 12 10 00') // locate(none), matching
    expect(parts).not.toContain(SEEK_GAP)
  })

  it('repeats the whole label per copy, configuration and gap seek included', () => {
    // Each copy has to seek, or only the first lands on a label. Configuration
    // rides along inside every job, as the capture shows.
    const jobs = plan(checkerboard(64, 16), { copies: 3 })
    expect(jobs.map((j) => j.copy)).toEqual([1, 2, 3])
    for (const job of jobs) {
      expect(commands(job)).toEqual(expect.arrayContaining(['1f 80 02 20', START, SEEK_GAP]))
      expect(job.epilogue.map((c) => hex(c.bytes))).toEqual([TEAR_OFF])
    }
  })

  it('sends every band of one copy before the next copy', () => {
    const single = plan(noisyBitmap(384, 360))
    const jobs = plan(noisyBitmap(384, 360), { copies: 2 })
    expect(jobs.map((j) => j.copy)).toEqual([...single.map(() => 1), ...single.map(() => 2)])
  })
})
