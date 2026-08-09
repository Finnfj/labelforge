import { useState } from 'react'
import { dotsToMm } from '../model/units'
import type { PrinterConnection } from './usePrinter'

const FAULT_TEXT: Record<string, string> = {
  none: 'Ready',
  'no-paper': 'Out of paper',
  'cover-open': 'Cover open',
  overheat: 'Print head too hot',
  'low-battery': 'Battery low',
  unknown: 'Unknown',
}

export function ConnectionPanel({ connection }: { connection: PrinterConnection }) {
  const [acceptAllDevices, setAcceptAllDevices] = useState(false)
  const connected = connection.state !== 'disconnected' && connection.capabilities !== null

  return (
    <section className="panel">
      <div className="row row--between">
        <h2>Printer</h2>
        <div className="row">
          <label className="field">
            <span>Output</span>
            <select
              value={connection.kind}
              disabled={connection.busy}
              onChange={(e) => connection.setKind(e.target.value as 'virtual' | 'ble')}
            >
              <option value="virtual">Virtual printer</option>
              <option value="ble">Bluetooth printer</option>
            </select>
          </label>
          {connected ? (
            <button disabled={connection.busy} onClick={() => void connection.disconnect()}>
              Disconnect
            </button>
          ) : (
            <button
              className="primary"
              disabled={connection.busy || (connection.kind === 'ble' && !connection.bluetoothSupported)}
              // Straight through to the driver: Web Bluetooth's chooser is only
              // allowed while the click's user activation is still live, so this
              // must not await anything first.
              onClick={() => void connection.connect({ acceptAllDevices })}
            >
              {connection.kind === 'ble' ? 'Connect…' : 'Start virtual printer'}
            </button>
          )}
        </div>
      </div>

      {connection.kind === 'ble' && !connection.bluetoothSupported && (
        <p className="error">
          This browser has no Web Bluetooth. Use Chrome or Edge on desktop, or Chrome on
          Android — Safari and Firefox do not implement it and cannot be made to.
        </p>
      )}

      {connection.kind === 'ble' && connection.bluetoothSupported && !connected && (
        <>
          <label className="field field--check">
            <input
              type="checkbox"
              checked={acceptAllDevices}
              onChange={(e) => setAcceptAllDevices(e.target.checked)}
            />
            <span>Show all Bluetooth devices</span>
          </label>
          <p className="hint">
            The chooser normally lists only devices whose name starts with P50. Tick the box
            above if yours does not appear — the name prefixes come from reverse
            engineering, not from a specification, so an unexpected one is quite possible.
          </p>
        </>
      )}

      {connection.error && <p className="error">{connection.error}</p>}

      {connected && connection.capabilities && (
        <div className="facts">
          <Fact label="Model" value={connection.capabilities.model} />
          <Fact label="Firmware" value={connection.capabilities.firmware} />
          <Fact label="Serial" value={connection.capabilities.serial} />
          <Fact
            label="Battery"
            value={
              connection.status?.batteryPercent != null
                ? `${connection.status.batteryPercent}%`
                : '—'
            }
          />
          <Fact
            label="State"
            value={FAULT_TEXT[connection.status?.fault ?? 'unknown'] ?? 'Unknown'}
          />
          <Fact
            label="Head width"
            value={`${connection.capabilities.headWidthDots} dots (${dotsToMm(
              connection.capabilities.headWidthDots,
            )} mm)`}
          />
        </div>
      )}

      {connected && connection.kind === 'ble' && (
        <p className="warn">
          Model, firmware and battery are decoded from reply formats that were inferred, not
          documented — no vendor code parses replies, so nothing here has been confirmed
          against real hardware. Treat them as provisional. Head width is an assumption too,
          until the ruler strip measures it.
        </p>
      )}

      {connected && (
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <button onClick={() => void connection.refreshStatus()}>Refresh status</button>
        </div>
      )}
    </section>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="facts__item">
      <span className="facts__label">{label}</span>
      <span className="facts__value">{value}</span>
    </div>
  )
}
