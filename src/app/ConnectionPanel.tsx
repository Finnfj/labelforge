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

      <h3 className="subhead">Print head geometry</h3>
      <div className="row">
        <label className="field">
          <span>Width</span>
          <input
            type="number"
            min={8}
            step={8}
            value={connection.geometry.headWidthDots}
            onChange={(e) =>
              connection.setGeometry({ headWidthDots: Math.max(8, Number(e.target.value) || 8) })
            }
          />
          <em>dots</em>
        </label>
        <span className="hint">= {dotsToMm(connection.geometry.headWidthDots)} mm</span>
        <label className="field">
          <span>Align</span>
          <select
            value={connection.geometry.align}
            onChange={(e) =>
              connection.setGeometry({
                align: e.target.value as 'left' | 'center' | 'right',
              })
            }
          >
            <option value="left">Left</option>
            <option value="center">Centre</option>
            <option value="right">Right</option>
          </select>
        </label>
        <label className="field">
          <span>Offset</span>
          <input
            type="number"
            step={1}
            value={connection.geometry.offsetDots}
            onChange={(e) => connection.setGeometry({ offsetDots: Number(e.target.value) || 0 })}
          />
          <em>dots</em>
        </label>
        <span className="hint">
          {connection.geometry.offsetDots === 0
            ? '8 dots = 1 mm'
            : `${(connection.geometry.offsetDots / 8).toFixed(2)} mm`}
        </span>
      </div>
      <p className="hint">
        Nothing reports any of this, so it is measured rather than queried — print a ruler
        strip from Diagnostics and read it. Where the label is narrower than the head, these
        settings decide which part of the head it sits under; if labels come out shifted
        sideways, this is what to correct. Saved for next time.
      </p>
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
