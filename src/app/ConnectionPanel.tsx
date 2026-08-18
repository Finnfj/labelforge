import { useState } from 'react'
import { DOTS_PER_MM, dotsToMm } from '../model/units'
import { REPO_URL } from './links'
import type { DiagnosticFlags } from './useDiagnosticFlags'
import type { PrinterConnection } from './usePrinter'

const FAULT_TEXT: Record<string, string> = {
  none: 'Ready',
  'no-paper': 'Out of paper',
  'cover-open': 'Cover open',
  overheat: 'Print head too hot',
  'low-battery': 'Battery low',
  unknown: 'Unknown',
}

export function ConnectionPanel({
  connection,
  flags,
}: {
  connection: PrinterConnection
  flags: DiagnosticFlags
}) {
  const [acceptAllDevices, setAcceptAllDevices] = useState(false)
  const connected = connection.state !== 'disconnected' && connection.capabilities !== null

  return (
    <section className="panel">
      <div className="row row--between">
        <h2>Printer</h2>
        <div className="row">
          {/* One entry is not a choice. With the virtual printer hidden the select
              would be a disabled-looking box saying "Bluetooth printer", which is
              worse than the fact stated plainly next to the button. */}
          {flags.virtualPrinter && (
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
          )}
          {connected ? (
            <button disabled={connection.busy} onClick={() => void connection.disconnect()}>
              Disconnect
            </button>
          ) : (
            <button
              className="primary"
              disabled={
                connection.busy || (connection.kind === 'ble' && !connection.bluetoothSupported)
              }
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
          This browser has no Web Bluetooth. Use Chrome or Edge on desktop, or Chrome on Android —
          Safari and Firefox do not implement it and cannot be made to.
          {!flags.virtualPrinter && (
            <>
              {' '}
              To try the designer anyway, tick <strong>Offer the virtual printer</strong> under
              Diagnostics at the foot of the page: it runs the real command sequence and the real
              encoder against no hardware.
            </>
          )}
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
            The chooser normally lists only devices whose name starts with P50. Tick the box above
            if yours does not appear — the name prefixes come from reverse engineering, not from a
            specification, so an unexpected one is quite possible.
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
          {/* Only shown when the printer actually answered. A P50S does not
              implement the status query, and captioning that "Unknown" reads as
              a fault rather than an absent feature. */}
          {connection.status && connection.status.fault !== 'unknown' && (
            <Fact label="State" value={FAULT_TEXT[connection.status.fault] ?? 'Unknown'} />
          )}
        </div>
      )}

      {connected && connection.capabilities?.support === 'unverified' && (
        <p className="warn">
          <strong>This model has never been tested against real hardware.</strong> It is believed to
          use the same print protocol as the P50, from a third party&rsquo;s reverse engineering of
          the vendor app rather than from anything observed here — so the head width and the command
          sequence are the P50&rsquo;s, not measured values. If it prints, or if it does not, please{' '}
          <a href={`${REPO_URL}/issues`} target="_blank" rel="noopener noreferrer">
            say so
          </a>
          : that is the only way this stops being a guess.
        </p>
      )}

      {connected && connection.capabilities?.profileAssumed && (
        <p className="hint">
          This printer&rsquo;s advertised name matched no model we know, so it is being driven as a
          P50. That is the right guess more often than not — the name prefixes come from reverse
          engineering rather than a specification.
        </p>
      )}

      {connected && connection.kind === 'ble' && (
        <p className="warn">
          Model, firmware and battery are decoded from reply formats that were inferred rather than
          documented — no vendor code parses replies. Firmware, serial and battery have since been
          confirmed against a P50S; model is taken from the advertised Bluetooth name because the
          printer does not answer that query at all.
        </p>
      )}

      {connected && (
        <div className="row" style={{ marginTop: '0.6rem' }}>
          <button onClick={() => void connection.refreshStatus()}>Refresh status</button>
        </div>
      )}

      {/*
        All of this turned out to be unnecessary, so it is folded away rather than
        deleted. The capture of the vendor app settled both questions it existed to
        answer: the raster goes out at label width with no padding and no alignment
        choice, and registration comes from a sensor gap seek rather than a measured
        blank feed. What is left is for diagnosing placement on stock that
        misbehaves, which is a real but rare need.
      */}
      <details className="advanced">
        <summary>
          Head geometry and manual feed
          <span className="advanced__hint">
            defaults now match the vendor app &mdash; you should not need these
          </span>
        </summary>
        <div className="advanced__body">
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
                  connection.setGeometry({
                    headWidthDots: Math.max(8, Number(e.target.value) || 8),
                  })
                }
              />
              <em>dots</em>
            </label>
            <span className="hint">= {dotsToMm(connection.geometry.headWidthDots)} mm</span>
            <label className="field field--check">
              <input
                type="checkbox"
                checked={connection.geometry.padToHead}
                onChange={(e) => connection.setGeometry({ padToHead: e.target.checked })}
              />
              <span>Pad to head width</span>
            </label>
            <label className="field">
              <span>Align</span>
              <select
                value={connection.geometry.align}
                disabled={!connection.geometry.padToHead}
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
                disabled={!connection.geometry.padToHead}
                value={connection.geometry.offsetDots}
                onChange={(e) =>
                  connection.setGeometry({ offsetDots: Number(e.target.value) || 0 })
                }
              />
              <em>dots</em>
            </label>
            {/* Nudges in whole millimetres: measuring an error off a printed label
            gives millimetres, and converting by hand each time invites slips. */}
            <button
              disabled={!connection.geometry.padToHead}
              onClick={() =>
                connection.setGeometry({ offsetDots: connection.geometry.offsetDots - DOTS_PER_MM })
              }
            >
              &minus;1 mm
            </button>
            <button
              disabled={!connection.geometry.padToHead}
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
            Leave padding <strong>off</strong>. A capture of the vendor app&rsquo;s Bluetooth
            traffic shows it sends a raster exactly as wide as the label &mdash; 320 dots for a
            40&nbsp;mm one &mdash; and lets the printer position it. Padding out to the head and
            choosing an alignment was our guess at what it did, and the guess was wrong.
            <br />
            Turn it on only to diagnose placement, since padding is the only way to aim at a
            specific head column. Head width still matters as a limit: print{' '}
            <strong>Edge frame</strong> from Diagnostics and if all four sides land on the paper it
            is right.
          </p>

          <h3 className="subhead">Inter-label gap</h3>
          <div className="row">
            <label className="field">
              <span style={{ minWidth: '5rem' }}>Feed after</span>
              <input
                type="number"
                min={0}
                step={1}
                value={connection.geometry.feedAfterDots}
                onChange={(e) =>
                  connection.setGeometry({
                    feedAfterDots: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
              <em>dots</em>
            </label>
            <button
              onClick={() =>
                connection.setGeometry({
                  feedAfterDots: Math.max(0, connection.geometry.feedAfterDots - DOTS_PER_MM),
                })
              }
            >
              &minus;1 mm
            </button>
            <button
              onClick={() =>
                connection.setGeometry({
                  feedAfterDots: connection.geometry.feedAfterDots + DOTS_PER_MM,
                })
              }
            >
              +1 mm
            </button>
            <span className="hint">
              {(connection.geometry.feedAfterDots / DOTS_PER_MM).toFixed(2)} mm of blank fed after
              each label
            </span>
          </div>
          <p className="hint">
            <strong>Normally leave this at 0.</strong> Every print now ends with a sensor-driven gap
            seek — the same command, in the same place, as the vendor app — so the printer finds the
            next label itself and nothing accumulates. This setting appends blank rows to the raster
            instead, which was the workaround for the seek we had not yet found.
            <br />
            Still useful in two cases: continuous tape, where there is no gap to seek and a few
            millimetres of lead-out is convenient; and as a fallback if the seek misbehaves on your
            stock. To tune it, print the same label three times — if each creeps <em>backwards</em>,
            add that many millimetres.
          </p>
        </div>
      </details>
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
