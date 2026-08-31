import { describe, expect, it } from 'vitest'
import { createPackedBitmap, type PackedBitmap } from '../../model/bitmap'
import { encodeImage } from './encodeImage'
import { SEEK_SAFE_JOB_BYTES } from './constants'
import {
  planBands,
  planSeekableBands,
  SEAM_RETRACT_OVERSHOOT_DOTS,
  SPLIT_SEAM_DOTS,
} from './splitJob'

/**
 * Splitting one label across several jobs so the last of them can seek.
 *
 * Three things have to hold. Every band must fit under the size the printer reads
 * in full, or its seek goes unread and the split was pointless. The rows lost to
 * the printer's take-up must be *skipped*, not printed late, or the label stretches
 * by a millimetre at every boundary. And the cut should land where the least ink is
 * lost, which is the only thing here that makes the seam less visible rather than
 * merely accounted for.
 */

const W = 384
const RB = W >> 3

/** Incompressible rows, so the planner cannot get lucky on size. */
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
  it('leaves a label that already fits as one band', () => {
    const bm = noise(64)
    expect(encodeImage(bm).length).toBeLessThan(SEEK_SAFE_JOB_BYTES)
    expect(planSeekableBands(bm)).toEqual([bm])
  })

  it('gets every band under the limit', () => {
    // The whole purpose. A band over the limit is a band whose seek goes unread,
    // and the last one is the only seek that matters.
    const bands = planSeekableBands(noise(640))
    expect(bands.length).toBeGreaterThan(1)
    for (const band of bands) {
      expect(encodeImage(band).length).toBeLessThanOrEqual(SEEK_SAFE_JOB_BYTES)
    }
  })

  it('gives up a millimetre at each boundary rather than stretching the label', () => {
    // The printer takes up 1 mm at the start of a job and nothing takes it back —
    // wind-backs of 8 and 40 dots were both ignored, and overlapping the rasters
    // has the wrong sign. So those rows are skipped. Printing them late instead
    // would push the rest of the label down a millimetre per boundary, which is
    // cumulative and eventually walks the design off the label.
    const bm = noise(640)
    const bands = planSeekableBands(bm)
    const printed = bands.reduce((n, b) => n + b.heightDots, 0)
    expect(printed).toBe(bm.heightDots - SPLIT_SEAM_DOTS * (bands.length - 1))
  })

  it('resumes exactly a seam after the previous band, losing no other row', () => {
    // Every row either prints where it was designed to or falls in a seam. A row
    // printed at the wrong offset is a visible step in the image.
    const bm = noise(640)
    const bands = planSeekableBands(bm)
    let row = 0
    for (const band of bands) {
      const expected = bm.data.slice(row * RB, row * RB + band.data.length)
      expect(Array.from(band.data)).toEqual(Array.from(expected))
      row += band.heightDots + SPLIT_SEAM_DOTS
    }
    expect(row - SPLIT_SEAM_DOTS).toBe(bm.heightDots)
  })

  it('puts the seam in white space when there is any nearby', () => {
    // The part that actually helps. A millimetre of white across a photograph
    // shows; a millimetre across the gap between two lines of text does not.
    //
    // Self-calibrating: ask where the planner cuts a uniform label, then blank a
    // band just before that and check it moves. Hard-coding the position would
    // only be testing today's estimate.
    const naive = planSeekableBands(noise(640))[0].heightDots
    const quietFrom = naive - 20
    const quietRows = SPLIT_SEAM_DOTS * 2

    const bm = noise(640)
    bm.data.fill(0, quietFrom * RB, (quietFrom + quietRows) * RB)

    const cut = planSeekableBands(bm)[0].heightDots
    // It cut inside the clear band rather than through the noise around it.
    expect(cut).toBeGreaterThanOrEqual(quietFrom)
    expect(cut).toBeLessThanOrEqual(quietFrom + quietRows - SPLIT_SEAM_DOTS)
    expect(cut).not.toBe(naive)
  })

  it('takes the estimate unchanged when every candidate is equally inked', () => {
    // Ties go to the latest row, so a uniform design keeps its bands as large as
    // they can be and the label needs as few boundaries as possible.
    const a = planSeekableBands(noise(640))
    const b = planSeekableBands(noise(640))
    expect(a.map((x) => x.heightDots)).toEqual(b.map((x) => x.heightDots))
  })

  it('keeps the width and row stride of the original', () => {
    for (const band of planSeekableBands(noise(640))) {
      expect(band.widthDots).toBe(W)
      expect(band.rowBytes).toBe(RB)
    }
  })

  it('splits as few times as it can', () => {
    // Each boundary costs a millimetre of image, so the count is not incidental.
    expect(planSeekableBands(noise(640)).length).toBeLessThanOrEqual(4)
  })

  it('gives up nothing at a boundary the caller is winding back', () => {
    // With `alignPaperStart` at each boundary the take-up is expected to be undone,
    // so no row is skipped and the bands meet. The two decisions have to agree: rows
    // skipped here plus rows the printer eats must come to the label, or it is offset
    // by a millimetre per boundary in whichever direction they disagree.
    const bm = noise(640)
    const bands = planSeekableBands(bm, SEEK_SAFE_JOB_BYTES, 0)
    expect(bands.length).toBeGreaterThan(1)
    expect(bands.reduce((n, b) => n + b.heightDots, 0)).toBe(bm.heightDots)

    let row = 0
    for (const band of bands) {
      expect(Array.from(band.data)).toEqual(
        Array.from(bm.data.slice(row * RB, row * RB + band.data.length)),
      )
      row += band.heightDots
    }
    expect(row).toBe(bm.heightDots)
  })

  it('does not hunt for white space when the seam costs nothing', () => {
    // The search only earns its keep by hiding lost rows. With none lost every cut
    // scores the same, so the estimate stands and the bands stay as large as they can
    // be — which means as few boundaries as possible.
    //
    // One bitmap, two plans differing only in `seamDots`: blanking rows changes how
    // the raster compresses, so comparing plans of *different* bitmaps would be
    // measuring the estimate rather than the search.
    const bm = noise(640)
    const quietRows = SPLIT_SEAM_DOTS * 2
    const quietFrom = planSeekableBands(bm, SEEK_SAFE_JOB_BYTES, 0)[0].heightDots - 20
    bm.data.fill(0, quietFrom * RB, (quietFrom + quietRows) * RB)

    const spent = planSeekableBands(bm, SEEK_SAFE_JOB_BYTES, SPLIT_SEAM_DOTS)[0].heightDots
    const wound = planSeekableBands(bm, SEEK_SAFE_JOB_BYTES, 0)[0].heightDots

    // The one that loses rows moves its cut into the clear band; the one that loses
    // none stays where the size estimate put it.
    expect(spent).toBeGreaterThanOrEqual(quietFrom)
    expect(spent).toBeLessThanOrEqual(quietFrom + quietRows - SPLIT_SEAM_DOTS)
    expect(wound).toBeGreaterThan(spent)
  })

  it('honours a limit passed in', () => {
    for (const band of planSeekableBands(noise(640), 4096)) {
      expect(encodeImage(band).length).toBeLessThanOrEqual(4096)
    }
  })
})

describe('planBands', () => {
  const W_ = W
  const total = (bands: PackedBitmap[]) => bands.reduce((n, b) => n + b.heightDots, 0)

  it('spends a millimetre at each boundary by default', () => {
    const bm = noise(640)
    const bands = planBands(bm)
    expect(bands.length).toBeGreaterThan(1)
    expect(total(bands)).toBe(bm.heightDots - SPLIT_SEAM_DOTS * (bands.length - 1))
  })

  it('leads each later band with the rows the retract overshot by', () => {
    // Measured on hardware: a retract at the boundary put the next band 7 mm early,
    // so it winds back further than the take-up it undoes. Blank rows advance the
    // paper by exactly their count and fire no dots, so they carry the head back over
    // ground the previous band printed — leaving its image alone — and the band's own
    // first row lands where that band stopped.
    const bm = noise(640)
    const bands = planBands(bm, { closeSeam: true })
    expect(bands.length).toBeGreaterThan(1)
    expect(total(bands)).toBe(bm.heightDots + SEAM_RETRACT_OVERSHOOT_DOTS * (bands.length - 1))

    for (const band of bands.slice(1)) {
      const lead = band.data.subarray(0, SEAM_RETRACT_OVERSHOOT_DOTS * band.rowBytes)
      expect(lead.some((b) => b !== 0)).toBe(false)
    }
  })

  it('loses no row of the image when the seam is closed', () => {
    // Every row of the design prints, once, at the offset it was designed for. The
    // whole point: the millimetre a boundary used to cost is recovered rather than
    // merely hidden.
    const bm = noise(640)
    const bands = planBands(bm, { closeSeam: true })
    let row = 0
    for (const [i, band] of bands.entries()) {
      const lead = i === 0 ? 0 : SEAM_RETRACT_OVERSHOOT_DOTS
      const image = band.data.subarray(lead * band.rowBytes)
      expect(Array.from(image)).toEqual(
        Array.from(bm.data.slice(row * (W_ >> 3), row * (W_ >> 3) + image.length)),
      )
      row += band.heightDots - lead
    }
    expect(row).toBe(bm.heightDots)
  })

  it('does not touch the first band, which has no boundary behind it', () => {
    // Its retract undoes the tear-off advance instead, as it does on any print.
    const bands = planBands(noise(640), { closeSeam: true })
    expect(bands[0]).toEqual(planSeekableBands(noise(640), undefined, 0)[0])
  })

  it('leaves a label that already fits as one band either way', () => {
    const bm = noise(64)
    expect(planBands(bm)).toEqual([bm])
    expect(planBands(bm, { closeSeam: true })).toEqual([bm])
  })
})
