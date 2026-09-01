import { useRef, useState } from 'react'
import type { DraftElement } from '../../model/labelDoc'
import { iconsByGroup, iconToSvg } from '../../render/icons'
import { putAsset } from '../../storage/assets'
import type { LabelEditor } from '../useLabelEditor'

/** Sensible starting geometry, in mm, for a newly added element. */
const NEW_TEXT = {
  kind: 'text',
  text: 'Text',
  // A bundled face, so a new label is reproducible on any machine from the
  // start. The system keywords are still offered, and still resolve differently
  // everywhere, which is now said out loud in the picker.
  fontFamily: 'Fira Sans',
  fontSizePt: 10,
  align: 'left',
  x: 2,
  y: 2,
  widthMm: 24,
  heightMm: 6,
  rotation: 0,
} satisfies DraftElement

export function Toolbar({
  editor,
  place,
}: {
  editor: LabelEditor
  /**
   * Last word on where a new element lands, applied to every draft below.
   *
   * The drafts describe the element the button promises; this decides where that
   * lands given the state of the view — today, a counter-rotation when the canvas
   * is turned. Keeping it a function of the caller's means the toolbar knows
   * nothing about the canvas, and the geometry is unit-testable on its own.
   */
  place?: (draft: DraftElement) => DraftElement
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [symbolsOpen, setSymbolsOpen] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const add = (element: DraftElement) => editor.addElement(place ? place(element) : element)

  async function onFile(file: File | undefined) {
    if (!file) return
    setUploadError(null)
    try {
      const assetId = await putAsset(file)
      // Photo by default. A photograph thresholded flat collapses to a few black
      // blobs — unrecognisable, and not obviously a *setting* being wrong. Line
      // art dithered is merely a bit noisy, and still plainly the right picture.
      // So the failure this default cannot cause is the worse of the two, and the
      // Render select in the Inspector switches modes either way.
      add({
        kind: 'image',
        assetId,
        mode: 'photo',
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

      {/* Titles carry the shortcuts, because a key nobody can discover is a key
          nobody uses. Copy, cut and paste have no button of their own — they are
          the one set every user already expects to work without being told. */}
      <div className="toolbar__group">
        <button
          disabled={!editor.selected}
          onClick={editor.duplicateSelected}
          title="Ctrl+D — or Ctrl+C then Ctrl+V"
        >
          Duplicate
        </button>
        <button disabled={!editor.selected} onClick={editor.deleteSelected} title="Delete">
          Delete
        </button>
      </div>

      {/* Layering. One step at a time rather than to-front/to-back: a label holds a
          handful of elements, so stepping is enough to resolve any overlap, and two
          buttons beat four in a toolbar this wide. */}
      <div className="toolbar__group">
        <button
          disabled={!editor.selected}
          onClick={editor.raiseSelected}
          title="Bring one step towards the front"
        >
          Forward
        </button>
        <button
          disabled={!editor.selected}
          onClick={editor.lowerSelected}
          title="Send one step towards the back"
        >
          Backward
        </button>
      </div>

      <div className="toolbar__group">
        <button disabled={!editor.canUndo} onClick={editor.undo} title="Ctrl+Z">
          Undo
        </button>
        <button disabled={!editor.canRedo} onClick={editor.redo} title="Ctrl+Shift+Z or Ctrl+Y">
          Redo
        </button>
      </div>

      {uploadError && <p className="error">{uploadError}</p>}

      {symbolsOpen && (
        <div className="symbols">
          {/* Grouped rather than one flat grid: at seventy symbols a flat grid is
              a wall of small line drawings and finding one means scanning it all. */}
          {iconsByGroup().map(({ group, icons }) => (
            <div key={group} className="symbols__group">
              <h4 className="symbols__heading">{group}</h4>
              <div className="symbols__grid">
                {icons.map((icon) => (
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
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
