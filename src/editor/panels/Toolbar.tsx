import type { DraftElement } from '../../model/labelDoc'
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
  const add = (element: DraftElement) => editor.addElement(element)

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
    </div>
  )
}
