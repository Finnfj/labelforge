import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { VirtualPrinterDriver } from '../printer/drivers/VirtualPrinterDriver'
import { BlePrinterDriver } from '../printer/drivers/BlePrinterDriver'
import { WebBluetoothTransport } from '../printer/transport/WebBluetoothTransport'
import type {
  PrinterCapabilities,
  PrinterDriver,
  PrinterState,
  PrinterStatus,
} from '../printer/types'

export type PrinterKind = 'virtual' | 'ble'

export interface WireEntry {
  dir: 'in' | 'out'
  bytes: Uint8Array
  at: number
  note?: string
}

/** Enough recent traffic to diagnose a failed print without unbounded growth. */
const WIRE_LOG_LIMIT = 500

export interface PrinterConnection {
  kind: PrinterKind
  driver: PrinterDriver
  state: PrinterState
  capabilities: PrinterCapabilities | null
  status: PrinterStatus | null
  error: string | null
  busy: boolean
  bluetoothSupported: boolean
  wireLog: WireEntry[]
  setKind(kind: PrinterKind): void
  connect(options?: { acceptAllDevices?: boolean }): Promise<void>
  disconnect(): Promise<void>
  refreshStatus(): Promise<void>
  clearWireLog(): void
}

export function usePrinter(): PrinterConnection {
  const [kind, setKindState] = useState<PrinterKind>('virtual')
  const [state, setState] = useState<PrinterState>('disconnected')
  const [capabilities, setCapabilities] = useState<PrinterCapabilities | null>(null)
  const [status, setStatus] = useState<PrinterStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wireLog, setWireLog] = useState<WireEntry[]>([])

  const bluetoothSupported = useMemo(() => WebBluetoothTransport.isSupported(), [])

  const driverRef = useRef<PrinterDriver | null>(null)
  if (!driverRef.current) driverRef.current = new VirtualPrinterDriver()
  const driver = driverRef.current

  // Subscribe to whichever driver is current. Re-runs when the kind changes,
  // because that swaps the instance.
  useEffect(() => {
    const offState = driver.on('state', setState)
    const offWire = driver.on('wire', (entry) => {
      setWireLog((log) => {
        const next = log.length >= WIRE_LOG_LIMIT ? log.slice(-WIRE_LOG_LIMIT + 1) : log.slice()
        next.push(entry)
        return next
      })
    })
    const offError = driver.on('error', (e) => setError(e.message))
    setState(driver.state)
    setCapabilities(driver.capabilities)
    return () => {
      offState()
      offWire()
      offError()
    }
  }, [driver])

  const setKind = useCallback(
    (next: PrinterKind) => {
      if (next === kind) return
      const previous = driverRef.current
      // Leaving a live connection open would keep the printer bonded to a driver
      // nothing is listening to any more.
      void previous?.disconnect().catch(() => {})
      driverRef.current =
        next === 'ble'
          ? new BlePrinterDriver(new WebBluetoothTransport())
          : new VirtualPrinterDriver()
      setKindState(next)
      setCapabilities(null)
      setStatus(null)
      setError(null)
      setWireLog([])
      setState('disconnected')
    },
    [kind],
  )

  const connect = useCallback(
    async (options?: { acceptAllDevices?: boolean }) => {
      setError(null)
      setBusy(true)
      try {
        // Called straight from the click handler: Web Bluetooth's chooser needs
        // the user activation still to be live, and any await before this point
        // would forfeit it.
        const current = driverRef.current!
        const caps = await (current as BlePrinterDriver).connect(options)
        setCapabilities(caps)
        try {
          setStatus(await current.getStatus())
        } catch {
          // Status is a nicety; a printer that will not answer can still print.
        }
      } catch (e) {
        setError(describe(e))
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const disconnect = useCallback(async () => {
    setBusy(true)
    try {
      await driverRef.current!.disconnect()
      setCapabilities(null)
      setStatus(null)
    } catch (e) {
      setError(describe(e))
    } finally {
      setBusy(false)
    }
  }, [])

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await driverRef.current!.getStatus())
    } catch (e) {
      setError(describe(e))
    }
  }, [])

  const clearWireLog = useCallback(() => setWireLog([]), [])

  return {
    kind,
    driver,
    state,
    capabilities,
    status,
    error,
    busy,
    bluetoothSupported,
    wireLog,
    setKind,
    connect,
    disconnect,
    refreshStatus,
    clearWireLog,
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
