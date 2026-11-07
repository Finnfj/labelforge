import type { PackedBitmap } from '../../../model/bitmap'
import type { JobAssessment } from '../../dialect'
import { SEEK_SAFE_JOB_BYTES } from './constants'
import { encodeImage } from './encodeImage'

/**
 * Whether a raster this big needs splitting for its gap seek to be read.
 *
 * The printer honours a job's seek only when it read the job whole before the motor
 * started; above {@link SEEK_SAFE_JOB_BYTES} it did not, and a tall label's own seek
 * goes unread. Splitting is the answer; see `planSeekableBands()`.
 *
 * Measures the encoded `1F 10` command rather than the whole job, because that is
 * what there is before any framing is built, and 29 bytes of framing is nothing
 * against a 16 KB threshold. The raster is zlib-compressed, so how big it comes out
 * depends on the picture: a dithered photograph barely compresses while flat artwork
 * collapses to nothing, and there is no estimating it short of encoding.
 */
export function assessX2Job(bitmap: PackedBitmap): JobAssessment {
  const bytes = encodeImage(bitmap).length
  return {
    bytes,
    readAheadBytes: SEEK_SAFE_JOB_BYTES,
    fits: bytes <= SEEK_SAFE_JOB_BYTES,
    compressed: true,
  }
}
