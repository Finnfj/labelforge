import { describe, expect, it } from 'vitest'
import { createPackedBitmap, type PackedBitmap } from '../../model/bitmap'
import { encodeImage } from './encodeImage'
import { SEEK_SAFE_JOB_BYTES } from './constants'
import { planSeekableBands, SPLIT_SEAM_DOTS } from './splitJob'

/**
 * Splitting one label across several jobs so the last of them can seek.
 *
 * The point is entirely about size: a job the printer reads in full honours its
 * gap seek, and one it streams does not. So what these tests care about is that
 * every band actually fits, that nothing is lost or duplicated at the seams, and
 * that a label which already fits is left alone.
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
  it('leaves a label that already fits as one band', () => {
    // Callers treat splitting as the general case, so this has to be the identity
    // rather than something they special-case around.
    const bm = noise(64)
    expect(encodeImage(bm).length).toBeLessThan(SEEK_SAFE_JOB_BYTES)
    expect(planSeekableBands(bm)).toEqual([bm])
  })

  it('gets every band under the limit', () => {
    // The whole purpose. A band over the limit is a band whose seek goes unread,
    // and the last one is the only one whose seek matters.
    const bands = planSeekableBands(noise(640))
    expect(bands.length).toBeGreaterThan(1)
    for (const band of bands) {
      expect(encodeImage(band).length).toBeLessThanOrEqual(SEEK_SAFE_JOB_BYTES)
    }
  })

  it('overlaps each seam by exactly the gap the printer inserts', () => {
    // The printer takes up 8 dots at the start of a job, so band two has to begin
    // 8 rows before band one ended or those rows never get printed. Winding back
    // with 1F 11 10 was tried first and the printer ignored it at that distance.
    const bm = noise(640)
    const bands = planSeekableBands(bm)
    expect(bands.length).toBeGreaterThan(1)

    let printed = 0
    for (const [i, band] of bands.entries()) {
      printed += band.heightDots - (i === 0 ? 0 : SPLIT_SEAM_DOTS)
    }
    // The rows that actually advance the paper add up to the label, no more.
    expect(printed).toBe(bm.heightDots)
  })

  it('repeats the right rows at each seam', () => {
    // Not just any 8 rows: the overlap has to be the *previous* band's last 8, or
    // the image jumps by a millimetre at every boundary.
    const bm = noise(640)
    const bands = planSeekableBands(bm)
    for (let i = 1; i < bands.length; i++) {
      const prev = bands[i - 1]
      const tail = prev.data.slice((prev.heightDots - SPLIT_SEAM_DOTS) * prev.rowBytes)
      const head = bands[i].data.slice(0, SPLIT_SEAM_DOTS * bands[i].rowBytes)
      expect(Array.from(head)).toEqual(Array.from(tail))
    }
  })

  it('reassembles into the original once the overlaps are dropped', () => {
    // A row lost or misplaced at a seam is a visible line across the label, and
    // byte-identical reassembly is the only way to be sure there is not one.
    const bm = noise(640)
    const bands = planSeekableBands(bm)
    const parts = bands.map((band, i) =>
      i === 0 ? band.data : band.data.slice(SPLIT_SEAM_DOTS * band.rowBytes),
    )
    const rejoined = new Uint8Array(bm.data.length)
    let at = 0
    for (const part of parts) {
      rejoined.set(part, at)
      at += part.length
    }
    expect(Array.from(rejoined)).toEqual(Array.from(bm.data))
  })

  it('keeps the width and row stride of the original', () => {
    for (const band of planSeekableBands(noise(640))) {
      expect(band.widthDots).toBe(W)
      expect(band.rowBytes).toBe(RB)
    }
  })

  it('splits as few times as it can', () => {
    // Each seam is a place the printer might stop the head and leave a mark, so
    // the count matters. 640 rows of noise is ~30 KB raw against a ~14 KB budget:
    // three bands, not thirty.
    expect(planSeekableBands(noise(640)).length).toBeLessThanOrEqual(4)
  })

  it('honours a limit passed in', () => {
    // The planner is used with the real limit, but pinning the parameter means a
    // future model with a different buffer needs no new code.
    const bands = planSeekableBands(noise(640), 4096)
    for (const band of bands) expect(encodeImage(band).length).toBeLessThanOrEqual(4096)
  })
})
