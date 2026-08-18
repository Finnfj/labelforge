import { useEffect, useRef } from 'react'
import type { PackedBitmap } from '../model/bitmap'
import { toPreviewImage, type PreviewMode } from '../render/preview'
import { useElementWidth } from './useElementWidth'
import { fitFactor, zoomFactor, type ZoomSetting } from './zoom'

export function PaperRoll({
  bitmap,
  mode,
  zoom,
  labelStartDots,
  labelWidthDots,
  viewOriginDots,
  viewWidthDots,
}: {
  bitmap: PackedBitmap | null
  mode: PreviewMode
  zoom: ZoomSetting
  /** Left edge of the paper within the raster. */
  labelStartDots?: number
  labelWidthDots?: number
  /** Window to display, in raster coordinates. Defaults to the whole bitmap. */
  viewOriginDots?: number
  viewWidthDots?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rollRef = useRef<HTMLDivElement>(null)
  // Tracked so "Fit" can pick a scale that does not overflow.
  const availableWidth = useElementWidth(rollRef)

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

    const preview = toPreviewImage(bitmap, {
      mode,
      labelStartDots: labelStartDots ?? 0,
      labelWidthDots: labelWidthDots ?? bitmap.widthDots,
      viewOriginDots: viewOriginDots ?? 0,
      viewWidthDots: viewWidthDots ?? bitmap.widthDots,
    })
    // The backing store is always 1 device dot per pixel; zoom is applied in CSS
    // so the browser cannot resample our carefully-computed dots away.
    canvas.width = preview.width
    canvas.height = preview.height
    ctx.putImageData(new ImageData(preview.data, preview.width, preview.height), 0, 0)
  }, [bitmap, mode, labelStartDots, labelWidthDots, viewOriginDots, viewWidthDots])

  const shownWidth = Math.min(viewWidthDots ?? bitmap?.widthDots ?? 0, bitmap?.widthDots ?? 0)
  const factor = zoom === 'fit' ? fitFactor(availableWidth, shownWidth) : zoomFactor(zoom)

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
