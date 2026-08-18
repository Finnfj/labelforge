import { Emitter } from '../../lib/emitter'
import {
  CHAR_NOTIFY_CREDITS,
  CHAR_NOTIFY_STATUS,
  CHAR_WRITE,
  SERVICE_UUID,
} from '../protocol/constants'
import { ALL_NAME_PREFIXES } from '../profiles'
import { GattQueue } from './GattQueue'
import {
  BluetoothUnavailableError,
  TransportError,
  type ConnectOptions,
  type NotifyChannel,
  type Transport,
  type TransportDevice,
  type TransportEvents,
  type TransportState,
} from './Transport'

type Handler = (bytes: Uint8Array) => void

export class WebBluetoothTransport implements Transport {
  readonly kind = 'web-bluetooth' as const

  #state: TransportState = 'disconnected'
  #device: BluetoothDevice | null = null
  #write: BluetoothRemoteGATTCharacteristic | null = null
  #notifiers = new Map<NotifyChannel, BluetoothRemoteGATTCharacteristic>()
  #handlers = new Map<NotifyChannel, Set<Handler>>()
  #emitter = new Emitter<TransportEvents>()
  #queue = new GattQueue()
  /** Whether the write characteristic supports the fast, unacknowledged path. */
  #canWriteWithoutResponse = false

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

  /** Whether a radio is present and switched on, where the browser will say. */
  static async isAvailable(): Promise<boolean> {
    if (!WebBluetoothTransport.isSupported()) return false
    try {
      return await navigator.bluetooth.getAvailability()
    } catch {
      return false
    }
  }

  async connect(options: ConnectOptions = {}): Promise<void> {
    if (!WebBluetoothTransport.isSupported()) {
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
      // Filter by advertised name, never by service UUID: these printers do not
      // put the 128-bit service in their advertisement, so a service filter
      // yields an empty chooser and looks like the printer is missing.
      device = await navigator.bluetooth.requestDevice(
        options.acceptAllDevices
          ? { acceptAllDevices: true, optionalServices: [SERVICE_UUID] }
          : {
              filters: ALL_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
              optionalServices: [SERVICE_UUID],
            },
      )
    } catch (error) {
      this.#setState('disconnected')
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        throw new TransportError(
          'No printer was selected. If the list was empty, switch the printer on and try ' +
            '"Show all devices" — its advertised name may not start with P50.',
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
    this.#canWriteWithoutResponse = Boolean(this.#write.properties?.writeWithoutResponse)

    // Both notify channels must be live before any print starts: without the
    // status channel there is no acknowledgement, and without credits the job
    // stalls waiting for a window that was never opened.
    for (const [channel, uuid] of [
      ['status', CHAR_NOTIFY_STATUS],
      ['credits', CHAR_NOTIFY_CREDITS],
    ] as const) {
      try {
        const characteristic = await this.#queue.run(`getCharacteristic(${channel})`, () =>
          service.getCharacteristic(uuid),
        )
        characteristic.addEventListener('characteristicvaluechanged', this.#onNotify(channel))
        await this.#queue.run(`startNotifications(${channel})`, () =>
          characteristic.startNotifications(),
        )
        this.#notifiers.set(channel, characteristic)
      } catch (error) {
        // A printer without the credits channel still prints, just paced by
        // delay. Losing the status channel is survivable too. Neither is worth
        // refusing the connection over.
        this.#emitter.emit('wire', {
          direction: 'in',
          bytes: new Uint8Array(),
          at: Date.now(),
          note: `${channel} channel unavailable: ${String(error)}`,
        })
      }
    }
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
    // Every characteristic handle is invalidated by a disconnect; keeping them
    // would produce confusing "GATT operation failed" errors on reconnect.
    this.#write = null
    this.#notifiers.clear()
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

    // Copy into a plain ArrayBuffer-backed view: `bytes` is often a subarray of
    // a larger raster buffer, and the Web Bluetooth signature will not accept a
    // view whose buffer type is not statically an ArrayBuffer.
    const payload = new Uint8Array(bytes.length)
    payload.set(bytes)

    await this.#queue.run('write', async () => {
      // Without-response is dramatically faster — several packets per connection
      // event instead of one round trip each — and is what pairs with the credit
      // window. With-response is the fallback when the firmware does not offer it.
      if (this.#canWriteWithoutResponse) await characteristic.writeValueWithoutResponse(payload)
      else await characteristic.writeValueWithResponse(payload)
    })
    this.#emitter.emit('wire', { direction: 'out', bytes, at: Date.now() })
  }

  async disconnect(): Promise<void> {
    const device = this.#device
    this.#queue.close('disconnecting')
    this.#write = null
    this.#notifiers.clear()
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
