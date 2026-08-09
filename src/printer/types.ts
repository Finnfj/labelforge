import type { PackedBitmap } from '../model/bitmap'
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
}

export type PrinterFault =
  | 'none'
  | 'no-paper'
  | 'cover-open'
  | 'overheat'
  | 'low-battery'
  | 'unknown'

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
  speed: SpeedValue
  paperType: PaperTypeValue
  copies: number
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

export type PrinterState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'printing'
  | 'error'

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
  disconnect(): Promise<void>

  on<E extends keyof PrinterEvents>(
    event: E,
    handler: (payload: PrinterEvents[E]) => void,
  ): () => void
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  density: 8,
  speed: 1,
  paperType: 0x20, // gap labels
  copies: 1,
}
