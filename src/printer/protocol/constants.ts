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

/**
 * How near the gap a standalone seek may start and still catch it, in dots.
 *
 * **The number this whole route turns on, and it took a deliberate calibration to
 * get.** The paper was set with varying amounts of an 80 mm label still to run and a
 * 1 mm blank feed carrying a gap seek was sent at each position:
 *
 * | label still to run | seek lands on |
 * | --- | --- |
 * | 100 % down to ~30 % (80 mm → 24 mm) | its own gap — correct |
 * | below ~25 % (under 20 mm) | skips a label, finds the next gap |
 *
 * So the seek is not choosing wrongly; it cannot see a boundary that is nearly under
 * it. Below roughly twenty-four millimetres of approach it misses and runs a full
 * pitch. That single fact explains every wasted label in this file: a full-height
 * label ends *at* the gap, approach zero, so a seek sent afterwards can only find the
 * next one.
 *
 * It also explains why the split path does not have this problem. Its seek rides in
 * the same job as a real raster, and an in-job seek registers from zero approach —
 * two different behaviours behind one opcode, which is of a piece with the rest of
 * this protocol.
 *
 * 32 mm rather than the 24 mm observed working: the percentages were read off the
 * label by eye, and the calibration jobs each carried an `alignPaperStart` of their
 * own whose contribution is not separable from the position that was set. Erring long
 * costs nothing — anything from 24 mm to a full label away worked.
 */
export const SEEK_MIN_APPROACH_DOTS = 256

/**
 * How far one `alignPaperStart` winds the paper back, in dots.
 *
 * `1F 11 51` is the only command on this firmware that has ever been seen to move
 * paper backwards, and it took a purpose-built probe to establish it on its own: a
 * job of nothing but `startPrintJob`, one `1F 11 51`, two millimetres of blank raster
 * and `stopPrintJob` retracted the paper. Nothing else in that job moves paper, so
 * the movement is attributable to those three bytes.
 *
 * **It only acts before the raster, and only once per job.** Four of them after a
 * raster moved nothing. Two of them before one moved the paper exactly as far as a
 * single one did — the same distance for double the commands, which is what "the
 * second was ignored" looks like. Sent one per job they stack; sent together they do
 * not. See {@link MAX_RETRACT_JOBS}.
 *
 * That correction pulls the distance back up. The measurement behind it — a pair
 * moving visibly less than a quarter of an 80 mm label — was read as 10 mm each while
 * the pair was believed to stack. If only one of them acted, the same observation
 * bounds a *single* retract at under 20 mm, which is where the original eyeball put
 * it. Sixteen is that bound with a little kept back.
 */
export const ALIGN_START_RETRACT_DOTS = 128

/**
 * Most jobs a rewind may be spread across, one retract each.
 *
 * The printer honours one `alignPaperStart` per job and ignores repeats within it, so
 * distance is bought by sending several small jobs rather than several commands. Sent
 * that way they were observed to stack; on a third the label went stale, the roll
 * refusing to unwind further in reverse.
 *
 * Two of them is around 30 mm net of what each job's own take-up gives back, which
 * clears {@link SEEK_MIN_APPROACH_DOTS}. It is also the whole rewind this printer
 * has, so if it does not clear the threshold nothing else will, and `splitForSeek` —
 * whose in-job seek needs no approach at all — is the answer for a tall label at full
 * quality.
 */
export const MAX_RETRACT_JOBS = 2

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
