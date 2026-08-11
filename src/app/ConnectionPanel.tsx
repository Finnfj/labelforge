import { useState } from 'react'
import { DOTS_PER_MM, dotsToMm } from '../model/units'
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
        </div>
      )}

      {connected && connection.kind === 'ble' && (
        <p className="warn">
          Model, firmware and battery are decoded from reply formats that were inferred rather
          than documented — no vendor code parses replies. Firmware, serial and battery have
          since been confirmed against a P50S; model is taken from the advertised Bluetooth
          name because the printer does not answer that query at all.
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
          {/* Not just "Width": the label size panel has one of those too, in mm. */}
          <span style={{ minWidth: '5rem' }}>Head width</span>
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
        {/* Nudges in whole millimetres: measuring an error off a printed label
            gives millimetres, and converting by hand each time invites slips. */}
        <button
          onClick={() =>
            connection.setGeometry({ offsetDots: connection.geometry.offsetDots - DOTS_PER_MM })
          }
        >
          &minus;1 mm
        </button>
        <button
          onClick={() =>
            connection.setGeometry({ offsetDots: connection.geometry.offsetDots + DOTS_PER_MM })
          }
        >
          +1 mm
        </button>
        <span className="hint">
          {connection.geometry.offsetDots === 0
            ? '8 dots = 1 mm; positive moves right'
            : `${(connection.geometry.offsetDots / DOTS_PER_MM).toFixed(2)} mm`}
        </span>
      </div>
      <p className="hint">
        None of this is reported by the printer, so it is measured. Print{' '}
        <strong>Edge frame</strong> from Diagnostics: if all four sides land on the paper the
        width is right. Then draw a rectangle on the label&rsquo;s exact bounds, print it, and
        nudge the offset by however many millimetres it sits out. Saved for next time.
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
