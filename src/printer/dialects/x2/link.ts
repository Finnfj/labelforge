import { sliceBytes } from '../../../lib/bytes'
import type { CreditPacing, Link } from '../../dialect'
import {
  CHAR_NOTIFY_CREDITS,
  CHAR_NOTIFY_STATUS,
  CHAR_WRITE,
  DEFAULT_CHUNK_SIZE,
  DELAY_WITHOUT_CREDITS_MS,
  DELAY_WITH_CREDITS_MS,
  SERVICE_UUID,
} from './constants'

/**
 * Credit grants on `ff03`.
 *
 * The printer's BLE module bridges to an internal UART with a small buffer and no
 * back-pressure of its own, so writes sent faster than it drains are dropped
 * silently — the label prints with bands missing rather than failing outright.
 * The firmware instead grants credits: each notification says how many more
 * chunks it is ready to take.
 */
export const X2_CREDIT_PACING: CreditPacing = {
  kind: 'credits',
  /*
   * The channel is not credits-only. A real P50S was observed sending `02 dc 00`
   * here amongst the `01 01` grants, so the first byte is a frame type and only
   * `0x01` frames carry credits. The vendor SDK ignores that byte and would have
   * read `0xdc` as a grant of 220, disabling flow control for the rest of the
   * session — which is exactly the sort of thing that prints fine on a short label
   * and drops bands on a long one.
   *
   * Within a credit frame, a value of exactly 4 sets the window rather than
   * incrementing it. That asymmetry comes from the vendor SDK, and the observed
   * opening frame of `01 04` is consistent with it.
   */
  readGrant(bytes) {
    if (bytes.length < 2 || bytes[0] !== 0x01) return null
    return bytes[1] === 0x04 ? { set: 4 } : { add: bytes[1] }
  },
  delayWithCreditsMs: DELAY_WITH_CREDITS_MS,
  delayWithoutCreditsMs: DELAY_WITHOUT_CREDITS_MS,
}

/**
 * The P50 family's link: service `ff00`, chunks as plain slices of the job
 * stream, every one paced by a credit (ADR 0002).
 *
 * Every MarkLife model anyone has documented — ours, and all three profiles in
 * tomLadder/thermoprint — uses this one layout.
 */
export const x2Link: Link = {
  gatt: {
    service: SERVICE_UUID,
    write: CHAR_WRITE,
    status: CHAR_NOTIFY_STATUS,
    credits: CHAR_NOTIFY_CREDITS,
    // Without-response is dramatically faster — several packets per connection
    // event instead of one round trip each — and is what pairs with the credit
    // window. With-response is the fallback when the firmware does not offer it.
    writeMode: 'fastest-offered',
  },
  chunkSize: DEFAULT_CHUNK_SIZE,
  chunk: sliceBytes,
  pacing: X2_CREDIT_PACING,
}
