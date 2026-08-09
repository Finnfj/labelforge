import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PackedBitmap } from '../model/bitmap'
import { toPreviewImage, type PreviewMode } from '../render/preview'
import { fitFactor, zoomFactor, type ZoomSetting } from './zoom'

export function PaperRoll({
  bitmap,
  mode,
  zoom,
  labelWidthDots,
  viewWidthDots,
}: {
  bitmap: PackedBitmap | null
  mode: PreviewMode
  zoom: ZoomSetting
  labelWidthDots?: number
  /** Columns to display. Defaults to the whole bitmap. */
  viewWidthDots?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rollRef = useRef<HTMLDivElement>(null)
  const [availableWidth, setAvailableWidth] = useState(0)

  // Track the container so "Fit" can pick a scale that does not overflow. A
  // ResizeObserver rather than a window listener, because the panel also changes
  // width when the layout reflows around it.
  useLayoutEffect(() => {
    const element = rollRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setAvailableWidth(entry.contentRect.width)
    })
    observer.observe(element)
    setAvailableWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    if (!bitmap) {
      canvas.width = 0
      canvas.height = 0
      return
    }

    const preview = toPreviewImage(
      bitmap,
      mode,
      labelWidthDots ?? bitmap.widthDots,
      viewWidthDots ?? bitmap.widthDots,
    )
    // The backing store is always 1 device dot per pixel; zoom is applied in CSS
    // so the browser cannot resample our carefully-computed dots away.
    canvas.width = preview.width
    canvas.height = preview.height
    ctx.putImageData(new ImageData(preview.data, preview.width, preview.height), 0, 0)
  }, [bitmap, mode, labelWidthDots, viewWidthDots])

  const shownWidth = Math.min(viewWidthDots ?? bitmap?.widthDots ?? 0, bitmap?.widthDots ?? 0)
  const factor =
    zoom === 'fit' ? fitFactor(availableWidth, shownWidth) : zoomFactor(zoom)

  return (
    <div className="roll" ref={rollRef}>
      {bitmap ? (
        <canvas
          ref={canvasRef}
          className="roll__canvas"
          style={{
            width: `${shownWidth * factor}px`,
            height: `${bitmap.heightDots * factor}px`,
          }}
        />
      ) : (
        <p className="roll__empty">Nothing printed yet.</p>
      )}
    </div>
  )
}
