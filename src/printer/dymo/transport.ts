import { Emitter } from '../../lib/emitter'
import { GattQueue } from '../transport/GattQueue'
import {
  BluetoothUnavailableError,
  TransportError,
  type ConnectOptions,
  type NotifyChannel,
  type Transport,
  type TransportDevice,
  type TransportEvents,
  type TransportState,
} from '../transport/Transport'
import { ADVERTISED_NAME_PREFIX, CHAR_NOTIFY_STATUS, CHAR_WRITE, SERVICE_UUID } from './constants'

type Handler = (bytes: Uint8Array) => void

/**
 * Web Bluetooth transport for the DYMO LetraTag.
 *
 * Deliberately not a parameterised version of `WebBluetoothTransport` — that class
 * is written entirely around the MarkLife family's GATT layout (a credits channel,
 * `writeWithoutResponse`, a 90-byte application chunk size), none of which applies
 * here: this device has one write characteristic, one notify characteristic, no
 * flow control, and every write in every capture was a `Write Request` (with
 * response), never `writeValueWithoutResponse`. Sharing the file would mean
 * threading MarkLife-only concepts through with "if (dymo) skip this" branches,
 * which is worse than two small, separately readable classes.
 */
export class DymoWebBluetoothTransport implements Transport {
  readonly kind = 'web-bluetooth' as const

  #state: TransportState = 'disconnected'
  #device: BluetoothDevice | null = null
  #write: BluetoothRemoteGATTCharacteristic | null = null
  #handlers = new Map<NotifyChannel, Set<Handler>>()
  #emitter = new Emitter<TransportEvents>()
  #queue = new GattQueue()

  get state(): TransportState {
    return this.#state
  }

  get device(): TransportDevice | null {
    return this.#device ? { id: this.#device.id, name: this.#device.name ?? 'Unknown' } : null
  }

  on = <E extends keyof TransportEvents>(
    event: E,
    handler: (payload: TransportEvents[E]) => void,
  ): (() => void) => this.#emitter.on(event, handler)

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator
  }

  async connect(options: ConnectOptions = {}): Promise<void> {
    if (!DymoWebBluetoothTransport.isSupported()) {
      throw new BluetoothUnavailableError(
        'This browser has no Web Bluetooth. Use Chrome or Edge on desktop, or Chrome on Android — ' +
          'Safari and Firefox do not implement it.',
      )
    }
    if (!window.isSecureContext) {
      throw new BluetoothUnavailableError(
        'Web Bluetooth needs a secure context. Open the app over HTTPS or on localhost.',
      )
    }

    this.#setState('requesting')
    let device: BluetoothDevice
    try {
      device = await navigator.bluetooth.requestDevice(
        options.acceptAllDevices
          ? { acceptAllDevices: true, optionalServices: [SERVICE_UUID] }
          : {
              filters: [{ namePrefix: ADVERTISED_NAME_PREFIX }],
              optionalServices: [SERVICE_UUID],
            },
      )
    } catch (error) {
      this.#setState('disconnected')
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        throw new TransportError(
          'No printer was selected. If the list was empty, switch the printer on and try ' +
            '"Show all devices".',
          error,
        )
      }
      throw new TransportError('Could not open the Bluetooth chooser.', error)
    }

    this.#device = device
    device.addEventListener('gattserverdisconnected', this.#onDisconnected)

    try {
      this.#setState('connecting')
      this.#queue.reopen()
      await this.#openGatt(device)
      this.#setState('ready')
    } catch (error) {
      await this.disconnect()
      throw error instanceof TransportError
        ? error
        : new TransportError('Connected to the printer but could not set up its service.', error)
    }
  }

  async #openGatt(device: BluetoothDevice): Promise<void> {
    const server = await this.#queue.run('gatt.connect', () => {
      if (!device.gatt) throw new TransportError('This device exposes no GATT server.')
      return device.gatt.connect()
    })

    const service = await this.#queue.run('getPrimaryService', () =>
      server.getPrimaryService(SERVICE_UUID),
    )

    this.#write = await this.#queue.run('getCharacteristic(write)', () =>
      service.getCharacteristic(CHAR_WRITE),
    )

    const status = await this.#queue.run('getCharacteristic(status)', () =>
      service.getCharacteristic(CHAR_NOTIFY_STATUS),
    )
    status.addEventListener('characteristicvaluechanged', this.#onNotify('status'))
    await this.#queue.run('startNotifications(status)', () => status.startNotifications())
  }

  #onNotify(channel: NotifyChannel) {
    return (event: Event) => {
      const target = event.target as BluetoothRemoteGATTCharacteristic
      const value = target.value
      if (!value) return
      const bytes = new Uint8Array(
        value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
      )
      this.#emitter.emit('wire', { direction: 'in', bytes, at: Date.now(), note: channel })
      for (const handler of this.#handlers.get(channel) ?? []) handler(bytes)
    }
  }

  #onDisconnected = () => {
    this.#write = null
    this.#queue.close('the printer disconnected')
    this.#setState('disconnected')
    this.#emitter.emit('disconnected', { reason: 'The printer disconnected.' })
  }

  async subscribe(channel: NotifyChannel, handler: Handler): Promise<() => void> {
    let set = this.#handlers.get(channel)
    if (!set) {
      set = new Set()
      this.#handlers.set(channel, set)
    }
    set.add(handler)
    return () => {
      set.delete(handler)
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    const characteristic = this.#write
    if (!characteristic) throw new TransportError('Not connected to a printer.')

    // Copy into a plain ArrayBuffer-backed view — see WebBluetoothTransport's
    // identical comment on why `bytes` alone cannot always be passed directly.
    const payload = new Uint8Array(bytes.length)
    payload.set(bytes)

    // Every write in every capture of the vendor app was a Write Request (with
    // response), never writeValueWithoutResponse — reproduced as-is rather than
    // switched to the faster path on the assumption it would also work.
    await this.#queue.run('write', () => characteristic.writeValueWithResponse(payload))
    this.#emitter.emit('wire', { direction: 'out', bytes, at: Date.now() })
  }

  async disconnect(): Promise<void> {
    const device = this.#device
    this.#queue.close('disconnecting')
    this.#write = null
    if (device) {
      device.removeEventListener('gattserverdisconnected', this.#onDisconnected)
      try {
        device.gatt?.disconnect()
      } catch {
        // Already gone; nothing useful to do.
      }
    }
    this.#device = null
    this.#setState('disconnected')
  }

  #setState(state: TransportState): void {
    this.#state = state
    this.#emitter.emit('state', state)
  }
}
