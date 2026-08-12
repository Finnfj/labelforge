import { useCallback, useEffect, useRef, useState } from 'react'
import type { LabelDoc } from '../model/labelDoc'
import type { PackedBitmap } from '../model/bitmap'
import { dotsToMm, mmToDots } from '../model/units'
import { rasterize, type SkippedElement } from '../render/rasterize'
import { LabelTooWideError, headOriginDots } from '../render/padToHead'
import type { PreviewMode } from '../render/preview'
import { checkerboard, rulerStrip, testStrip } from '../printer/diagnostics/testPatterns'
import { MAX_DENSITY, MIN_DENSITY } from '../printer/protocol/constants'
import { DEFAULT_PRINT_SETTINGS, type PrintProgress, type PrintSettings } from '../printer/types'
import { resolveAssetUrl } from '../storage/assets'
import { PaperRoll } from './PaperRoll'
import type { ZoomSetting } from './zoom'
import type { PrinterConnection } from './usePrinter'

export function PrintPanel({ doc, connection }: { doc: LabelDoc; connection: PrinterConnection }) {
  const printer = connection.driver

  const [settings, setSettings] = useState<PrintSettings>(DEFAULT_PRINT_SETTINGS)
  const [bitmap, setBitmap] = useState<PackedBitmap | null>(null)
  const [labelWidthDots, setLabelWidthDots] = useState(mmToDots(doc.size.widthMm))
  const [progress, setProgress] = useState<PrintProgress | null>(null)
  const [wireBytes, setWireBytes] = useState(0)
  const [mode, setMode] = useState<PreviewMode>('crisp')
  // Fit by default: it picks the largest whole-dot scale the panel can hold, so
  // the preview is as large as possible without ever needing to scroll sideways.
  const [zoom, setZoom] = useState<ZoomSetting>('fit')
  const [showHeadArea, setShowHeadArea] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clipped, setClipped] = useState(false)
  const [skipped, setSkipped] = useState<SkippedElement[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const {
    headWidthDots: headWidth,
    padToHead,
    align,
    offsetDots,
    feedAfterDots,
  } = connection.geometry

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
            // Omitting the head width is what stops the raster being padded, which
            // is how the vendor app sends it. The head width is still needed as a
            // limit, so it goes in either way via maxWidthDots.
            headWidthDots: padToHead ? headWidth : undefined,
            maxWidthDots: headWidth,
            align,
            offsetDots,
            resolveAsset: resolveAssetUrl,
            clipToHead: true,
            feedAfterDots,
          })
          if (cancelled) return
          setBitmap(result.bitmap)
          setLabelWidthDots(result.labelWidthDots)
          setClipped(result.clipped)
          setSkipped(result.skipped)
          setError(null)
        } catch (e) {
          if (cancelled) return
          // Discard the previous raster. Keeping it meant the preview showed, and
          // the button would happily send, a bitmap that no longer matched the
          // document — a label printed with the QR payload you had just replaced.
          // No bitmap disables printing, which is the correct answer here.
          setBitmap(null)
          setSkipped([])
          setError(
            e instanceof LabelTooWideError
              ? `${e.message} Choose a narrower roll — a P50S head is 384 dots, or 48 mm.`
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
  }, [doc, headWidth, padToHead, align, offsetDots, feedAfterDots])

  const send = useCallback(
    async (target: PackedBitmap) => {
      setError(null)
      setWireBytes(0)
      try {
        if (!printer.capabilities) {
          throw new Error('Connect a printer first.')
        }
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
      const pattern = build(headWidth)
      setBitmap(pattern)
      setLabelWidthDots(pattern.widthDots)
      await send(pattern)
    },
    [headWidth, send],
  )

  const printing = progress != null && progress.phase !== 'done'
  const connected = connection.capabilities != null

  // Where the paper sits within the raster. Test patterns are built at head
  // width and are not padded, so for those the label is the whole raster.
  const rasterIsHeadWidth = (bitmap?.widthDots ?? 0) > labelWidthDots
  const labelStart = rasterIsHeadWidth
    ? headOriginDots(labelWidthDots, bitmap!.widthDots, align, offsetDots)
    : 0
  const labelSpan = rasterIsHeadWidth ? labelWidthDots : (bitmap?.widthDots ?? 0)

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
            disabled={printing || !bitmap || !connected}
            onClick={() => bitmap && send(bitmap)}
          >
            Print label
          </button>
          {printing && (
            <button className="danger" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          )}
        </div>

        <p className="hint" style={{ marginTop: '0.6rem' }}>
          {connection.kind === 'virtual'
            ? 'Output goes to a virtual printer — no hardware required. The bitmap below is byte-for-byte what a real P50 would receive.'
            : 'Output goes to the connected printer. The bitmap below is exactly what it receives.'}
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

        {/*
          Speed and the test patterns sit here because the capture showed what they
          are worth. The vendor app never sends a speed command at all, so ours may
          be doing nothing — speed could be one of the six unidentified bytes in
          `setPrintParams`. The patterns existed to measure head width and placement
          by trial, which the capture answered outright.
        */}
        <details className="advanced">
          <summary>
            Advanced
            <span className="advanced__hint">speed and test patterns</span>
          </summary>
          <div className="advanced__body">
            <div className="row">
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
              <span className="hint">
                The vendor app sends no speed command, so this may have no effect.
              </span>
            </div>

            <div className="row" style={{ marginTop: '0.6rem' }}>
              <button
                disabled={printing || !connected}
                onClick={() => printPattern((h) => testStrip(h))}
              >
                Test strip
              </button>
              <button
                disabled={printing || !connected}
                title="Millimetre-numbered rulers. Used to measure head width before the capture settled it at 384 dots."
                onClick={() => printPattern((h) => rulerStrip(h))}
              >
                Ruler strip
              </button>
              <button
                disabled={printing || !connected}
                onClick={() => printPattern((h) => checkerboard(h, 96))}
              >
                Checkerboard
              </button>
            </div>
            <p className="hint">
              Each of these prints at full head width, so they ignore the label size and
              deliberately overrun narrow stock.
            </p>
          </div>
        </details>

        {!connected && <p className="hint">Connect a printer above to enable printing.</p>}

        {error && <p className="error">{error}</p>}
        {skipped.length > 0 && (
          <p className="warn">
            Left off this label because {skipped.length === 1 ? 'it' : 'they'} could not be
            rendered:
            <br />
            {skipped.map((s) => (
              <span key={s.id}>
                &bull; {s.kind} &mdash; {s.reason}
                <br />
              </span>
            ))}
            The preview shows what would actually print, so fix these before sending it.
          </p>
        )}
        {clipped && (
          <p className="warn">
            This label is {dotsToMm(labelWidthDots)} mm wide but the print head is only{' '}
            {dotsToMm(headWidth)} mm, so anything past that edge is cut off. 384 dots was measured
            with the edge-frame pattern and agrees with the vendor SDK; if your unit differs, the
            head width is under Advanced in the Printer panel.
          </p>
        )}
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
                onChange={(e) => {
                  const next = e.target.value
                  setZoom(next === 'fit' || next === 'actual' ? next : (Number(next) as 1 | 2 | 4))
                }}
              >
                <option value="fit">Fit</option>
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
          labelStartDots={labelStart}
          labelWidthDots={labelSpan}
          viewOriginDots={showHeadArea ? 0 : labelStart}
          viewWidthDots={showHeadArea ? bitmap?.widthDots : labelSpan}
        />
        <label className="field field--check" style={{ marginTop: '0.6rem' }}>
          <input
            type="checkbox"
            checked={showHeadArea}
            onChange={(e) => setShowHeadArea(e.target.checked)}
          />
          <span>Show full print head area</span>
        </label>
        <p className="hint">
          {labelWidthDots} of {headWidth} dots used ({dotsToMm(headWidth)} mm head).
          {showHeadArea && ' Tinted area is under the head but off the edge of the stock.'}
        </p>
      </section>
    </>
  )
}
