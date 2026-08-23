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
   * Register the roll after a label too large to do it itself.
   *
   * A P50S honours a job's own gap seek only when it read the whole job before
   * starting the motor; above `SEEK_SAFE_JOB_BYTES` it did not, so an oversized
   * label is followed by a 52-byte job carrying nothing but a millimetre of blank
   * raster and the same seek. See `followUpSeekJob()`.
   *
   * On by default, and a per-print choice rather than a fixed behaviour because
   * whether it is wanted depends on where the paper already is, which nothing on
   * this firmware reports:
   *
   * - Roll out of registration — after loading paper, or after a label that
   *   printed without one — the seek finds the next gap and fixes it.
   * - Roll already registered, which is what a full-height label leaves behind,
   *   the paper having stopped at the gap: the seek runs on to the *next* gap and
   *   a blank label comes out with it.
   *
   * Costing a label is the better failure of the two, so it stays on unless
   * turned off. Ignored for a label small enough to seek inside its own job,
   * where the printer does this itself and gets it right.
   */
  followUpSeek?: boolean
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
  followUpSeek: true,
}
