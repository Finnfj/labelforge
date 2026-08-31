/** BLE GATT profile of the P50 family. See docs/PROTOCOL.md. */
export const SERVICE_UUID = '0000ff00-0000-1000-8000-00805f9b34fb'
export const CHAR_NOTIFY_STATUS = '0000ff01-0000-1000-8000-00805f9b34fb'
export const CHAR_WRITE = '0000ff02-0000-1000-8000-00805f9b34fb'
export const CHAR_NOTIFY_CREDITS = '0000ff03-0000-1000-8000-00805f9b34fb'

/*
 * The advertised name prefixes used to live here. They are now per-model, in
 * `../profiles.ts`, because which prefix matched decides which printer we think
 * we are talking to — and for some of them, that we should decline to talk at
 * all. `ALL_NAME_PREFIXES` there is what the chooser filters on.
 */

/** Bytes per BLE write. The vendor SDK uses 90; a decompile of the Android app suggests 95. */
export const DEFAULT_CHUNK_SIZE = 90

/** Inter-chunk delay when credit notifications are arriving, and when they are not. */
export const DELAY_WITH_CREDITS_MS = 5
export const DELAY_WITHOUT_CREDITS_MS = 30

export const PaperType = {
  Continuous: 0x10,
  Gap: 0x20,
  BlackMark: 0x30,
} as const
export type PaperTypeValue = (typeof PaperType)[keyof typeof PaperType]

export const Speed = { Low: 0, Medium: 1, High: 2 } as const
export type SpeedValue = (typeof Speed)[keyof typeof Speed]

export const MIN_DENSITY = 1
export const MAX_DENSITY = 15

/**
 * Largest job whose end-of-job gap seek the printer still honours.
 *
 * A P50S has an input buffer of roughly 18 KB and starts printing the moment it
 * is full — before it has parsed the end of the job. `1F 12 20 00` sits in the
 * unread remainder, and by the time the printer reaches it the label is out and
 * nothing registers. Under the limit the whole job lands before the motor moves
 * and the seek works, every time.
 *
 * Measured, on firmware V2.0.00, from two wire logs of the same design at two
 * heights — the only difference between them being the row count:
 *
 * | | 30 mm | 80 mm |
 * | --- | --- | --- |
 * | raster | 48 x 240 | 48 x 640 |
 * | whole job | 8,714 B | 23,315 B |
 * | credits throttled | never | after 18,360 B |
 * | `4F 4B` after last write | 424 ms | 8,492 ms |
 * | gap seek | **works** | **does not** |
 *
 * 16 KB rather than the observed 18,360 bytes: the throttle point is where the
 * buffer was already full, not where it began to fill, and nothing says the
 * figure is the same at a different battery level or temperature. This number
 * only drives a warning, so erring low costs a little unnecessary caution and
 * erring high costs a label.
 */
export const SEEK_SAFE_JOB_BYTES = 16 * 1024

/*
 * Three constants for the follow-up seek route used to sit here — the seek's minimum
 * approach distance, one retract's reach, and how many retract jobs could be stacked.
 * The route is closed: one retract is all the mechanism has and it is well short of
 * the approach the seek needs, so nothing computed from those numbers has a caller.
 * The measurements behind them are in docs/PROTOCOL.md, which is where they are
 * useful — they rule out a family of ideas rather than driving any code.
 */

/**
 * How fast the printer consumes rows once it is drain-limited.
 *
 * From the 80 mm wire log: 640 rows between the job being accepted and `4F 4B`,
 * 14.8 s apart. It matches the credit rate in the same log — 90 bytes per 75 ms
 * once the buffer was full — from the other direction, so it is the printer's
 * real speed rather than an artefact of the link.
 */
export const PRINT_ROWS_PER_SECOND = 43

/**
 * How long to keep waiting for `4F 4B` after the last byte of a job.
 *
 * Doubled against the measured rate, because the rate is a measurement and not a
 * specification, and the two errors are not symmetrical: waiting longer than
 * necessary costs a moment, while waiting less sends the next thing to a printer
 * still working through the last raster. A hardware trial did exactly that — a
 * flat 5 s against an 80 mm label that needed 8.5 s, and the follow-up seek meant
 * to register the label went out while it was still printing.
 */
export function printDurationMs(heightDots: number): number {
  return (Math.max(0, heightDots) / PRINT_ROWS_PER_SECOND) * 2000
}
