/**
 * BLE GATT profile and job framing for the DYMO LetraTag LT-200B.
 *
 * Confirmed by our own HCI captures of the vendor app, cross-checked against the
 * independent, MIT-licensed github.com/ysfchn/dymo-bluetooth. See
 * docs/DYMO_PROTOCOL.md — in particular "Open questions" for the two points where
 * our captures and that project disagree (not yet resolved either way) and the two
 * behaviours our captures show that project doesn't document at all. No code from
 * that project is used here; see docs/THIRD_PARTY.md.
 *
 * A driver (`DymoBlePrinterDriver`) exists but **nothing here has been confirmed
 * against real hardware by this project** — see that class's doc comment.
 */

export const SERVICE_UUID = 'be3dd650-2b3d-42f1-99c1-f0f749dd0678'
export const CHAR_WRITE = 'be3dd651-2b3d-42f1-99c1-f0f749dd0678'
export const CHAR_NOTIFY_STATUS = 'be3dd652-2b3d-42f1-99c1-f0f749dd0678'
/** Discovered in every capture, written to or subscribed in none. Confirmed unused. */
export const CHAR_UNKNOWN = 'be3dd653-2b3d-42f1-99c1-f0f749dd0678'

/** Advertised name prefix (`Letratag<MAC-without-colons>`). Never seen in our own captures. */
export const ADVERTISED_NAME_PREFIX = 'Letratag'

/** Bytes per application-level chunk, each its own GATT characteristic write. */
export const CHUNK_SIZE = 500

/** Appended after `FF F0`, repeated as the last two bytes of every job's footer. */
export const MAGIC = new Uint8Array([0x12, 0x34])

/**
 * Builds the fixed 9-byte header: `FF F0` + {@link MAGIC} + a little-endian payload
 * length + a checksum (sum of the preceding 8 bytes, `& 0xFF`). Confirmed against all
 * four of our captured jobs — this is what earlier notes called "header byte 11,
 * unidentified."
 */
export function buildHeader(payloadLength: number): Uint8Array {
  const header = new Uint8Array(9)
  header[0] = 0xff
  header[1] = 0xf0
  header[2] = MAGIC[0]
  header[3] = MAGIC[1]
  new DataView(header.buffer).setUint32(4, payloadLength, true)
  let checksum = 0
  for (let i = 0; i < 8; i++) checksum += header[i]
  header[8] = checksum & 0xff
  return header
}

export const Directive = {
  Start: 0x73, // 's'
  MediaType: 0x4d, // 'M'
  PrintDensity: 0x43, // 'C' — never observed with any known structure
  PrintData: 0x44, // 'D'
  FormFeed: 0x45, // 'E'
  Status: 0x41, // 'A'
  End: 0x51, // 'Q'
} as const

const ESC = 0x1b

/** `ESC s` + 4 fixed bytes. Opens every job's directive stream. */
export const START_DIRECTIVE = new Uint8Array([ESC, Directive.Start, 0x9a, 0x02, 0x00, 0x00])

/**
 * `ESC #` + one argument byte (always `1` in every captured job). Sent by the real
 * vendor app between `START` and `PRINT_DATA` in every capture; absent from
 * ysfchn/dymo-bluetooth's directive table and payload builder entirely, and their
 * printer accepts jobs without it. Purpose unconfirmed — see docs/DYMO_PROTOCOL.md.
 */
export const UNDOCUMENTED_DIRECTIVE = new Uint8Array([ESC, 0x23, 0x01])

export const FORM_FEED_DIRECTIVE = new Uint8Array([ESC, Directive.FormFeed])
export const STATUS_DIRECTIVE = new Uint8Array([ESC, Directive.Status])
export const END_DIRECTIVE = new Uint8Array([ESC, Directive.End])

/**
 * `PRINT_DATA`'s alignment argument. Constant `0x02` in every job, ours and
 * ysfchn/dymo-bluetooth's — meaning unconfirmed either way.
 */
export const PRINT_DATA_ALIGN = 0x02

/**
 * `PRINT_DATA`'s bits-per-pixel argument. ysfchn/dymo-bluetooth hardcodes `0x01`
 * ("always 1") and their printer accepts it; **every one of our captured jobs shows
 * `0x81` at this exact position instead** — confirmed by direct byte inspection, with
 * the surrounding alignment/width/height fields lining up exactly where the layout
 * predicts, so this isn't a misalignment. `0x81` is `0b1000_0001`: bit 0 agrees with
 * "1 bit per pixel," bit 7 is unexplained. Send what the vendor app sends until it's
 * understood — see docs/DYMO_PROTOCOL.md, "Open questions."
 */
export const PRINT_DATA_BPP = 0x81

/** `PRINT_DATA`'s height argument: addressable rows, not the 30 px printable area. */
export const PRINT_DATA_HEIGHT_DOTS = 32

/** Of the 32 addressable rows, only this many actually print — the first row is lost. */
export const PRINTABLE_HEIGHT_DOTS = 30

/**
 * Dots per millimetre, across the head and per design row along the feed (before
 * the 2x stretch, which then puts columns at twice this).
 *
 * 200 DPI, per ysfchn/dymo-bluetooth's README. The 30 printable dots are therefore
 * only ~3.8 mm of the 12 mm tape — matching that README's "very obvious white space
 * even if all printable space is filled". An earlier value of 30 dots / 12 mm (2.5
 * dots/mm) assumed the dots spanned the whole tape; the first real print came out
 * "way too small", which is what that predicts: ~3.1x short.
 *
 * Still not measured by this project. A 40 mm design should now print ~40 mm long
 * with a ~3.8 mm tall printed band; if it doesn't, this is the number to change.
 */
export const DYMO_DOTS_PER_MM = 200 / 25.4

/**
 * The vendor app sends every image column twice — not a wire-level duplication, but
 * a 2× horizontal stretch baked into the pixel data itself (`PRINT_DATA`'s width
 * already counts the stretched columns). ysfchn/dymo-bluetooth's `Canvas.stretch()`
 * does the same and documents why: "otherwise printer will render the labels too
 * narrow." A from-scratch encoder needs to apply this before building the raster,
 * not after.
 */
export const RASTER_STRETCH_FACTOR = 2

/** `ESC R` + a status byte, on {@link CHAR_NOTIFY_STATUS}. */
export const RESULT_PREFIX = new Uint8Array([ESC, 0x52])

/**
 * The status byte of an `ESC R` notification.
 *
 * Our captures show three per connection: one when notifications are enabled, one
 * answering the `1b 41 00` probe, and **one** after the job, once it has printed.
 * ysfchn/dymo-bluetooth sees two after a job (no probe), the first a provisional
 * "printing" — most likely `SuccessAlt`. See `DymoBlePrinterDriver#print`.
 */
export const PrintResult = {
  Success: 0,
  /** Treat the same as {@link PrintResult.Success} — a quirk of this printer's firmware. */
  SuccessAlt: 1,
  Failed: 2,
  SuccessLowBattery: 3,
  FailedCancelled: 4,
  /** Treat the same as {@link PrintResult.Failed}. */
  FailedAlt: 5,
  FailedLowBattery: 6,
  /** Never actually observed — a missing cassette reports `Success` instead. */
  FailedNoCassette: 7,
} as const
