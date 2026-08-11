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

/**
 * Where the print head sits relative to the paper.
 *
 * None of this can be queried — no command reports head width, and nothing
 * reports how the stock is loaded under it. On a 40 mm roll under a 48 mm head
 * there are 64 dots of head with no paper beneath them, and whether dot 0 lands
 * on the paper's edge or 4 mm inside it decides whether every label is straight
 * or shifted. So it is user configuration, established with the ruler strip.
 */
export interface HeadGeometry {
  headWidthDots: number
  align: 'left' | 'center' | 'right'
  /** Fine adjustment in dots; 8 dots is 1 mm. May be negative. */
  offsetDots: number
}

const GEOMETRY_KEY = 'labelforge.geometry.v1'

/**
 * 384 dots (48 mm) is the vendor SDK's hardcoded width, and a P50S was observed
 * printing a 384-dot strip in full while a 400-dot one overflowed — so it is a
 * measured default rather than a guess, but still per-printer configuration.
 */
export const DEFAULT_GEOMETRY: HeadGeometry = {
  headWidthDots: 384,
  align: 'left',
  offsetDots: 0,
}

function loadGeometry(): HeadGeometry {
  try {
    const raw = localStorage.getItem(GEOMETRY_KEY)
    if (!raw) return DEFAULT_GEOMETRY
    const parsed = JSON.parse(raw) as Partial<HeadGeometry>
    return {
      headWidthDots:
        Number.isFinite(parsed.headWidthDots) && parsed.headWidthDots! > 0
          ? Math.round(parsed.headWidthDots!)
          : DEFAULT_GEOMETRY.headWidthDots,
      align:
        parsed.align === 'center' || parsed.align === 'right'
          ? parsed.align
          : 'left',
      offsetDots: Number.isFinite(parsed.offsetDots) ? Math.round(parsed.offsetDots!) : 0,
    }
  } catch {
    return DEFAULT_GEOMETRY
  }
}

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
  geometry: HeadGeometry
  setGeometry(patch: Partial<HeadGeometry>): void
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
  const [geometry, setGeometryState] = useState<HeadGeometry>(loadGeometry)

  const setGeometry = useCallback((patch: Partial<HeadGeometry>) => {
    setGeometryState((current) => {
      const next = { ...current, ...patch }
      try {
        localStorage.setItem(GEOMETRY_KEY, JSON.stringify(next))
      } catch {
        // Private-mode storage refusal must not break printing.
      }
      return next
    })
  }, [])

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
    geometry,
    setGeometry,
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
