import { useRef, useState } from 'react'
import type { DraftElement } from '../../model/labelDoc'
import { iconsByGroup, iconToSvg } from '../../render/icons'
import { putAsset } from '../../storage/assets'
import type { LabelEditor } from '../useLabelEditor'
import {
  BackwardIcon,
  DeleteIcon,
  DuplicateIcon,
  EllipseIcon,
  ForwardIcon,
  LineIcon,
  RectIcon,
  RedoIcon,
  UndoIcon,
} from './ToolbarIcons'

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
        {/* Shapes as glyphs. A rectangle, an ellipse and a line are the three
            icons in this toolbar that need no explaining, and dropping their words
            buys back the width the named inserts beside them want. */}
        <button
          className="btn--icon"
          aria-label="Rectangle"
          title="Rectangle"
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
          <RectIcon />
        </button>
        <button
          className="btn--icon"
          aria-label="Ellipse"
          title="Ellipse"
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
          <EllipseIcon />
        </button>
        <button
          className="btn--icon"
          aria-label="Line"
          title="Line"
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
          <LineIcon />
        </button>
      </div>

      <div className="toolbar__group toolbar__group--divided">
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

      {/* Acting on the selection, and undoing it. Icons here and words above, which
          is the whole shape of this toolbar: inserting is deliberate and read once,
          so it is named; these are pressed constantly and are the icons every editor
          already agrees on. Splitting them that way is also what stops the row
          reading as one undifferentiated wall of buttons.

          Every title names its shortcut, because a key nobody can discover is a key
          nobody uses. Copy, cut and paste get no button at all — they are the set
          every user expects to work without being shown. */}
      <div className="toolbar__group toolbar__group--divided">
        <button
          className="btn--icon"
          disabled={!editor.selected}
          onClick={editor.duplicateSelected}
          aria-label="Duplicate"
          title="Duplicate — Ctrl+D"
        >
          <DuplicateIcon />
        </button>
        <button
          className="btn--icon btn--icon-danger"
          disabled={!editor.selected}
          onClick={editor.deleteSelected}
          aria-label="Delete"
          title="Delete — Del"
        >
          <DeleteIcon />
        </button>
      </div>

      {/* Layering. One step at a time rather than to-front/to-back: a label holds a
          handful of elements, so stepping resolves any overlap, and two buttons beat
          four in a toolbar this wide. */}
      <div className="toolbar__group toolbar__group--divided">
        <button
          className="btn--icon"
          disabled={!editor.selected}
          onClick={editor.raiseSelected}
          aria-label="Bring forward"
          title="Bring one step towards the front"
        >
          <ForwardIcon />
        </button>
        <button
          className="btn--icon"
          disabled={!editor.selected}
          onClick={editor.lowerSelected}
          aria-label="Send backward"
          title="Send one step towards the back"
        >
          <BackwardIcon />
        </button>
      </div>

      <div className="toolbar__group toolbar__group--divided">
        <button
          className="btn--icon"
          disabled={!editor.canUndo}
          onClick={editor.undo}
          aria-label="Undo"
          title="Undo — Ctrl+Z"
        >
          <UndoIcon />
        </button>
        <button
          className="btn--icon"
          disabled={!editor.canRedo}
          onClick={editor.redo}
          aria-label="Redo"
          title="Redo — Ctrl+Shift+Z or Ctrl+Y"
        >
          <RedoIcon />
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
