import { concatBytes, sliceBytes } from '../../../lib/bytes'
import type { Link } from '../../dialect'
import { CHAR_NOTIFY_STATUS, CHAR_WRITE, CHUNK_SIZE, MAGIC, SERVICE_UUID } from './constants'

/**
 * The 9-byte header that goes before a job's stream as a write of its own: `FF F0`,
 * the magic, the stream's length as a little-endian u32, and a checksum, the low byte
 * of the sum of the first eight. Matches all four jobs in our captures.
 */
function jobHeader(streamLength: number): Uint8Array {
  const header = new Uint8Array(9)
  header.set([0xff, 0xf0, ...MAGIC])
  new DataView(header.buffer).setUint32(4, streamLength, true)
  header[8] = header.subarray(0, 8).reduce((sum, byte) => sum + byte, 0) & 0xff
  return header
}

/**
 * A chunk's index byte. ysfchn/dymo-bluetooth's numbering skips 27 outright, as the
 * vendor app's does by their account; our captures never run to 27 chunks to show
 * it. The reason is unknown, so it is reproduced rather than second-guessed.
 */
function chunkIndex(n: number): number {
  return n >= 27 ? n + 1 : n
}

/**
 * The LetraTag's link: its own service, every write acknowledged, and chunks the
 * dialect frames itself — the header, then each slice of the stream behind its
 * index byte, the last with the magic after it.
 *
 * No credits channel exists, and every write in every capture was a Write Request,
 * acknowledged by the printer before the next went. That acknowledgement is the
 * pacing, reproduced rather than swapped for the faster path on the guess that it
 * would also work.
 */
export const letratagLink: Link = {
  gatt: {
    service: SERVICE_UUID,
    write: CHAR_WRITE,
    status: CHAR_NOTIFY_STATUS,
    writeMode: 'with-response',
  },
  chunkSize: CHUNK_SIZE,
  chunk(stream, chunkSize) {
    // A probe streams nothing and goes as a write of its own: there is nothing to frame.
    if (stream.length === 0) return []
    const slices = sliceBytes(stream, chunkSize)
    const last = slices.length - 1
    return [
      jobHeader(stream.length),
      ...slices.map((slice, n) =>
        concatBytes([Uint8Array.of(chunkIndex(n)), slice, n === last ? MAGIC : new Uint8Array()]),
      ),
    ]
  },
  pacing: { kind: 'acknowledged' },
}
