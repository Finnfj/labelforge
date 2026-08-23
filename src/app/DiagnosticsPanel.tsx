import { useMemo, useState } from 'react'
import { DOTS_PER_MM, dotsToMm } from '../model/units'
import * as cmd from '../printer/protocol/commands'
import { PaperType } from '../printer/protocol/constants'
import {
  blankLabel,
  densityPatch,
  edgeFrame,
  rulerStrip,
} from '../printer/diagnostics/testPatterns'
import { DEFAULT_PRINT_SETTINGS } from '../printer/types'
import { decodeText, toHex } from '../printer/protocol/responses'
import { BlePrinterDriver } from '../printer/drivers/BlePrinterDriver'
import type { DiagnosticFlagsHandle } from './useDiagnosticFlags'
import { PROFILES } from '../printer/profiles'
import type { PrinterConnection, WireEntry } from './usePrinter'

/** Densities to walk when finding a good darkness. One label each. */
const DENSITY_LADDER = [3, 6, 9, 12, 15]

/** Candidate head widths for the ruler probe. */
const HEAD_WIDTH_CANDIDATES = [320, 384, 400, 576]

export function DiagnosticsPanel({
  connection,
  diagnostics,
}: {
  connection: PrinterConnection
  diagnostics: DiagnosticFlagsHandle
}) {
  const [open, setOpen] = useState(false)
  const [rawHex, setRawHex] = useState('')
  const [feedMm, setFeedMm] = useState(5)
  const [wrapInJob, setWrapInJob] = useState(true)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [replies, setReplies] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const connected = connection.capabilities != null
  const headWidth = connection.geometry.headWidthDots

  const run = async (label: string, action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      await action()
      setNote(`${label}: sent.`)
    } catch (e) {
      setError(`${label}: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const send = (label: string, bytes: Uint8Array) =>
    run(label, () => connection.driver.sendCommand(bytes, label))

  /**
   * Send a command inside a print job.
   *
   * The theory was that these commands only act within a job. Tested against self
   * test, it was refuted: nothing happens bare or wrapped.
   *
   * An HCI capture of the vendor app later showed the theory was too weak rather
   * than wrong. It does issue `locate(gap)` inside a job — but *after* a raster
   * payload, not in an empty one. So the requirement is a job with something to
   * print, which this toggle cannot construct; the real print path does it instead.
   * Kept for repeating the experiment on other firmware.
   */
  const sendInJob = (label: string, bytes: Uint8Array) =>
    run(label, async () => {
      const driver = connection.driver
      if (!wrapInJob) {
        await driver.sendCommand(bytes, label)
        return
      }
      await driver.sendCommand(cmd.startPrintJob(), 'startPrintJob')
      await driver.sendCommand(bytes, label)
      await driver.sendCommand(cmd.stopPrintJob(), 'stopPrintJob')
    })

  /**
   * Send a read-only command and show whatever comes back.
   *
   * This exists because several `1f`-prefixed commands are inert on P50S
   * firmware V2.0.00 while the `10 ff` family answers fine, and guessing further
   * at opcodes was not converging. Seeing which queries reply, and with what,
   * maps out what the firmware actually implements.
   */
  const probe = (label: string, bytes: Uint8Array) =>
    run(label, async () => {
      const reply = await connection.driver.query(bytes, label)
      setReplies((current) => ({
        ...current,
        [label]: reply
          ? `${toHex(reply)}${decodeText(reply) ? `   “${decodeText(reply)}”` : ''}`
          : 'no reply',
      }))
    })

  const parsedRaw = useMemo(() => parseHex(rawHex), [rawHex])

  // Deliberately not a panel when closed. Printing works without any of this now
  // that the sequence matches the vendor app's, so a full-width card with a heading
  // overstated how often it is needed.
  if (!open) {
    return (
      <p className="diagnostics__toggle">
        <button className="linklike" onClick={() => setOpen(true)}>
          Diagnostics
        </button>
        <span className="hint"> &mdash; byte log, density ladder, raw commands</span>
      </p>
    )
  }

  return (
    <section className="panel">
      <div className="row row--between">
        <h2>Diagnostics</h2>
        <button onClick={() => setOpen(false)}>Hide</button>
      </div>

      {!connected && <p className="hint">Connect a printer to use these.</p>}

      {/*
        Two controls that live in the main UI but only make sense to someone
        diagnosing this app, so the main UI does not carry them until asked.
      */}
      <h3 className="subhead">Reveal in the main UI</h3>
      <label className="field field--check">
        <input
          type="checkbox"
          checked={diagnostics.flags.virtualPrinter}
          onChange={(e) => {
            diagnostics.setFlag('virtualPrinter', e.target.checked)
            // Hiding the option while it is the one in use would strand the app
            // on a driver with nothing left to select it back.
            if (!e.target.checked && connection.kind === 'virtual') connection.setKind('ble')
          }}
        />
        <span>Offer the virtual printer</span>
      </label>
      <p className="hint">
        Adds an Output dropdown to the Printer panel. The virtual printer runs the real command
        sequence and the real encoder with no hardware attached, so the preview is byte-for-byte
        what a P50 would receive.
      </p>
      <label className="field field--check" style={{ marginTop: '0.5rem' }}>
        <input
          type="checkbox"
          checked={diagnostics.flags.advancedPrint}
          onChange={(e) => diagnostics.setFlag('advancedPrint', e.target.checked)}
        />
        <span>Show advanced print options</span>
      </label>
      <p className="hint">
        Adds the speed selector and the test-pattern buttons to the Print panel. The capture shows
        the vendor app sends no speed command at all, so that selector may do nothing.
      </p>

      <h3 className="subhead">Printer model</h3>
      <div className="row">
        <label className="field">
          <span style={{ minWidth: '5rem' }}>Force model</span>
          <select
            value={connection.profileOverride ?? ''}
            onChange={(e) => connection.setProfileOverride(e.target.value || null)}
          >
            <option value="">Detect from the printer&rsquo;s name</option>
            {PROFILES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
                {p.support === 'confirmed'
                  ? ''
                  : p.support === 'unverified'
                    ? ' — unverified'
                    : ' — incompatible'}
              </option>
            ))}
          </select>
        </label>
        {connection.capabilities && (
          <span className="hint">
            Connected as <code>{connection.capabilities.profileId}</code>
            {connection.capabilities.profileAssumed && ' (assumed)'}
          </span>
        )}
      </div>
      <p className="hint">
        Normally leave this on Detect. The model is worked out from the advertised Bluetooth name,
        and those prefixes come from reverse engineering rather than a specification — so this
        exists for the case where the guess is wrong. Forcing a model skips the name check, not the
        compatibility one — an incompatible model is still refused, because there is no useful
        experiment in sending a printer commands it certainly ignores. Changing this drops the
        connection.
      </p>

      <details className="advanced">
        <summary>
          Read-only probes
          <span className="advanced__hint">identity and status queries</span>
        </summary>
        <div className="advanced__body">
          <h3 className="subhead">Read-only probes</h3>
          <div className="row">
            {(
              [
                ['Status flags', cmd.getStatusFlags()],
                ['Label height', cmd.getLabelHeight()],
                ['Printer info', cmd.getPrinterInfo()],
                ['Bluetooth name', cmd.getBluetoothName()],
                ['MAC', cmd.getBluetoothMac()],
                ['BT version', cmd.getBluetoothVersion()],
                ['Shutdown time', cmd.getShutdownMinutes()],
                ['Model', cmd.getPrinterModel()],
              ] as Array<[string, Uint8Array]>
            ).map(([label, bytes]) => (
              <button key={label} disabled={!connected || busy} onClick={() => probe(label, bytes)}>
                {label}
              </button>
            ))}
          </div>
          {Object.keys(replies).length > 0 && (
            <pre className="log" style={{ maxHeight: '9rem' }}>
              {Object.entries(replies)
                .map(([label, value]) => `${label.padEnd(16)} ${value}`)
                .join('\n')}
            </pre>
          )}
          <p className="hint">
            All of these only read, and all are from the vendor SDK&rsquo;s{' '}
            <em>archived original</em>. The tidied-up version of that SDK invented a set of{' '}
            <code>1f</code> getters that appear nowhere in the vendor&rsquo;s own code — those were
            what this panel asked for previously, which is why every one came back empty. The{' '}
            <code>10 ff</code> family below is what the vendor actually uses, and the members
            already tried do answer.
          </p>
        </div>
      </details>

      <details className="advanced">
        <summary>
          Label gap
          <span className="advanced__hint">superseded by the automatic gap seek</span>
        </summary>
        <div className="advanced__body">
          <p className="hint">
            <strong>None of this is needed any more.</strong> Every print ends with a sensor gap
            seek, which is how the vendor app registers labels and what keeps successive prints
            aligned. Kept for continuous stock and for stepping the paper by hand.
          </p>
          <h3 className="subhead">Label gap</h3>
          <div className="row">
            <button
              className="primary"
              disabled={!connected || busy}
              onClick={() =>
                run('Calibrate label gap', async () => {
                  const driver = connection.driver
                  if (!(driver instanceof BlePrinterDriver)) {
                    throw new Error('Calibration needs a real printer, not the virtual one.')
                  }
                  const result = await driver.calibrateLabelGap({
                    passes: 3,
                    onPass: (pass, reply) =>
                      setReplies((current) => ({
                        ...current,
                        [`Locate pass ${pass}`]: reply ? toHex(reply) : 'no reply',
                      })),
                  })
                  setReplies((current) => ({
                    ...current,
                    'Label height': result.labelHeightDots
                      ? `${result.labelHeightDots} dots = ${dotsToMm(result.labelHeightDots)} mm`
                      : 'not reported',
                  }))
                })
              }
            >
              Calibrate label gap
            </button>
          </div>

          <div className="row" style={{ marginTop: '0.6rem' }}>
            <label className="field">
              <span style={{ minWidth: '4rem' }}>Feed</span>
              <input
                type="number"
                min={1}
                max={200}
                value={feedMm}
                onChange={(e) => setFeedMm(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
              />
              <em>mm</em>
            </label>
            <button
              className="primary"
              disabled={!connected || busy}
              onClick={() =>
                run(`Feed ${feedMm} mm by printing blank`, () =>
                  connection.driver.print({
                    bitmap: blankLabel(headWidth, DOTS_PER_MM * feedMm),
                    // No gap seek. With one this fed the requested millimetres and
                    // then went looking for the boundary, which is not a feed and
                    // defeats the point of stepping the paper to find it.
                    settings: { ...DEFAULT_PRINT_SETTINGS, seekGap: false },
                  }),
                )
              }
            >
              Feed by printing blank
            </button>
          </div>
          <p className="hint">
            <strong>Feed by printing blank</strong> is the one that works. Every dedicated motion
            command on this firmware is acknowledged and then ignored, but a print job does move
            paper — so an all-white raster of the requested height advances the paper by exactly
            that much and fires no dots. The gap seek is left out of this one, so it advances what
            you ask and no more. Use it to step the paper until the gap sits where you want it, then
            read the millimetres off.
          </p>
          <p className="warn">
            <strong>Calibrate label gap does not work on a P50S.</strong> It runs the vendor
            SDK&rsquo;s own documented sequence — locate three times, then read the height — but
            this firmware ignores the locate command and does not implement the height query, so
            there is nothing to read. Kept only in case another model in the family answers.
          </p>
        </div>
      </details>

      <details className="advanced">
        <summary>
          Commands with no effect on a P50S
          <span className="advanced__hint">tested, inert, kept as a record</span>
        </summary>
        <div className="advanced__body">
          <h3 className="subhead">Commands with no effect on a P50S</h3>
          <div className="row">
            <button
              disabled={!connected || busy}
              onClick={() => sendInJob('Self test', cmd.selfCheck())}
            >
              Self test
            </button>
            <button
              disabled={!connected || busy}
              onClick={() => sendInJob('Learn paper', cmd.learnPaper())}
            >
              Learn paper
            </button>
            <button
              disabled={!connected || busy}
              title="Does nothing here. This same command IS the gap seek, but only after a raster payload — which is where every print now sends it."
              onClick={() => sendInJob('Locate gap', cmd.locate(cmd.LocateMode.Gap))}
            >
              Locate gap
            </button>
            <button
              disabled={!connected || busy}
              onClick={() => send('Paper type: gap', cmd.setPaperType(PaperType.Gap))}
            >
              Set gap labels
            </button>
            <button
              disabled={!connected || busy}
              onClick={() => send('Paper type: continuous', cmd.setPaperType(PaperType.Continuous))}
            >
              Set continuous
            </button>
            <button
              disabled={!connected || busy}
              onClick={() => sendInJob('Feed to end', cmd.alignPaperEnd())}
            >
              Feed
            </button>
          </div>
          <label className="field field--check">
            <input
              type="checkbox"
              checked={wrapInJob}
              onChange={(e) => setWrapInJob(e.target.checked)}
            />
            <span>Wrap maintenance commands in a print job</span>
          </label>
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <button
              disabled={!connected || busy}
              onClick={() => sendInJob('Locate label', cmd.locateLabel())}
            >
              Locate label
            </button>
            <button
              disabled={!connected || busy}
              onClick={() => sendInJob('Learn label gap', cmd.learnLabelGap())}
            >
              Learn gap
            </button>
            <button
              disabled={!connected || busy}
              onClick={() => sendInJob('Feed via ESC J', cmd.feedDotLines(DOTS_PER_MM * feedMm))}
            >
              Feed via ESC J
            </button>
          </div>
          <p className="warn">
            Every command in this group has been tested against a P50S (V2.0.00) and{' '}
            <strong>none of them does anything</strong> — bare or wrapped in a print job. The
            printer acknowledges the write with a credit and ignores it. That includes the ESC/POS
            feed, which is why the gap is crossed by printing blank instead. They are kept because
            they come from the vendor SDK and may be implemented on other models, but nothing here
            should be relied on, and printing needs none of it.
          </p>
        </div>
      </details>

      <details className="advanced">
        <summary>
          Head width
          <span className="advanced__hint">measured at 384 dots; only needed if yours differs</span>
        </summary>
        <div className="advanced__body">
          <h3 className="subhead">Head width</h3>
          <div className="row">
            <button
              className="primary"
              disabled={!connected || busy}
              onClick={() =>
                run('Edge frame', () =>
                  connection.driver.print({
                    bitmap: edgeFrame(headWidth),
                    settings: DEFAULT_PRINT_SETTINGS,
                  }),
                )
              }
            >
              Edge frame
            </button>
            {HEAD_WIDTH_CANDIDATES.map((width) => (
              <button
                key={width}
                disabled={!connected || busy}
                onClick={() =>
                  run(`Ruler strip ${width}`, () =>
                    connection.driver.print({
                      bitmap: rulerStrip(width),
                      settings: DEFAULT_PRINT_SETTINGS,
                    }),
                  )
                }
              >
                Ruler {width}
              </button>
            ))}
          </div>
          <p className="hint">
            <strong>Start with the edge frame.</strong> It draws on the outermost dots of a{' '}
            {headWidth}
            -dot raster, so if all four sides land on the paper the geometry above is right. A
            missing side means the raster is wider than the paper; a margin before a side means it
            is narrower or offset — adjust the width, then the offset, and reprint. The ruler strips
            are for measuring how far out it is: long ticks are 10 mm apart, so {headWidth} dots
            should span exactly {dotsToMm(headWidth)} mm. Nothing reports any of this, so printing
            is the only way to find out.
          </p>
        </div>
      </details>

      <h3 className="subhead">Density</h3>
      <div className="row">
        <button
          disabled={!connected || busy}
          onClick={() =>
            run('Density ladder', async () => {
              // One label per density, in order. Interleaving them on a single
              // label would need density to change mid-job, which the firmware
              // is not documented to support.
              for (const density of DENSITY_LADDER) {
                await connection.driver.print({
                  bitmap: densityPatch(headWidth),
                  settings: { ...DEFAULT_PRINT_SETTINGS, density },
                })
              }
            })
          }
        >
          Print density ladder ({DENSITY_LADDER.length} labels)
        </button>
      </div>
      <p className="hint">
        Prints densities {DENSITY_LADDER.join(', ')} in that order, each a solid half beside a 50%
        checker. Pick the lowest one where the solid is fully black and the checker has not filled
        in.
      </p>

      <h3 className="subhead">Raw command</h3>
      <div className="row">
        <input
          className="mono"
          placeholder="1f 40"
          value={rawHex}
          onChange={(e) => setRawHex(e.target.value)}
          style={{ flex: 1, minWidth: '12rem' }}
        />
        <button
          disabled={!connected || busy || parsedRaw === null || parsedRaw.length === 0}
          onClick={() => parsedRaw && send(`Raw ${toHex(parsedRaw)}`, parsedRaw)}
        >
          Send
        </button>
      </div>
      {rawHex.trim().length > 0 && parsedRaw === null && (
        <p className="error">Not valid hex. Use bytes like &ldquo;1f 40&rdquo;.</p>
      )}
      <p className="warn">
        This sends bytes verbatim. Two documented commands are destructive and deliberately absent
        from the buttons above: <code>1f 50 be</code> resets the printer to factory settings and{' '}
        <code>1f a0 be 66 88</code> drops it into its bootloader, which may need vendor tooling to
        undo.
      </p>

      {note && <p className="hint">{note}</p>}
      {error && <p className="error">{error}</p>}

      <h3 className="subhead">Byte log</h3>
      <div className="row">
        <span className="hint">
          {connection.wireLog.length} entries
          {connection.wireLog.length >= 500 && ' (oldest trimmed)'}
        </span>
        <button onClick={() => void copyLog(connection.wireLog)}>Copy</button>
        <button onClick={() => downloadLog(connection.wireLog, connection.capabilities?.model)}>
          Download
        </button>
        <button onClick={connection.clearWireLog}>Clear</button>
      </div>
      <pre className="log">{formatLog(connection.wireLog.slice(-200))}</pre>
      <p className="hint">
        Every byte in and out. This is the artifact worth keeping if something goes wrong — it is
        the actual wire protocol, which matters because the reply formats in this app are inferred
        rather than documented.
      </p>
    </section>
  )
}

function parseHex(input: string): Uint8Array | null {
  const cleaned = input
    .trim()
    .replace(/0x/gi, '')
    .replace(/[\s,]+/g, ' ')
    .trim()
  if (cleaned.length === 0) return new Uint8Array()
  const parts = cleaned.includes(' ') ? cleaned.split(' ') : (cleaned.match(/.{1,2}/g) ?? [])
  const bytes: number[] = []
  for (const part of parts) {
    if (!/^[0-9a-f]{1,2}$/i.test(part)) return null
    bytes.push(parseInt(part, 16))
  }
  return Uint8Array.from(bytes)
}

function formatLog(entries: WireEntry[]): string {
  if (entries.length === 0) return '(nothing yet)'
  const first = entries[0].at
  return entries
    .map((entry) => {
      const ms = String(entry.at - first).padStart(6, ' ')
      const arrow = entry.dir === 'out' ? '-->' : '<--'
      const note = entry.note ? `  ; ${entry.note}` : ''
      return `${ms}ms ${arrow} ${toHex(entry.bytes) || '(empty)'}${note}`
    })
    .join('\n')
}

async function copyLog(entries: WireEntry[]): Promise<void> {
  try {
    await navigator.clipboard.writeText(formatLog(entries))
  } catch {
    // Clipboard access can be refused; Download is the fallback.
  }
}

function downloadLog(entries: WireEntry[], model?: string): void {
  const header = [
    `# LabelForge wire log`,
    `# model: ${model ?? 'unknown'}`,
    `# entries: ${entries.length}`,
    '',
  ].join('\n')
  const blob = new Blob([header + formatLog(entries)], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'labelforge-wire-log.txt'
  anchor.click()
  URL.revokeObjectURL(url)
}
