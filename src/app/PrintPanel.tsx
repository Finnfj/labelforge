import { useCallback, useEffect, useRef, useState } from 'react'
import type { LabelDoc } from '../model/labelDoc'
import type { PackedBitmap } from '../model/bitmap'
import { DEFAULT_HEAD_WIDTH_DOTS, dotsToMm, mmToDots } from '../model/units'
import { rasterize } from '../render/rasterize'
import { LabelTooWideError } from '../render/padToHead'
import type { PreviewMode } from '../render/preview'
import { VirtualPrinterDriver } from '../printer/drivers/VirtualPrinterDriver'
import { checkerboard, rulerStrip, testStrip } from '../printer/diagnostics/testPatterns'
import { MAX_DENSITY, MIN_DENSITY } from '../printer/protocol/constants'
import { DEFAULT_PRINT_SETTINGS, type PrintProgress, type PrintSettings } from '../printer/types'
import { resolveAssetUrl } from '../storage/assets'
import { PaperRoll } from './PaperRoll'
import type { ZoomSetting } from './zoom'

export function PrintPanel({ doc }: { doc: LabelDoc }) {
  const printerRef = useRef<VirtualPrinterDriver | null>(null)
  if (!printerRef.current) printerRef.current = new VirtualPrinterDriver()
  const printer = printerRef.current

  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS)
  const [bitmap, setBitmap] = useState<PackedBitmap | null>(null)
  const [labelWidthDots, setLabelWidthDots] = useState(mmToDots(doc.size.widthMm))
  const [progress, setProgress] = useState<PrintProgress | null>(null)
  const [wireBytes, setWireBytes] = useState(0)
  const [mode, setMode] = useState<PreviewMode>('crisp')
  // 2x by default so the preview reads at roughly the same size as the editor
  // canvas; at 1x a 203 dpi label is tiny on a 96 dpi screen and every label
  // looks coarser than it really is.
  const [zoom, setZoom] = useState<ZoomSetting>(2)
  const [showHeadArea, setShowHeadArea] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const headWidth = printer.capabilities?.headWidthDots ?? DEFAULT_HEAD_WIDTH_DOTS

  useEffect(() => {
    const offProgress = printer.on('progress', setProgress)
    const offWire = printer.on('wire', (w) => setWireBytes((n) => n + w.bytes.length))
    return () => {
      offProgress()
      offWire()
    }
  }, [printer])

  // Live preview of exactly what would be sent. Debounced so typing in a text
  // field does not rasterise the whole label on every keystroke.
  useEffect(() => {
    let cancelled = false
    const id = setTimeout(() => {
      void (async () => {
        try {
          const result = await rasterize(doc, {
            headWidthDots: headWidth,
            align: 'left',
            resolveAsset: resolveAssetUrl,
          })
          if (cancelled) return
          setBitmap(result.bitmap)
          setLabelWidthDots(result.labelWidthDots)
          setError(null)
        } catch (e) {
          if (cancelled) return
          setError(
            e instanceof LabelTooWideError
              ? `${e.message} Choose a narrower roll, or measure the real head width with the ruler strip.`
              : e instanceof Error
                ? e.message
                : String(e),
          )
        }
      })()
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [doc, headWidth])

  const send = useCallback(
    async (target: PackedBitmap) => {
      setError(null)
      setWireBytes(0)
      try {
        if (!printer.capabilities) await printer.connect()
        abortRef.current = new AbortController()
        await printer.print({ bitmap: target, settings }, { signal: abortRef.current.signal })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        abortRef.current = null
      }
    },
    [printer, settings],
  )

  const printPattern = useCallback(
    async (build: (head: number) => PackedBitmap) => {
      if (!printer.capabilities) await printer.connect()
      const head = printer.capabilities?.headWidthDots ?? DEFAULT_HEAD_WIDTH_DOTS
      const pattern = build(head)
      setBitmap(pattern)
      setLabelWidthDots(pattern.widthDots)
      await send(pattern)
    },
    [printer, send],
  )

  const printing = progress != null && progress.phase !== 'done'

  return (
    <>
      <section className="panel">
        <h2>Print</h2>
        <div className="row">
          <label className="field">
            <span>Density</span>
            <input
              type="range"
              min={MIN_DENSITY}
              max={MAX_DENSITY}
              value={settings.density}
              onChange={(e) => setSettings((s) => ({ ...s, density: Number(e.target.value) }))}
            />
            <em>{settings.density}</em>
          </label>
          <label className="field">
            <span>Speed</span>
            <select
              value={settings.speed}
              onChange={(e) =>
                setSettings((s) => ({ ...s, speed: Number(e.target.value) as 0 | 1 | 2 }))
              }
            >
              <option value={0}>Low</option>
              <option value={1}>Medium</option>
              <option value={2}>High</option>
            </select>
          </label>
          <label className="field">
            <span>Copies</span>
            <input
              type="number"
              min={1}
              max={99}
              value={settings.copies}
              onChange={(e) =>
                setSettings((s) => ({ ...s, copies: Math.max(1, Number(e.target.value)) }))
              }
            />
          </label>
        </div>

        <div className="row" style={{ marginTop: '0.75rem' }}>
          <button
            className="primary"
            disabled={printing || !bitmap}
            onClick={() => bitmap && send(bitmap)}
          >
            Print label
          </button>
          <button disabled={printing} onClick={() => printPattern((h) => testStrip(h))}>
            Test strip
          </button>
          <button disabled={printing} onClick={() => printPattern((h) => rulerStrip(h))}>
            Ruler strip
          </button>
          <button disabled={printing} onClick={() => printPattern((h) => checkerboard(h, 96))}>
            Checkerboard
          </button>
          {printing && (
            <button className="danger" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          )}
        </div>

        <p className="hint" style={{ marginTop: '0.6rem' }}>
          Output goes to a <strong>virtual printer</strong> — no hardware is required. The
          bitmap below is byte-for-byte what a real P50 would receive.
        </p>

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
              {progress.phase} — copy {progress.copy}/{progress.copies}, {progress.sent}/
              {progress.total} bytes encoded, {wireBytes} bytes on the wire
            </span>
          </div>
        )}

        {error && <p className="error">{error}</p>}
      </section>

      <section className="panel">
        <div className="row row--between">
          <h2>Paper</h2>
          <div className="row">
            <label className="field">
              <span>View</span>
              <select value={mode} onChange={(e) => setMode(e.target.value as PreviewMode)}>
                <option value="crisp">Crisp dots</option>
                <option value="thermal">Thermal simulation</option>
              </select>
            </label>
            <label className="field">
              <span>Zoom</span>
              <select
                value={String(zoom)}
                onChange={(e) =>
                  setZoom(
                    e.target.value === 'actual'
                      ? 'actual'
                      : (Number(e.target.value) as 1 | 2 | 4),
                  )
                }
              >
                <option value="actual">True size</option>
                <option value="1">1&times;</option>
                <option value="2">2&times;</option>
                <option value="4">4&times;</option>
              </select>
            </label>
          </div>
        </div>
        <PaperRoll
          bitmap={bitmap}
          mode={mode}
          zoom={zoom}
          labelWidthDots={labelWidthDots}
          viewWidthDots={showHeadArea ? bitmap?.widthDots : labelWidthDots}
        />
        <label className="field" style={{ marginTop: '0.6rem' }}>
          <input
            type="checkbox"
            checked={showHeadArea}
            onChange={(e) => setShowHeadArea(e.target.checked)}
          />
          <span style={{ minWidth: 0 }}>Show full print head area</span>
        </label>
        <p className="hint">
          {labelWidthDots} of {headWidth} dots used ({dotsToMm(headWidth)} mm head).
          {showHeadArea && ' Tinted area is under the head but off the edge of the stock.'}
        </p>
      </section>
    </>
  )
}
