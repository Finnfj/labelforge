import { describe, expect, it } from 'vitest'
import { checkerboard, densityPatch, edgeFrame, rulerStrip, testStrip } from './testPatterns'
import { getDot } from '../../model/bitmap'
import { DOTS_PER_MM } from '../../model/units'

/** Any ink in this column? */
function columnInked(bm: ReturnType<typeof rulerStrip>, x: number): boolean {
  for (let y = 0; y < bm.heightDots; y++) if (getDot(bm, x, y)) return true
  return false
}

function rowsInked(bm: ReturnType<typeof rulerStrip>, x: number): number {
  let n = 0
  for (let y = 0; y < bm.heightDots; y++) if (getDot(bm, x, y)) n++
  return n
}

describe('rulerStrip', () => {
  it('marks the very last dot of the requested width', () => {
    // This is the whole point of the strip: if the head is narrower than asked
    // for, this column is what goes missing.
    const bm = rulerStrip(384)
    expect(bm.widthDots).toBe(384)
    expect(rowsInked(bm, 383)).toBe(bm.heightDots)
  })

  it('gives the two ends different shapes', () => {
    // An earlier version used a solid block at one end and a plain column at the
    // other, which read identically as "a long mark at one end" on paper.
    const bm = rulerStrip(384)
    // Near the top the origin wedge is narrow and the far wedge is narrow too,
    // but they grow towards opposite sides — compare a mid-height row.
    const y = 20
    const leftRun = countRun(bm, 0, y, 1)
    const rightRun = countRun(bm, 383, y, -1)
    expect(leftRun).toBeGreaterThan(8)
    expect(rightRun).toBeGreaterThan(8)
    // The wedges must not be mirror-identical in the top row, so orientation is
    // recoverable from a partial print.
    expect(countRun(bm, 0, 0, 1)).toBeLessThan(leftRun)
  })

  it('puts a long tick every 10 mm and a short one every 1 mm', () => {
    const bm = rulerStrip(384)
    // Count only inside the tick band: the digit labels sit above it and would
    // otherwise be counted as tick height.
    const tickHeight = (x: number) => {
      let n = 0
      for (let y = bm.heightDots - 32; y < bm.heightDots; y++) if (getDot(bm, x, y)) n++
      return n
    }
    expect(tickHeight(10 * DOTS_PER_MM)).toBe(32)
    expect(tickHeight(11 * DOTS_PER_MM)).toBe(12)
    // Between millimetre ticks the bottom edge is clear.
    expect(getDot(bm, 11 * DOTS_PER_MM + 3, bm.heightDots - 1)).toBe(false)
  })

  it('numbers the centimetres so the width can be read rather than counted', () => {
    const bm = rulerStrip(400)
    // The digit band sits above the ticks and below the wedges; there must be
    // ink there, otherwise the strip has no labels.
    let inked = 0
    for (let y = 30; y < 50; y++) {
      for (let x = 0; x < bm.widthDots; x++) if (getDot(bm, x, y)) inked++
    }
    expect(inked).toBeGreaterThan(100)
  })

  it('keeps every dot inside the requested width', () => {
    for (const width of [320, 384, 400, 576]) {
      const bm = rulerStrip(width)
      expect(bm.widthDots).toBe(width)
      expect(columnInked(bm, width - 1)).toBe(true)
    }
  })
})

function countRun(bm: ReturnType<typeof rulerStrip>, fromX: number, y: number, step: number): number {
  let n = 0
  for (let x = fromX; x >= 0 && x < bm.widthDots; x += step) {
    if (!getDot(bm, x, y)) break
    n++
  }
  return n
}

describe('other patterns', () => {
  it('confines the test strip to the narrowest usable stock', () => {
    // It must be legible on a 12 mm roll, so nothing may sit beyond 96 dots.
    const bm = testStrip(384)
    for (let x = 96; x < bm.widthDots; x++) expect(columnInked(bm, x)).toBe(false)
  })

  it('alternates the checkerboard', () => {
    const bm = checkerboard(64, 32, 8)
    expect(getDot(bm, 0, 0)).toBe(true)
    expect(getDot(bm, 8, 0)).toBe(false)
    expect(getDot(bm, 16, 0)).toBe(true)
  })

  it('splits the density patch into a solid half and a checker half', () => {
    const bm = densityPatch(64, 16)
    // Left half solid.
    for (let y = 0; y < 16; y++) expect(getDot(bm, 5, y)).toBe(true)
    // Right half is half-covered, not solid.
    let inked = 0
    for (let y = 0; y < 16; y++) for (let x = 32; x < 64; x++) if (getDot(bm, x, y)) inked++
    const cells = 16 * 32
    expect(inked).toBeGreaterThan(cells * 0.3)
    expect(inked).toBeLessThan(cells * 0.7)
  })
})

describe('edgeFrame', () => {
  it('inks the outermost dots on all four sides', () => {
    const bm = edgeFrame(400, 80)
    expect(getDot(bm, 0, 40)).toBe(true)
    expect(getDot(bm, 399, 40)).toBe(true)
    expect(getDot(bm, 200, 0)).toBe(true)
    expect(getDot(bm, 200, 79)).toBe(true)
  })

  it('leaves the middle empty, so a missing side is obvious', () => {
    const bm = edgeFrame(400, 80)
    expect(getDot(bm, 200, 20)).toBe(false)
    expect(getDot(bm, 200, 60)).toBe(false)
  })

  it('never draws outside the raster', () => {
    for (const width of [96, 320, 384, 400]) {
      const bm = edgeFrame(width)
      expect(bm.widthDots).toBe(width)
      expect(getDot(bm, width - 1, 0)).toBe(true)
    }
  })
})
