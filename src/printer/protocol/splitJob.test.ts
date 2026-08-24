import { describe, expect, it } from 'vitest'
import { createPackedBitmap, type PackedBitmap } from '../../model/bitmap'
import { encodeImage } from './encodeImage'
import { SEEK_SAFE_JOB_BYTES } from './constants'
import { planSeekableBands, SPLIT_PAD_DOTS, SPLIT_REWIND_DOTS, SPLIT_SEAM_DOTS } from './splitJob'

/**
 * Splitting one label across several jobs so the last of them can seek.
 *
 * Two things have to hold. Every band must fit under the size the printer reads in
 * full, or its seek goes unread and the split was pointless. And the paper has to
 * come out of each boundary exactly where it went in, which is what the wind-back
 * and the blank padding are for — an error there is a visible line across a label.
 */

const W = 384
const RB = W >> 3

/** Incompressible rows, so the planner cannot get lucky. */
function noise(rows: number): PackedBitmap {
  const bm = createPackedBitmap(W, rows)
  let seed = 0x2545f491
  for (let i = 0; i < bm.data.length; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
    bm.data[i] = (seed >>> 16) & 0xff
  }
  return bm
}

describe('planSeekableBands', () => {
  it('leaves a label that already fits as one band, with nothing to correct', () => {
    const bm = noise(64)
    expect(encodeImage(bm).length).toBeLessThan(SEEK_SAFE_JOB_BYTES)
    expect(planSeekableBands(bm)).toEqual([{ raster: bm, rewindDots: 0 }])
  })

  it('gets every band under the limit', () => {
    // The whole purpose. A band over the limit is a band whose seek goes unread,
    // and the last one is the only seek that matters.
    const bands = planSeekableBands(noise(640))
    expect(bands.length).toBeGreaterThan(1)
    for (const band of bands) {
      expect(encodeImage(band.raster).length).toBeLessThanOrEqual(SEEK_SAFE_JOB_BYTES)
    }
  })

  it('winds back every band but the first, and pads it to come forward again', () => {
    // The printer takes up 1 mm at the start of a job. Winding back that millimetre
    // does nothing — it is under the minimum step — so the band winds back five and
    // prints four of blank, landing where the last band stopped. Overlapping the
    // rasters instead was tried and has the wrong sign: it leaves the advance in
    // place and prints the repeated rows after it.
    const bands = planSeekableBands(noise(640))
    expect(bands[0].rewindDots).toBe(0)
    for (const band of bands.slice(1)) expect(band.rewindDots).toBe(SPLIT_REWIND_DOTS)
    expect(SPLIT_PAD_DOTS).toBe(SPLIT_REWIND_DOTS - SPLIT_SEAM_DOTS)
  })

  it('nets out to no extra paper at a boundary', () => {
    // The arithmetic the whole fix rests on, stated the way it has to hold: at each
    // boundary the printer takes up SEAM, we wind back REWIND, and the blank rows
    // put PAD back. Those three have to cancel, or every boundary either leaves a
    // white line or prints a millimetre twice.
    const bands = planSeekableBands(noise(640))
    for (const band of bands.slice(1)) {
      const padRows = SPLIT_PAD_DOTS
      expect(SPLIT_SEAM_DOTS - band.rewindDots + padRows).toBe(0)
    }
  })

  it('sends every row of the label once, blank padding aside', () => {
    const bm = noise(640)
    const bands = planSeekableBands(bm)
    const content = bands.reduce(
      (n, band, i) => n + band.raster.heightDots - (i === 0 ? 0 : SPLIT_PAD_DOTS),
      0,
    )
    expect(content).toBe(bm.heightDots)
  })

  it('starts each band where the last one stopped, with blank rows in front', () => {
    // The padding must be blank — it passes back over paper that is already
    // printed, and a dot fired there would print twice — and the real content must
    // resume with no row repeated and none skipped.
    const bm = noise(640)
    const bands = planSeekableBands(bm)
    let row = 0
    for (const [i, band] of bands.entries()) {
      const pad = i === 0 ? 0 : SPLIT_PAD_DOTS
      expect(Array.from(band.raster.data.slice(0, pad * RB)).every((b) => b === 0)).toBe(true)

      const content = band.raster.data.slice(pad * RB)
      const expected = bm.data.slice(row * RB, row * RB + content.length)
      expect(Array.from(content)).toEqual(Array.from(expected))
      row += content.length / RB
    }
    expect(row).toBe(bm.heightDots)
  })

  it('keeps the width and row stride of the original', () => {
    for (const band of planSeekableBands(noise(640))) {
      expect(band.raster.widthDots).toBe(W)
      expect(band.raster.rowBytes).toBe(RB)
    }
  })

  it('splits as few times as it can', () => {
    // Each seam is a place the head stops while the driver waits, and a stopped
    // head is where a line would show. 640 rows of noise against a ~14 KB budget
    // is a handful of bands, not dozens.
    expect(planSeekableBands(noise(640)).length).toBeLessThanOrEqual(4)
  })

  it('honours a limit passed in', () => {
    for (const band of planSeekableBands(noise(640), 4096)) {
      expect(encodeImage(band.raster).length).toBeLessThanOrEqual(4096)
    }
  })
})
