import { describe, expect, it } from 'vitest'
import { createPackedBitmap, type PackedBitmap } from '../../model/bitmap'
import { encodeImage } from './encodeImage'
import { SEEK_SAFE_JOB_BYTES } from './constants'
import { planSeekableBands } from './splitJob'

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

  it('loses no row and repeats none', () => {
    // A seam that drops or duplicates a row is a visible line across the label,
    // and byte-identical reassembly is the only way to be sure there is not one.
    const bm = noise(640)
    const bands = planSeekableBands(bm)
    expect(bands.reduce((n, b) => n + b.heightDots, 0)).toBe(bm.heightDots)

    const rejoined = new Uint8Array(bm.data.length)
    let at = 0
    for (const band of bands) {
      rejoined.set(band.data, at)
      at += band.data.length
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
