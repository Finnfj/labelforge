import { createPackedBitmap, type PackedBitmap } from '../model/bitmap'

/**
 * A bitmap that does not compress, for tests that need a large job.
 *
 * A checkerboard of any size deflates to a few hundred bytes, so it cannot stand
 * in for a tall label however tall it is. Dithered photographs are the real case,
 * and this is the same in the way that matters. Seeded, so it is the same bytes on
 * every run: the wire snapshots depend on that.
 */
export function noisyBitmap(widthDots: number, heightDots: number): PackedBitmap {
  const bm = createPackedBitmap(widthDots, heightDots)
  let seed = 0x2545f491
  for (let i = 0; i < bm.data.length; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff
    bm.data[i] = (seed >>> 16) & 0xff
  }
  return bm
}
