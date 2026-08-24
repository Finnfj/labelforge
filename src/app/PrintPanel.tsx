import { useCallback, useEffect, useRef, useState } from 'react'
import {
  photoElementIds,
  withPhotoTone,
  type ImageElement,
  type LabelDoc,
  type ToneChoice,
} from '../model/labelDoc'
import type { PackedBitmap } from '../model/bitmap'
import { DOTS_PER_MM, dotsToMm, mmToDots } from '../model/units'
import { rasterize, type SkippedElement } from '../render/rasterize'
import { LabelTooWideError, headOriginDots } from '../render/padToHead'
import type { PreviewMode } from '../render/preview'
import { checkerboard, rulerStrip, testStrip } from '../printer/diagnostics/testPatterns'
import { MAX_DENSITY, MIN_DENSITY, SEEK_SAFE_JOB_BYTES } from '../printer/protocol/constants'
import { needsFollowUpSeek } from '../printer/protocol/commands'
import { encodeImage } from '../printer/protocol/encodeImage'
import { DEFAULT_PRINT_SETTINGS, type PrintProgress, type PrintSettings } from '../printer/types'
import { resolveAssetUrl } from '../storage/assets'
import { registerStoredFonts } from '../storage/fonts'
import { PaperRoll } from './PaperRoll'
import type { DiagnosticFlags } from './useDiagnosticFlags'
import type { ZoomSetting } from './zoom'
import type { PrinterConnection } from './usePrinter'

/**
 * Name a missing font in a way that says what to do about it.
 *
 * An added font is identified by a hash of its bytes, which is right for
 * matching it across machines and useless to read. Its display name lived in the
 * font record, and if we are reporting it missing that record is exactly what is
 * gone — so say what kind of thing it was instead of showing a bare hash.
 */
function describeFont(family: string): string {
  return family.startsWith('lf-') ? `an added font (${family})` : family
}

/**
 * Ways to make a photograph compress, worst compromise last.
 *
 * A raster over `SEEK_SAFE_JOB_BYTES` is one the printer starts printing before it
 * has read the gap seek at the end of the job, so the label cannot register itself.
 * The only lever on that size is how the photograph is dithered — text and codes
 * threshold to runs that compress to nothing however large the label is.
 *
 * Ordered dithering is the big win, roughly four times smaller, but it is a
 * visibly different picture: a regular grid rather than diffused grain. Reducing
 * the diffusion strength keeps error diffusion and trades detail instead, which is
 * a milder change to look at. So the ladder runs from the mildest change to the
 * largest and the panel offers the first rung that actually fits, rather than
 * jumping straight to the one that always would.
 *
 * Measured on a 384 x 640 photograph: 23.1 KB at full strength, 18.9 at 60%,
 * 15.3 at 40%, 6.4 ordered. Contrast is not on the list — lifting it to +80 saves
 * 14%, nowhere near enough to matter.
 */
const TONE_LADDER: Array<{ label: string; describe: string; tone: ToneChoice }> = [
  {
    label: 'Soften the dithering to 60%',
    describe: 'less error diffused, so a little less fine detail',
    tone: { ditherStrength: 0.6 },
  },
  {
    label: 'Soften the dithering to 40%',
    describe: 'noticeably flatter, still error diffusion rather than a grid',
    tone: { ditherStrength: 0.4 },
  },
  {
    label: 'Switch to ordered dithering',
    describe: 'a regular grid — coarser, and it survives thermal bleed better',
    tone: { dither: 'bayer' },
  },
]

export function PrintPanel({
  doc,
  connection,
  flags,
  updateElement,
}: {
  doc: LabelDoc
  connection: PrinterConnection
  flags: DiagnosticFlags
  /** So the size warning can offer the one change that resolves it. */
  updateElement(id: string, patch: Partial<ImageElement>): void
}) {
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
  const [jobBytes, setJobBytes] = useState(0)
  const [remedy, setRemedy] = useState<{
    rung: (typeof TONE_LADDER)[number]
    bytes: number
  } | null>(null)
  const [skipped, setSkipped] = useState<SkippedElement[]>([])
  const [fontFallbacks, setFontFallbacks] = useState<string[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
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
    // Nothing consumed these before, so the driver's one way of saying "that
    // label may be incomplete" went nowhere. A truncated print that says nothing
    // is worse than one that does.
    const offLog = printer.on('log', (l) => {
      if (l.level === 'warn' || l.level === 'error') {
        setWarnings((current) => (current.includes(l.message) ? current : [...current, l.message]))
      }
    })
    return () => {
      offProgress()
      offWire()
      offLog()
    }
  }, [printer])

  // Live preview of exactly what would be sent. Debounced so typing in a text
  // field does not rasterise the whole label on every keystroke.
  useEffect(() => {
    let cancelled = false
    const id = setTimeout(() => {
      void (async () => {
        try {
          // Idempotent and cheap once warm. Awaited here rather than trusted to
          // the startup registration because this is the raster that gets
          // printed, and losing that race would send the wrong typeface.
          await registerStoredFonts()
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
          // Whether the printer can seek this job itself turns on the compressed
          // size, and there is no estimating that — a dithered photograph barely
          // compresses while flat artwork collapses to nothing. Encoding is a
          // millisecond here and the preview is already debounced.
          setJobBytes(encodeImage(result.bitmap).length)
          setLabelWidthDots(result.labelWidthDots)
          setClipped(result.clipped)
          setSkipped(result.skipped)
          setFontFallbacks(result.fontFallbacks)
          setError(null)
        } catch (e) {
          if (cancelled) return
          // Discard the previous raster. Keeping it meant the preview showed, and
          // the button would happily send, a bitmap that no longer matched the
          // document — a label printed with the QR payload you had just replaced.
          // No bitmap disables printing, which is the correct answer here.
          setBitmap(null)
          setJobBytes(0)
          setSkipped([])
          setFontFallbacks([])
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

  // The mildest rung of the tone ladder that would take this label under the size
  // the printer reads in full. Asked only when the answer could matter — it is a
  // full rasterise per rung, and there is no estimating it, because how well a
  // dither compresses depends entirely on the picture. Stops at the first that
  // fits, so it is usually one or two.
  const photoIds = photoElementIds(doc)
  const wantsTrial = needsFollowUpSeek(jobBytes) && photoIds.length > 0
  useEffect(() => {
    if (!wantsTrial) {
      setRemedy(null)
      return
    }
    let cancelled = false
    void (async () => {
      const options = {
        headWidthDots: padToHead ? headWidth : undefined,
        maxWidthDots: headWidth,
        align,
        offsetDots,
        resolveAsset: resolveAssetUrl,
        clipToHead: true,
        feedAfterDots,
      }
      let best: { rung: (typeof TONE_LADDER)[number]; bytes: number } | null = null
      for (const rung of TONE_LADDER) {
        if (cancelled) return
        try {
          const result = await rasterize(withPhotoTone(doc, rung.tone), options)
          best = { rung, bytes: encodeImage(result.bitmap).length }
          if (!needsFollowUpSeek(best.bytes)) break
        } catch {
          // The real raster already succeeded, so a failure here says nothing to
          // the user. No advice beats wrong advice.
          if (!cancelled) setRemedy(null)
          return
        }
      }
      if (!cancelled) setRemedy(best)
    })()
    return () => {
      cancelled = true
    }
  }, [wantsTrial, doc, padToHead, headWidth, align, offsetDots, feedAfterDots])

  /** True when the ladder found a rung that actually fits. */
  const remedyFits = remedy != null && !needsFollowUpSeek(remedy.bytes)

  const send = useCallback(
    async (target: PackedBitmap) => {
      setError(null)
      setWireBytes(0)
      setWarnings([])
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

      {needsFollowUpSeek(jobBytes) && (
        <div className={remedyFits || feedAfterDots > 0 ? 'hint' : 'warn'}>
          <p>
            This label is {(jobBytes / 1024).toFixed(1)} KB, which is more than the printer reads
            before it starts printing &mdash; so the gap seek at the end of the job goes unread and
            it will not find the next label on its own. Confirmed on hardware: left to itself, every
            print of a label this size starts a gap-width earlier than the last.
          </p>

          <label className="field field--check">
            <input
              type="checkbox"
              checked={settings.splitForSeek === true}
              onChange={(e) => setSettings((s) => ({ ...s, splitForSeek: e.target.checked }))}
            />
            <span>Split the print so the last part can seek</span>
          </label>
          <p>
            <strong>Splitting costs nothing in the picture</strong>, which is why it is first, and
            it is confirmed on hardware: the label registers and no paper is wasted. The raster goes
            out as a few consecutive jobs, each small enough for the printer to read whole and only
            the last one seeking, pausing between them because the printer will not take a new job
            while it is working.
            <br />
            The printer takes up 1 mm when a job starts, which showed as a white seam at each
            boundary. Each band after the first now winds back 5 mm and prints 4 mm of blank to come
            forward again, landing exactly where the last one stopped &mdash; 1 mm on its own is
            below the smallest movement the printer will make. If a seam is still visible, one of
            the two below avoids the question entirely.
          </p>

          {remedyFits && (
            <p>
              Otherwise, <strong>{remedy!.rung.label.toLowerCase()}</strong> and the printer handles
              the rest by itself. The same label comes to {(remedy!.bytes / 1024).toFixed(1)} KB
              that way &mdash; under the {SEEK_SAFE_JOB_BYTES / 1024} KB the printer reads in full
              &mdash; so it registers itself, print after print, with nothing below needed at all.
              The cost is {remedy!.rung.describe}. This is the mildest change on the list that fits:
              the picture is the only thing on a label whose size is a choice, since text and codes
              compress to almost nothing however large it is.{' '}
              <button
                className="linklike"
                onClick={() => photoIds.forEach((id) => updateElement(id, remedy!.rung.tone))}
              >
                Apply to {photoIds.length === 1 ? 'the photo' : 'the photos'}
              </button>
            </p>
          )}
          {remedy != null && !remedyFits && (
            <p>
              Nothing on the list gets it under the line &mdash; even ordered dithering leaves{' '}
              {(remedy.bytes / 1024).toFixed(1)} KB against the {SEEK_SAFE_JOB_BYTES / 1024} KB the
              printer reads in full. This picture has too much fine detail to compress. One of the
              two below, then.
            </p>
          )}

          <div className="row">
            <label className="field field--check">
              <input
                type="checkbox"
                checked={settings.followUpSeek === true}
                onChange={(e) => setSettings((s) => ({ ...s, followUpSeek: e.target.checked }))}
              />
              <span>Register the roll after this print</span>
            </label>
            <label className="field">
              <span style={{ minWidth: '5.5rem' }}>Gap feed</span>
              <input
                type="number"
                min={0}
                step={1}
                value={feedAfterDots / DOTS_PER_MM}
                onChange={(e) =>
                  connection.setGeometry({
                    feedAfterDots: Math.max(
                      0,
                      Math.round((Number(e.target.value) || 0) * DOTS_PER_MM),
                    ),
                  })
                }
              />
              <em>mm</em>
            </label>
          </div>
          <p>
            <strong>Register</strong> sends a second, tiny job carrying the seek, small enough for
            the printer to read whole. It used to walk the paper out to the tear-off position and
            back before seeking, which cost a blank label; it no longer does.
            <br />
            <strong>Gap feed</strong> is the fallback that needs no sensor: blank rows advance the
            paper by exactly as many as you send. It means measuring your stock, which is why it is
            last here rather than first.
          </p>
        </div>
      )}

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

      {!connected && <p className="hint">Connect a printer above to enable printing.</p>}

      {error && <p className="error">{error}</p>}
      {warnings.map((message) => (
        <p className="warn" key={message}>
          {message}
        </p>
      ))}
      {skipped.length > 0 && (
        <p className="warn">
          Left off this label because {skipped.length === 1 ? 'it' : 'they'} could not be rendered:
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
      {fontFallbacks.length > 0 && (
        <p className="warn">
          Not available on this machine, so the label prints in a substitute typeface:{' '}
          {fontFallbacks.map(describeFont).join(', ')}. The preview above is already showing that
          substitute &mdash; the spacing and line breaks are what you would actually get.
        </p>
      )}
      {clipped && (
        <p className="warn">
          This label is {dotsToMm(labelWidthDots)} mm wide but the print head is only{' '}
          {dotsToMm(headWidth)} mm, so anything past that edge is cut off. 384 dots was measured
          with the edge-frame pattern and agrees with the vendor SDK; if your unit differs, the head
          width is under Advanced in the Printer panel.
        </p>
      )}

      <div className="row row--between">
        <h3 className="subhead">Preview</h3>
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
      {/*
          Speed and the test patterns sit here because the capture showed what they
          are worth. The vendor app never sends a speed command at all, so ours may
          be doing nothing — speed could be one of the six unidentified bytes in
          `setPrintParams`. The patterns existed to measure head width and placement
          by trial, which the capture answered outright.
        */}
      {flags.advancedPrint && (
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
                  value={settings.speed ?? 'off'}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      speed:
                        e.target.value === 'off'
                          ? undefined
                          : (Number(e.target.value) as 0 | 1 | 2),
                    }))
                  }
                >
                  <option value="off">Don&rsquo;t send</option>
                  <option value={0}>Low</option>
                  <option value={1}>Medium</option>
                  <option value={2}>High</option>
                </select>
              </label>
              <span className="hint">
                &ldquo;Don&rsquo;t send&rdquo; is the default, and makes a print byte-for-byte the
                captured vendor sequence. The vendor app issues no speed command at all, and this
                one comes from a part of the SDK whose other commands turned out not to exist.
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
      )}
    </section>
  )
}
