import { useRef, useState } from 'react'
import type { DraftElement } from '../../model/labelDoc'
import { ICONS, iconToSvg } from '../../render/icons'
import { putAsset } from '../../storage/assets'
import type { LabelEditor } from '../useLabelEditor'

/** Sensible starting geometry, in mm, for a newly added element. */
const NEW_TEXT = {
  kind: 'text',
  text: 'Text',
  fontFamily: 'sans-serif',
  fontSizePt: 10,
  align: 'left',
  x: 2,
  y: 2,
  widthMm: 24,
  heightMm: 6,
  rotation: 0,
} satisfies DraftElement

export function Toolbar({ editor }: { editor: LabelEditor }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [symbolsOpen, setSymbolsOpen] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const add = (element: DraftElement) => editor.addElement(element)

  async function onFile(file: File | undefined) {
    if (!file) return
    setUploadError(null)
    try {
      const assetId = await putAsset(file)
      // Line art by default: most things people drop onto a label are logos or
      // diagrams, and dithering those muddies them. Photographs are one checkbox
      // away in the Inspector.
      add({
        kind: 'image',
        assetId,
        mode: 'lineart',
        fit: 'contain',
        x: 2,
        y: 2,
        widthMm: 20,
        heightMm: 20,
        rotation: 0,
      })
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="toolbar">
      <div className="toolbar__group">
        <button onClick={() => add({ ...NEW_TEXT })}>Text</button>
        <button
          onClick={() =>
            add({
              kind: 'shape',
              shape: 'rect',
              filled: false,
              strokeMm: 0.3,
              x: 2,
              y: 2,
              widthMm: 20,
              heightMm: 12,
              rotation: 0,
            })
          }
        >
          Rectangle
        </button>
        <button
          onClick={() =>
            add({
              kind: 'shape',
              shape: 'ellipse',
              filled: false,
              strokeMm: 0.3,
              x: 2,
              y: 2,
              widthMm: 16,
              heightMm: 16,
              rotation: 0,
            })
          }
        >
          Ellipse
        </button>
        <button
          onClick={() =>
            add({
              kind: 'shape',
              shape: 'line',
              filled: false,
              strokeMm: 0.3,
              x: 2,
              y: 6,
              widthMm: 24,
              heightMm: 0,
              rotation: 0,
            })
          }
        >
          Line
        </button>
      </div>

      <div className="toolbar__group">
        <button
          onClick={() =>
            add({
              kind: 'barcode',
              symbology: 'code128',
              value: '12345678',
              showText: true,
              x: 2,
              y: 2,
              widthMm: 30,
              heightMm: 12,
              rotation: 0,
            })
          }
        >
          Barcode
        </button>
        <button
          onClick={() =>
            add({
              kind: 'qr',
              value: 'https://example.com',
              ecLevel: 'M',
              x: 2,
              y: 2,
              widthMm: 18,
              heightMm: 18,
              rotation: 0,
            })
          }
        >
          QR
        </button>
        <button onClick={() => fileRef.current?.click()}>Image</button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void onFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <button onClick={() => setSymbolsOpen((open) => !open)} aria-expanded={symbolsOpen}>
          Symbol
        </button>
      </div>

      <div className="toolbar__group">
        <button disabled={!editor.selected} onClick={editor.duplicateSelected}>
          Duplicate
        </button>
        <button disabled={!editor.selected} onClick={editor.deleteSelected}>
          Delete
        </button>
      </div>

      <div className="toolbar__group">
        <button disabled={!editor.canUndo} onClick={editor.undo}>
          Undo
        </button>
        <button disabled={!editor.canRedo} onClick={editor.redo}>
          Redo
        </button>
      </div>

      {uploadError && <p className="error">{uploadError}</p>}

      {symbolsOpen && (
        <div className="symbols">
          {ICONS.map((icon) => (
            <button
              key={icon.id}
              className="symbols__item"
              title={icon.label}
              onClick={() => {
                add({
                  kind: 'icon',
                  iconId: icon.id,
                  x: 2,
                  y: 2,
                  widthMm: 10,
                  heightMm: 10,
                  rotation: 0,
                })
                setSymbolsOpen(false)
              }}
              dangerouslySetInnerHTML={{ __html: iconToSvg(icon, 26) }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
