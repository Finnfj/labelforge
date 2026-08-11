import { useMemo, useState } from 'react'
import { dotsToMm } from '../model/units'
import * as cmd from '../printer/protocol/commands'
import { PaperType } from '../printer/protocol/constants'
import { densityPatch, rulerStrip } from '../printer/diagnostics/testPatterns'
import { DEFAULT_PRINT_SETTINGS } from '../printer/types'
import { decodeText, toHex } from '../printer/protocol/responses'
import type { PrinterConnection, WireEntry } from './usePrinter'

/** Densities to walk when finding a good darkness. One label each. */
const DENSITY_LADDER = [3, 6, 9, 12, 15]

/** Candidate head widths for the ruler probe. */
const HEAD_WIDTH_CANDIDATES = [320, 384, 400, 576]

export function DiagnosticsPanel({ connection }: { connection: PrinterConnection }) {
  const [open, setOpen] = useState(false)
  const [rawHex, setRawHex] = useState('')
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
   * On a real P50S, self test, learn paper and locate did nothing at all when
   * sent bare, while the very same motion command (`1f 11 50`) worked reliably
   * inside a print. Every command observed to take effect was bracketed by
   * `startPrintJob`/`stopPrintJob`, so the firmware appears to act only within a
   * job. Wrapping is therefore the default; the toggle exists to re-test that.
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

  if (!open) {
    return (
      <section className="panel">
        <div className="row row--between">
          <h2>Diagnostics</h2>
          <button onClick={() => setOpen(true)}>Open diagnostics</button>
        </div>
        <p className="hint">
          Byte log, calibration, density ladder and a raw command box. Worth having open the
          first time you connect a printer.
        </p>
      </section>
    )
  }

  return (
    <section className="panel">
      <div className="row row--between">
        <h2>Diagnostics</h2>
        <button onClick={() => setOpen(false)}>Hide</button>
      </div>

      {!connected && <p className="hint">Connect a printer to use these.</p>}

      <h3 className="subhead">Read-only probes</h3>
      <div className="row">
        {(
          [
            ['Paper type', cmd.getPaperType()],
            ['Density', cmd.getDensity()],
            ['Speed', cmd.getSpeed()],
            ['Status', cmd.printerStatus()],
            ['Temperature', cmd.getSensor(cmd.Sensor.Temperature)],
            ['Voltage', cmd.getSensor(cmd.Sensor.Voltage)],
            ['Gap sensor', cmd.getSensor(cmd.Sensor.Opto)],
            ['Shutdown time', cmd.getShutdownMinutes()],
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
        All of these only read. They are here to find out what the firmware actually
        implements: on a P50S the <code>10 ff</code> queries answer, while several
        <code>1f</code> commands are silent. A reply from &ldquo;Density&rdquo; would also
        confirm that setting density takes effect at all, and &ldquo;Gap sensor&rdquo; is the
        raw material for calibrating label detection.
      </p>

      <h3 className="subhead">Paper and calibration</h3>
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
      <p className="warn">
        On a P50S (firmware V2.0.00) <strong>none of these four has any observed
        effect</strong>, bare or wrapped in a print job — the printer acknowledges the write
        and does nothing. They are kept because they come from the vendor SDK and may work on
        other models in the family, but do not rely on them. Printing itself does not need
        them. The job wrapper is left as a toggle so the assumption can be re-tested.
      </p>

      <h3 className="subhead">Head width</h3>
      <div className="row">
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
        Print one and measure it. The long ticks are 10 mm apart, so {headWidth} dots should
        span exactly {dotsToMm(headWidth)} mm. If the right-hand edge column is missing the
        head is narrower than that; if the block at the left is clipped, the origin is offset.
        Nothing reports head width, so measuring is the only way to know it.
      </p>

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
        Prints densities {DENSITY_LADDER.join(', ')} in that order, each a solid half beside a
        50% checker. Pick the lowest one where the solid is fully black and the checker has
        not filled in.
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
        This sends bytes verbatim. Two documented commands are destructive and deliberately
        absent from the buttons above: <code>1f 50 be</code> resets the printer to factory
        settings and <code>1f a0 be 66 88</code> drops it into its bootloader, which may need
        vendor tooling to undo.
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
        Every byte in and out. This is the artifact worth keeping if something goes wrong — it
        is the actual wire protocol, which matters because the reply formats in this app are
        inferred rather than documented.
      </p>
    </section>
  )
}

function parseHex(input: string): Uint8Array | null {
  const cleaned = input.trim().replace(/0x/gi, '').replace(/[\s,]+/g, ' ').trim()
  if (cleaned.length === 0) return new Uint8Array()
  const parts = cleaned.includes(' ') ? cleaned.split(' ') : cleaned.match(/.{1,2}/g) ?? []
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
