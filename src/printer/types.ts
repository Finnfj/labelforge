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
   * Register the roll after a label too large to do it itself.
   *
   * A P50S honours a job's own gap seek only when it read the whole job before
   * starting the motor; above `SEEK_SAFE_JOB_BYTES` it did not, so an oversized
   * label can be followed by a 52-byte job carrying nothing but a millimetre of
   * blank raster and the same seek. See `followUpSeekJob()`.
   *
   * **Off by default, because it is a repair rather than a routine.** It does
   * register a roll that has lost its place. On a roll that has not, it costs
   * paper and does not settle: a full-height label ends at the gap, and seeking
   * from there has been observed both to run a whole pitch onto the label after
   * next, and to stop 20 mm into the next label. Where it stops is not something
   * the wire can predict, and nothing on this firmware reports where the paper
   * is.
   *
   * For keeping a tall label registered print to print, `feedAfterDots` is the
   * mechanism that behaves: blank rows move paper by exactly as many as you send.
   * Open-loop, so a wrong gap accumulates — but it accumulates predictably, and
   * one pass with the +/-1 mm buttons settles it for a given stock.
   *
   * Ignored for a label small enough to seek inside its own job, where the
   * printer does this itself and gets it right.
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
  followUpSeek: false,
}
