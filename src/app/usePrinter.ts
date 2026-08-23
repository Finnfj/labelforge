import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { VirtualPrinterDriver } from '../printer/drivers/VirtualPrinterDriver'
import { BlePrinterDriver } from '../printer/drivers/BlePrinterDriver'
import { WebBluetoothTransport } from '../printer/transport/WebBluetoothTransport'
import { findProfile } from '../printer/profiles'
import { DEFAULT_HEAD_WIDTH_DOTS } from '../model/units'
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
  /**
   * Pad the raster out to the full head width and position the label inside it.
   *
   * Off by default, because an HCI capture settled what the vendor app does: for a
   * 40 mm label it sends a 320-dot raster — exactly the label width, no padding at
   * all — and lets the printer place it. Matching that is strictly better than
   * guessing at an alignment. The option remains for diagnosing placement, since
   * padding is the only way to address a specific head column.
   */
  padToHead: boolean
  align: 'left' | 'center' | 'right'
  /** Fine adjustment in dots; 8 dots is 1 mm. May be negative. */
  offsetDots: number
  /**
   * Blank rows fed after each label, to cross the inter-label gap.
   *
   * Now a fallback rather than the mechanism: the print sequence ends with a
   * sensor-driven gap seek, which is how the vendor app registers each label. Left
   * in for continuous stock and for the case where the seek misbehaves.
   */
  feedAfterDots: number
}

const GEOMETRY_KEY = 'labelforge.geometry.v1'

/**
 * Head width is 384 dots (48 mm), from the edge-frame pattern — see
 * DEFAULT_HEAD_WIDTH_DOTS. Everything else here now matches the vendor app rather
 * than being inferred.
 *
 * No padding, no feed: the app sends a label-width raster and ends the job with a
 * sensor gap seek. Alignment and offset only take effect when padding is turned
 * back on, and are kept for diagnosing placement.
 */
export const DEFAULT_GEOMETRY: HeadGeometry = {
  headWidthDots: DEFAULT_HEAD_WIDTH_DOTS,
  padToHead: false,
  align: 'left',
  offsetDots: 0,
  feedAfterDots: 0,
}

/**
 * Bumped when a stored default would now be wrong.
 *
 * Version 2 discarded pre-geometry settings. Version 3 discards the settings that
 * existed to work around the missing gap seek — right alignment, head-width padding
 * and a 2 mm blank feed. Those were reasonable inferences and they are now known to
 * be wrong, so a stored copy of them has to go, even though stored values normally
 * outrank defaults. Head width is exempt from that reasoning but rides along.
 */
const GEOMETRY_VERSION = 3

function loadGeometry(): HeadGeometry {
  try {
    const raw = localStorage.getItem(GEOMETRY_KEY)
    if (!raw) return DEFAULT_GEOMETRY
    const parsed = JSON.parse(raw) as Partial<HeadGeometry> & { version?: number }
    if (parsed.version !== GEOMETRY_VERSION) return DEFAULT_GEOMETRY
    return {
      headWidthDots:
        Number.isFinite(parsed.headWidthDots) && parsed.headWidthDots! > 0
          ? Math.round(parsed.headWidthDots!)
          : DEFAULT_GEOMETRY.headWidthDots,
      padToHead: parsed.padToHead === true,
      align: parsed.align === 'center' || parsed.align === 'right' ? parsed.align : 'left',
      offsetDots: Number.isFinite(parsed.offsetDots) ? Math.round(parsed.offsetDots!) : 0,
      feedAfterDots: Number.isFinite(parsed.feedAfterDots)
        ? Math.max(0, Math.round(parsed.feedAfterDots!))
        : DEFAULT_GEOMETRY.feedAfterDots,
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

/**
 * Enough recent traffic to diagnose a failed print without unbounded growth.
 *
 * 500 was not. A single 80 mm label is ~250 chunks and ~250 credit
 * notifications, so the one job the log was asked to explain filled the ring
 * exactly and pushed its own opening commands out — leaving a log that showed
 * the density and paper type had been set to *something*. 4000 holds several
 * copies of the largest stock the app offers, at a few hundred KB.
 */
const WIRE_LOG_LIMIT = 4000

export interface PrinterConnection {
  kind: PrinterKind
  /**
   * Forced model, or null to detect from the advertised name.
   *
   * A diagnostic escape hatch: detection matches a name prefix that came from
   * reverse engineering, so it will eventually misidentify somebody's printer,
   * and that person needs a way through without waiting for a release.
   */
  profileOverride: string | null
  setProfileOverride(id: string | null): void
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
  // Bluetooth by default. The virtual printer used to hold this spot, which meant
  // the app opened already "connected" to something that cannot print — a fine
  // demo and a poor default. It is now revealed from Diagnostics; see
  // `useDiagnosticFlags`.
  const [kind, setKindState] = useState<PrinterKind>('ble')
  const [state, setState] = useState<PrinterState>('disconnected')
  const [capabilities, setCapabilities] = useState<PrinterCapabilities | null>(null)
  const [status, setStatus] = useState<PrinterStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [wireLog, setWireLog] = useState<WireEntry[]>([])
  const [geometry, setGeometryState] = useState<HeadGeometry>(loadGeometry)
  const [profileOverride, setProfileOverrideState] = useState<string | null>(null)

  const setGeometry = useCallback((patch: Partial<HeadGeometry>) => {
    setGeometryState((current) => {
      const next = { ...current, ...patch }
      try {
        localStorage.setItem(GEOMETRY_KEY, JSON.stringify({ ...next, version: GEOMETRY_VERSION }))
      } catch {
        // Private-mode storage refusal must not break printing.
      }
      return next
    })
  }, [])

  const bluetoothSupported = useMemo(() => WebBluetoothTransport.isSupported(), [])

  // Constructing the transport is free and cannot throw: every capability check
  // is deferred to `connect()` or the static `isSupported()`, so this is safe
  // even in a browser with no Web Bluetooth at all.
  const driverRef = useRef<PrinterDriver | null>(null)
  if (!driverRef.current) driverRef.current = makeBleDriver(null)
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
        next === 'ble' ? makeBleDriver(profileOverride) : new VirtualPrinterDriver()
      setKindState(next)
      setCapabilities(null)
      setStatus(null)
      setError(null)
      setWireLog([])
      setState('disconnected')
    },
    [kind, profileOverride],
  )

  const connect = useCallback(async (options?: { acceptAllDevices?: boolean }) => {
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
  }, [])

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

  // Changing the override has to rebuild the driver: the profile decides the
  // chunk size and head width the driver is constructed with, and detection
  // runs inside connect().
  const setProfileOverride = useCallback(
    (id: string | null) => {
      setProfileOverrideState(id)
      if (kind !== 'ble') return
      void driverRef.current?.disconnect().catch(() => {})
      driverRef.current = makeBleDriver(id)
      setCapabilities(null)
      setStatus(null)
      setError(null)
      setState('disconnected')
    },
    [kind],
  )

  return {
    kind,
    profileOverride,
    setProfileOverride,
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

/** A BLE driver, optionally pinned to a model rather than detecting one. */
function makeBleDriver(overrideId: string | null): BlePrinterDriver {
  const profile = overrideId ? findProfile(overrideId) : undefined
  return new BlePrinterDriver(
    new WebBluetoothTransport(),
    profile ? { profile, lockProfile: true } : {},
  )
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
