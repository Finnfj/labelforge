/**
 * Wire facts for DYMO's LetraTag dialect, as the LT-200B speaks it.
 *
 * From our own HCI captures of the vendor app, cross-checked against the
 * independent, MIT-licensed github.com/ysfchn/dymo-bluetooth. No code from that
 * project is used here. See docs/DYMO_PROTOCOL.md for the evidence behind each
 * fact, and its "Open questions" for where the two sources disagree.
 */
/** The GATT service, write and notify characteristics. Both sources, and every capture. */
export const SERVICE_UUID = 'be3dd650-2b3d-42f1-99c1-f0f749dd0678'
export const CHAR_WRITE = 'be3dd651-2b3d-42f1-99c1-f0f749dd0678'
export const CHAR_NOTIFY_STATUS = 'be3dd652-2b3d-42f1-99c1-f0f749dd0678'

/**
 * Advertised name prefix: `Letratag<MAC-without-colons>`. From ysfchn/dymo-bluetooth's
 * `bluetooth.py`; never seen in our own captures, which hold no advertising report.
 */
export const ADVERTISED_NAME_PREFIX = 'Letratag'

/** Bytes of a job's stream per chunk, after the chunk's own index byte. Both sources. */
export const CHUNK_SIZE = 500

/** Follows `FF F0` in every header, and ends every job's last chunk. Every capture. */
export const MAGIC = Uint8Array.of(0x12, 0x34)

const ESC = 0x1b

/** `ESC s` + 4 fixed bytes. Opens every job's directive stream: both sources, every capture. */
export const START_DIRECTIVE = Uint8Array.of(ESC, 0x73, 0x9a, 0x02, 0x00, 0x00)

/**
 * `ESC #` + one argument byte, always `1`. Sent by the vendor app between `START` and
 * `PRINT_DATA` in every capture; absent from ysfchn/dymo-bluetooth's directive table,
 * and their printer accepts jobs without it. Purpose unknown — see
 * docs/DYMO_PROTOCOL.md, "Open questions". Sent because the vendor app sends it.
 */
export const ESC_HASH_DIRECTIVE = Uint8Array.of(ESC, 0x23, 0x01)

/** `ESC D`, followed by bits per pixel, alignment, width and height, then the raster. */
export const PRINT_DATA = 0x44

/** The directive stream's tail: `ESC E`, `ESC A`, `ESC Q`. Both sources, every capture. */
export const FORM_FEED_DIRECTIVE = Uint8Array.of(ESC, 0x45)
export const STATUS_DIRECTIVE = Uint8Array.of(ESC, 0x41)
export const END_DIRECTIVE = Uint8Array.of(ESC, 0x51)

/**
 * The probe the vendor app writes on its own before every job, answered on the status
 * channel: in every capture, and nowhere in ysfchn/dymo-bluetooth. What it asks is
 * unknown; see docs/DYMO_PROTOCOL.md, "Open questions".
 */
export const PROBE = Uint8Array.of(ESC, 0x41, 0x00)

/** `PRINT_DATA`'s alignment argument: `0x02` in every job, ours and theirs. Meaning unknown. */
export const PRINT_DATA_ALIGN = 0x02

/**
 * `PRINT_DATA`'s bits-per-pixel argument. ysfchn/dymo-bluetooth sends `0x01`, and
 * their printer accepts it; every one of our captured jobs shows `0x81` here, with
 * the fields around it lining up exactly. Bit 0 agrees with one bit per pixel; bit 7
 * is unexplained. Sent as the vendor app sends it until it is understood.
 */
export const PRINT_DATA_BPP = 0x81

/** `PRINT_DATA`'s height argument: the 32 addressable dots across the head. Both sources. */
export const PRINT_DATA_HEIGHT_DOTS = 32

/**
 * Every column goes out twice. ysfchn/dymo-bluetooth's README: without it the
 * printer renders labels "too narrow"; every column of every capture is doubled.
 */
export const RASTER_STRETCH_FACTOR = 2

/** `ESC R` + a result code, on the status characteristic. Both sources, every capture. */
export const RESULT_PREFIX = Uint8Array.of(ESC, 0x52)

/** The result codes after `ESC R`. ysfchn/dymo-bluetooth's table; see docs/DYMO_PROTOCOL.md. */
export const Result = {
  Success: 0,
  /**
   * Ours to read as no result yet. ysfchn/dymo-bluetooth sees two replies after a job,
   * the first a provisional "printing"; that `1` is that one is the likeliest reading,
   * not something either source shows.
   */
  Printing: 1,
  Failed: 2,
  SuccessLowBattery: 3,
  Cancelled: 4,
  /** A failure with no reason given, like `Failed`; what tells the two apart is unknown. */
  AlsoFailed: 5,
  FailedLowBattery: 6,
  /** Never observed: a missing cassette reports `Success` instead. */
  FailedNoCassette: 7,
} as const

/** ysfchn/dymo-bluetooth's README: "up to 7 millimeters per second". */
export const PRINT_MM_PER_SECOND = 7

/**
 * Allowance on top of the print itself before giving up on a label's result.
 * Captured jobs answered 6.2 s and 9.2 s after their last write, for labels of
 * roughly 20 and 37 mm.
 */
export const RESULT_BASE_WAIT_MS = 15000

/** How long the probe's reply may take. Some of our captures show a gap of several seconds. */
export const PROBE_WAIT_MS = 5000
