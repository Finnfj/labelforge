import { describe, expect, it } from 'vitest'
import { PaperType } from './constants'
import { probeJob } from './probeJob'

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ')

/**
 * The instrument for asking this printer whether a command does anything.
 *
 * Its value is entirely in what it leaves out. Anything else in the job that moves
 * paper makes the answer unreadable, and two of the three things that move paper on
 * this firmware are part of an ordinary job's framing.
 */

const probe = () =>
  hex(
    probeJob({
      paperType: PaperType.Gap,
      density: 8,
      feedDots: 16,
      widthDots: 384,
      probe: Uint8Array.of(0x1f, 0x11, 0x11, 0x00, 0x50),
    }),
  )

describe('probeJob', () => {
  it('puts the bytes under test after the raster and before stopPrintJob', () => {
    // The position that matters. A command sent anywhere else on this firmware is
    // acknowledged and ignored, which is how the gap seek stayed hidden through
    // four rounds of looking for it.
    const stream = probe()
    expect(stream).toContain('1f 11 11 00 50')
    expect(stream.indexOf('1f 10 00 30')).toBeLessThan(stream.indexOf('1f 11 11 00 50'))
    expect(stream.indexOf('1f 11 11 00 50')).toBeLessThan(stream.indexOf('1f c0 01 01'))
  })

  it('leaves out everything else that moves paper', () => {
    const stream = probe()
    // The retract is the largest movement in the protocol and would drown out
    // whatever is being measured.
    expect(stream).not.toContain('1f 11 51')
    // The gap seek is the other thing that moves paper.
    expect(stream).not.toContain('1f 12')
    // And the tear-off advance would hide where the probe left the paper, which is
    // the one thing being observed.
    expect(stream).not.toContain('1f 11 50')
  })

  it('is still a real job, or nothing in it would act at all', () => {
    const stream = probe()
    expect(stream.startsWith('1f 80 02 20')).toBe(true)
    expect(stream).toContain('1f c0 01 00')
    expect(stream.endsWith('1f c0 01 01')).toBe(true)
  })

  it('feeds exactly the rows asked for', () => {
    // The reference the measurement is taken against, so it has to be the number
    // requested and not a rounding of it. 16 rows is 0x0010.
    expect(probe()).toContain('1f 10 00 30 00 10')
  })

  it('stays small enough to be read in full', () => {
    // A job the printer streams is a job whose trailer it may not reach, which
    // would make a negative result meaningless. Blank rows compress to nothing, so
    // even a long feed is a few dozen bytes.
    const long = probeJob({
      paperType: PaperType.Gap,
      density: 8,
      feedDots: 800,
      widthDots: 384,
      probe: Uint8Array.of(0x1f, 0x11, 0x51),
    })
    expect(long.length).toBeLessThan(200)
  })

  it('survives a probe of no bytes at all', () => {
    // Sending nothing is a legitimate control: it shows what the job alone does to
    // the paper, which is the baseline every other reading is against.
    const stream = hex(
      probeJob({
        paperType: PaperType.Gap,
        density: 8,
        feedDots: 8,
        widthDots: 384,
        probe: new Uint8Array(),
      }),
    )
    expect(stream).toContain('1f 10 00 30 00 08')
    expect(stream.endsWith('1f c0 01 01')).toBe(true)
  })
})
