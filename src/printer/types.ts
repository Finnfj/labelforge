import type { PackedBitmap } from '../model/bitmap'
import type { ProfileSupport } from './profiles'
import type { PaperTypeValue, SpeedValue } from './protocol/constants'

/**
 * The seam between the app and the hardware.
 *
 * Two implementations exist: a virtual printer that simply records the bitmap it
 * was handed, and the real BLE driver. Everything above this interface is built
 * and tested against the virtual one, so the editor never depends on a printer
 * being present — or, during early development, on one existing at all.
 */

export interface PrinterCapabilities {
  model: string
  firmware: string
  serial: string
  mac: string
  /** Measured with the diagnostics ruler strip; not something the printer reports. */
  headWidthDots: number
  chunkSize: number
  probedAt: number
  /** Which entry in `printer/profiles.ts` was matched, or assumed. */
  profileId: string
  /**
   * How much this app actually knows about the connected model.
   *
   * Surfaced rather than kept internal because "unverified" is a claim the UI
   * has to make out loud — a profile that has never met its hardware should not
   * look the same as one confirmed against it.
   */
  support: ProfileSupport
  /** True when the advertised name matched nothing and a P50 was assumed. */
  profileAssumed: boolean
}

export type PrinterFault =
  'none' | 'no-paper' | 'cover-open' | 'overheat' | 'low-battery' | 'unknown'

export interface PrinterStatus {
  online: boolean
  batteryPercent: number | null
  paperType: PaperTypeValue | null
  density: number | null
  labelHeightDots: number | null
  fault: PrinterFault
}

export interface PrintSettings {
  density: number
  /**
   * Motor speed, or undefined to say nothing about it.
   *
   * Undefined by default, and that is the whole point: `1F 60` is the only
   * command this app sends that the vendor app does not, and it came from the
   * tidied SDK facade whose other inventions are all silent on a P50S. With it
   * omitted, a print is byte-for-byte the captured sequence.
   *
   * Kept selectable because it may well work, and because a setting that can be
   * turned on is how you find out. See docs/PROTOCOL.md.
   */
  speed?: SpeedValue
  paperType: PaperTypeValue
  copies: number
  /**
   * Seek the label boundary at the end of the job.
   *
   * On for a label, which is the captured vendor sequence and what keeps
   * successive labels registered. Off for anything printed to move paper a
   * measured distance — the diagnostics feed, whose whole purpose is to advance
   * by exactly the millimetres asked for. That tool used to send the full
   * sequence and so fed 2 mm and then sought the gap, which is not a feed and
   * makes stepping the paper to find the gap impossible.
   */
  seekGap?: boolean
  /**
   * Print a label too large to seek as several jobs, so the last one can.
   *
   * The printer honours a job's gap seek only when it read the job whole before the
   * motor started, so a tall label's own seek goes unread. Splitting the raster into
   * bands that each fit, sent one at a time with the seek on the last, is the only
   * route that keeps the picture exactly as designed.
   *
   * **It is also the only route that registers a tall label at all.** An in-job seek
   * needs no approach distance; a seek in a job of its own needs about 24 mm and there
   * is no way to wind back that far. So this is on by default, and a raster that
   * already fits comes back as a single band, which makes the ordinary path the same
   * code.
   *
   * The cost is a millimetre of image at each boundary, hidden in the quietest row
   * nearby. {@link closeSplitSeam} is an attempt at removing even that.
   */
  splitForSeek?: boolean
  /**
   * Wind the paper back at each split boundary instead of giving up the rows.
   *
   * A band's job takes up `SPLIT_SEAM_DOTS` before it lays down a raster, which is
   * why a boundary costs a millimetre of image. `alignPaperStart` undoes it — the one
   * command that moves paper backwards, acting in exactly the position a band's
   * preamble puts it — and it overshoots by a measured
   * `SEAM_RETRACT_OVERSHOOT_DOTS`, which the next band leads with as blank rows.
   * Blank rows advance the paper by exactly their count and fire no dots, so the
   * band's first row lands precisely where the last one stopped.
   *
   * Confirmed on hardware: a tall label printed whole, registered on the boundary,
   * with the bands meeting and no row lost. On by default for that reason — a
   * boundary then costs nothing at all, so there is nothing to weigh up.
   *
   * Turning it off falls back to giving up `SPLIT_SEAM_DOTS` at each boundary and
   * hiding the cut in the quietest row nearby. Worth having if the 7 mm ever reads
   * differently on other stock: being out shows as a seam or an overlap of the
   * difference, and the fallback's millimetre is at least predictable.
   */
  closeSplitSeam?: boolean
}

export interface PrintJob {
  bitmap: PackedBitmap
  settings: PrintSettings
}

export type PrintPhase = 'prepare' | 'handshake' | 'transfer' | 'feed' | 'done'

export interface PrintProgress {
  phase: PrintPhase
  /** Bytes written so far, and the total for this job. */
  sent: number
  total: number
  copy: number
  copies: number
}

export type PrinterState = 'disconnected' | 'connecting' | 'connected' | 'printing' | 'error'

/**
 * A type alias rather than an interface: interfaces have no implicit index
 * signature, so they cannot satisfy the emitter's `Record<string, unknown>`
 * constraint.
 */
export type PrinterEvents = {
  state: PrinterState
  progress: PrintProgress
  status: PrinterStatus
  /** Every byte in or out, for the diagnostics log. */
  wire: { dir: 'in' | 'out'; bytes: Uint8Array; at: number; note?: string }
  log: { level: 'debug' | 'info' | 'warn' | 'error'; message: string }
  error: { message: string; cause?: unknown }
}

export interface PrinterDriver {
  readonly kind: 'virtual' | 'ble'
  readonly state: PrinterState
  readonly capabilities: PrinterCapabilities | null

  /** For BLE this must be called from a real user gesture. */
  connect(): Promise<PrinterCapabilities>
  getStatus(): Promise<PrinterStatus>
  print(job: PrintJob, opts?: { signal?: AbortSignal }): Promise<void>
  /**
   * Send a command straight through.
   *
   * Needed by the diagnostics panel: maintenance commands and hand-typed bytes
   * have no place in the normal print path, but on first contact with unfamiliar
   * firmware they are the difference between debugging and guessing.
   */
  sendCommand(bytes: Uint8Array, note?: string): Promise<void>
  /**
   * Send a command and return the reply, or null if none arrives.
   *
   * There is no request id in this protocol — replies are unsolicited
   * notifications — so this simply takes the next frame. That is only sound for
   * one query at a time, which is what the diagnostics panel does.
   */
  query(bytes: Uint8Array, note?: string): Promise<Uint8Array | null>
  disconnect(): Promise<void>

  on<E extends keyof PrinterEvents>(
    event: E,
    handler: (payload: PrinterEvents[E]) => void,
  ): () => void
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  density: 8,
  // Deliberately absent — see PrintSettings.speed.
  paperType: 0x20, // gap labels
  copies: 1,
  // On, because it is the only thing that registers a tall label. A raster that fits
  // under the limit comes back as one band, so this changes nothing for small labels.
  splitForSeek: true,
  // On with it: the boundary costs nothing once the retract is accounted for, so
  // there is no reason to spend a millimetre of picture at each one.
  closeSplitSeam: true,
}
