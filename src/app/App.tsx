import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_HEAD_WIDTH_DOTS, dotsToMm, mmToDots } from '../model/units'
import type { PackedBitmap } from '../model/bitmap'
import { padToHead } from '../render/padToHead'
import type { PreviewMode } from '../render/preview'
import { VirtualPrinterDriver } from '../printer/drivers/VirtualPrinterDriver'
import { checkerboard, rulerStrip, testStrip } from '../printer/diagnostics/testPatterns'
import { DEFAULT_PRINT_SETTINGS, type PrintProgress } from '../printer/types'
import { PaperRoll, type ZoomSetting } from './PaperRoll'

/** Roll widths the P50 family takes. The head is wider than most of them. */
const WIDTH_PRESETS_MM = [12, 25, 40, 50] as const

export default function App() {
  const printer = useMemo(() => new VirtualPrinterDriver(), [])
  const [connected, setConnected] = useState(false)
  const [progress, setProgress] = useState<PrintProgress | null>(null)
  const [lastBitmap, setLastBitmap] = useState<PackedBitmap | null>(null)
  const [wireBytes, setWireBytes] = useState(0)
  const [mode, setMode] = useState<PreviewMode>('crisp')
  const [zoom, setZoom] = useState<ZoomSetting>(1)
  const [labelWidthMm, setLabelWidthMm] = useState<number>(40)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const headWidth = printer.capabilities?.headWidthDots ?? DEFAULT_HEAD_WIDTH_DOTS
  const labelWidthDots = Math.min(mmToDots(labelWidthMm), headWidth)

  useEffect(() => {
    const offState = printer.on('state', (s) => setConnected(s !== 'disconnected'))
    const offProgress = printer.on('progress', setProgress)
    const offWire = printer.on('wire', (w) => setWireBytes((n) => n + w.bytes.length))
    return () => {
      offState()
      offProgress()
      offWire()
    }
  }, [printer])

  const run = useCallback(
    async (build: (headWidthDots: number) => PackedBitmap) => {
      setError(null)
      try {
        if (!printer.capabilities) await printer.connect()
        const head = printer.capabilities?.headWidthDots ?? DEFAULT_HEAD_WIDTH_DOTS
        const bitmap = build(head)
        setLastBitmap(bitmap)
        setWireBytes(0)
        abortRef.current = new AbortController()
        await printer.print(
          { bitmap, settings: DEFAULT_PRINT_SETTINGS },
          { signal: abortRef.current.signal },
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        abortRef.current = null
      }
    },
    [printer],
  )

  const printing = progress != null && progress.phase !== 'done'

  return (
    <main className="app">
      <header className="app__header">
        <h1>LabelForge</h1>
        <p className="app__sub">
          MarkLife P50 label printer, driven from the browser. Currently printing to a{' '}
          <strong>virtual printer</strong> — the bitmap below is exactly the buffer a real
          P50 would receive.
        </p>
      </header>

      <section className="panel">
        <h2>Label</h2>
        <div className="row">
          <label>
            Roll width
            <select
              value={labelWidthMm}
              onChange={(e) => setLabelWidthMm(Number(e.target.value))}
            >
              {WIDTH_PRESETS_MM.map((mm) => (
                <option key={mm} value={mm}>
                  {mm} mm
                </option>
              ))}
            </select>
          </label>
          <span className="hint">
            {labelWidthDots} dots of a {headWidth}-dot head ({dotsToMm(headWidth)} mm)
          </span>
        </div>
      </section>

      <section className="panel">
        <h2>Test prints</h2>
        <div className="row">
          <button
            disabled={printing}
            onClick={() =>
              run((head) => padToHead(testStrip(labelWidthDots, 120), head, 'left'))
            }
          >
            Test strip
          </button>
          <button disabled={printing} onClick={() => run((head) => rulerStrip(head))}>
            Ruler strip
          </button>
          <button
            disabled={printing}
            onClick={() =>
              run((head) => padToHead(checkerboard(labelWidthDots, 96), head, 'left'))
            }
          >
            Checkerboard
          </button>
          {printing && (
            <button className="danger" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          )}
        </div>

        {progress && (
          <div className="progress">
            <div className="progress__bar">
              <div
                className="progress__fill"
                style={{
                  width: `${progress.total ? (progress.sent / progress.total) * 100 : 0}%`,
                }}
              />
            </div>
            <span className="hint">
              {progress.phase} — {progress.sent}/{progress.total} bytes, {wireBytes} bytes on
              the wire
            </span>
          </div>
        )}

        {error && <p className="error">{error}</p>}
        {!connected && <p className="hint">Virtual printer connects on first print.</p>}
      </section>

      <section className="panel">
        <div className="row row--between">
          <h2>Paper</h2>
          <div className="row">
            <label>
              View
              <select value={mode} onChange={(e) => setMode(e.target.value as PreviewMode)}>
                <option value="crisp">Crisp dots</option>
                <option value="thermal">Thermal simulation</option>
              </select>
            </label>
            <label>
              Zoom
              <select
                value={String(zoom)}
                onChange={(e) =>
                  setZoom(e.target.value === 'actual' ? 'actual' : (Number(e.target.value) as 1 | 2 | 4))
                }
              >
                <option value="actual">True physical size</option>
                <option value="1">1&times;</option>
                <option value="2">2&times;</option>
                <option value="4">4&times;</option>
              </select>
            </label>
          </div>
        </div>
        <PaperRoll
          bitmap={lastBitmap}
          mode={mode}
          zoom={zoom}
          labelWidthDots={lastBitmap?.widthDots === headWidth ? labelWidthDots : undefined}
        />
        <p className="hint">
          Tinted area is under the head but off the edge of the label stock.
        </p>
      </section>
    </main>
  )
}
