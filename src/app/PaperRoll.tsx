import { useEffect, useRef } from 'react'
import type { PackedBitmap } from '../model/bitmap'
import { toPreviewImage, type PreviewMode } from '../render/preview'
import { zoomFactor, type ZoomSetting } from './zoom'

export function PaperRoll({
  bitmap,
  mode,
  zoom,
  labelWidthDots,
}: {
  bitmap: PackedBitmap | null
  mode: PreviewMode
  zoom: ZoomSetting
  labelWidthDots?: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

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

    const preview = toPreviewImage(bitmap, mode, labelWidthDots ?? bitmap.widthDots)
    // The backing store is always 1 device dot per pixel; zoom is applied in CSS
    // so the browser cannot resample our carefully-computed dots away.
    canvas.width = preview.width
    canvas.height = preview.height
    ctx.putImageData(new ImageData(preview.data, preview.width, preview.height), 0, 0)
  }, [bitmap, mode, labelWidthDots])

  const factor = zoomFactor(zoom)

  return (
    <div className="roll">
      {bitmap ? (
        <canvas
          ref={canvasRef}
          className="roll__canvas"
          style={{
            width: `${bitmap.widthDots * factor}px`,
            height: `${bitmap.heightDots * factor}px`,
          }}
        />
      ) : (
        <p className="roll__empty">Nothing printed yet.</p>
      )}
    </div>
  )
}
