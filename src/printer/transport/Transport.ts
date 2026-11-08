import type { GattLayout } from '../dialect'

/**
 * The boundary between "how bytes reach the printer" and everything above it.
 *
 * Today the only real implementation is Web Bluetooth. Keeping it behind an
 * interface is what would make a Capacitor build for iOS a new file rather than
 * a rewrite — its BLE plugin delegates to Web Bluetooth on the web anyway, so
 * the shapes already line up.
 */

export type TransportState = 'disconnected' | 'requesting' | 'connecting' | 'ready' | 'error'

/** Printer-to-host channels. Writes always go to the one write characteristic. */
export type NotifyChannel = 'status' | 'credits'

export type TransportEvents = {
  state: TransportState
  disconnected: { reason: string }
  /** Every byte in either direction, for the diagnostics log. */
  wire: { direction: 'in' | 'out'; bytes: Uint8Array; at: number; note?: string }
}

export interface TransportDevice {
  id: string
  name: string
}

export interface ConnectOptions {
  /**
   * Advertised-name prefixes the chooser lists, and every service the app may
   * open once it knows which printer it has. Filled in by the driver from the
   * printer profiles; a transport knows no printer of its own.
   */
  devices?: DeviceFilter
  /**
   * List every nearby device instead of filtering by name.
   *
   * The name filter is what makes the chooser usable, but it also hides a
   * printer whose firmware advertises something unexpected — and since we are
   * working from a reverse-engineered prefix list, that is a real possibility.
   * This is the escape hatch.
   */
  acceptAllDevices?: boolean
}

export interface DeviceFilter {
  namePrefixes: readonly string[]
  /**
   * Requested up front because the browser grants access only to services named
   * before the chooser opens, and which one the printer speaks is known only after.
   */
  services: readonly string[]
}

export interface Transport {
  readonly kind: 'web-bluetooth' | 'mock'
  readonly state: TransportState
  readonly device: TransportDevice | null

  /**
   * Open a connection. On Web Bluetooth this shows the device chooser and so
   * **must** be called synchronously from a user gesture — a click handler that
   * has already awaited something will be rejected by the browser.
   */
  connect(options?: ConnectOptions): Promise<void>
  /**
   * Open the printer's service, once the driver knows which dialect it speaks:
   * the write characteristic, and the notify channels the layout names.
   */
  open(layout: GattLayout): Promise<void>
  disconnect(): Promise<void>

  /** Write one chunk. Chunking and pacing are the driver's job, not the transport's. */
  write(bytes: Uint8Array): Promise<void>

  subscribe(channel: NotifyChannel, handler: (bytes: Uint8Array) => void): Promise<() => void>

  on<E extends keyof TransportEvents>(
    event: E,
    handler: (payload: TransportEvents[E]) => void,
  ): () => void
}

export class TransportError extends Error {
  // Declared explicitly rather than as a constructor parameter property, which
  // `erasableSyntaxOnly` disallows.
  readonly reason: unknown

  constructor(message: string, reason?: unknown) {
    super(message)
    this.name = 'TransportError'
    this.reason = reason
  }
}

export class BluetoothUnavailableError extends TransportError {
  constructor(message: string) {
    super(message)
    this.name = 'BluetoothUnavailableError'
  }
}
