import { useEffect, useRef, useState } from 'react'
import { STOCK_PRESETS, findPreset } from '../model/presets'
import { mmToDots } from '../model/units'
import { EditorCanvas } from '../editor/EditorCanvas'
import { Toolbar } from '../editor/panels/Toolbar'
import { Inspector } from '../editor/panels/Inspector'
import { useLabelEditor } from '../editor/useLabelEditor'
import { PrintPanel } from './PrintPanel'
import { ConnectionPanel } from './ConnectionPanel'
import { DiagnosticsPanel } from './DiagnosticsPanel'
import { usePrinter } from './usePrinter'
import { TemplatesPanel } from './TemplatesPanel'
import { useDiagnosticFlags } from './useDiagnosticFlags'
import { useElementWidth } from './useElementWidth'
import { fitScale } from './zoom'
import { REPO_URL } from './links'
import { resolveAssetUrl } from '../storage/assets'
import { registerStoredFonts } from '../storage/fonts'
import { placeForTurnedView } from '../editor/insertPlacement'
import { Shortcuts } from '../editor/panels/Shortcuts'

/**
 * Editor zoom. "fit" leads because it is what you want on almost every screen:
 * the label as large as the panel can show it, and on a phone that is the
 * difference between seeing the design and seeing a third of it.
 */
const EDIT_ZOOMS = ['fit', 1, 1.5, 2, 3] as const
type EditZoom = (typeof EDIT_ZOOMS)[number]

/**
 * Next zoom along, for Ctrl+plus and Ctrl+minus.
 *
 * Steps through the same list the select offers rather than multiplying, so the
 * keyboard and the menu can never disagree about what zooms exist. "Fit" is the
 * first entry and so the bottom of the range: zooming out from 1x lands on it,
 * which is where a user pressing Ctrl+minus repeatedly wants to end up.
 */
function stepZoom(current: EditZoom, direction: 1 | -1): EditZoom {
  const at = EDIT_ZOOMS.indexOf(current)
  const next = Math.min(EDIT_ZOOMS.length - 1, Math.max(0, at + direction))
  return EDIT_ZOOMS[next]
}

export default function App() {
  const editor = useLabelEditor()
  const connection = usePrinter()
  const diagnostics = useDiagnosticFlags()
  const [zoom, setZoom] = useState<EditZoom>('fit')
  /**
   * Whether the editing canvas is shown a quarter turn round.
   *
   * Stored as the turn rather than as an orientation, so that resizing the label
   * cannot silently spin the canvas: a document that goes from tall to wide keeps
   * whatever view the user chose. The select below reads the orientation back out
   * for its label, which is what a user actually thinks in.
   *
   * Deliberately not in the document. The print and the preview show the label as
   * designed whatever this says.
   */
  const [turned, setTurned] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const stageWidth = useElementWidth(stageRef)
  // Resolved to a number here rather than inside EditorCanvas, which keeps the
  // canvas ignorant of where its scale came from. Fit measures whichever dimension
  // is across the screen, so turning the canvas re-fits it rather than letting a
  // tall label overflow the panel on its side.
  const editWidthDots = mmToDots(turned ? editor.doc.size.heightMm : editor.doc.size.widthMm)
  const effectiveZoom = zoom === 'fit' ? fitScale(stageWidth, editWidthDots) : zoom
  // Which way the label reads on screen, so the select can name what you get. The
  // turn is negated rather than the dimensions re-compared, which matters for a
  // square label: comparing would call it vertical either way, and the control would
  // snap back to "Vertical" while the canvas sat there visibly turned.
  const docAcross = editor.doc.size.widthMm > editor.doc.size.heightMm
  const shownAcross = turned ? !docAcross : docAcross
  // Dimensions are the preset's to define; "Custom…" hands them back to the user.
  const isPreset = editor.doc.size.presetId != null

  // Added fonts survive a reload in IndexedDB but not in the browser's font set,
  // so a label using one would render as a fallback until it was added again.
  // Re-registering them at startup is what makes them persist.
  useEffect(() => {
    void registerStoredFonts()
  }, [])

  /**
   * Keyboard shortcuts.
   *
   * Skipped while a field has focus, so Delete in a text box removes a character
   * rather than the whole element — and so Ctrl+C in the name field copies the
   * text the user selected rather than the element behind it. Fabric edits text in
   * a hidden `textarea`, so typing on the canvas is covered by the same guard.
   */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

      const meta = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()
      // Every branch that acts calls preventDefault, because most of these are
      // browser shortcuts too: unhandled, Ctrl+- shrinks the whole page and Ctrl+V
      // fires a paste event at the document.
      const handled = () => event.preventDefault()

      if (meta && key === 'z') {
        handled()
        if (event.shiftKey) editor.redo()
        else editor.undo()
      } else if (meta && key === 'y') {
        // Redo the Windows way as well as the Shift+Ctrl+Z way, since this runs in
        // a browser on whatever the user already has habits from.
        handled()
        editor.redo()
      } else if (meta && key === 'c') {
        handled()
        editor.copySelected()
      } else if (meta && key === 'x') {
        handled()
        editor.cutSelected()
      } else if (meta && key === 'v') {
        handled()
        editor.paste()
      } else if (meta && key === 'd') {
        handled()
        editor.duplicateSelected()
      } else if (meta && (key === '=' || key === '+')) {
        handled()
        setZoom((z) => stepZoom(z, 1))
      } else if (meta && (key === '-' || key === '_')) {
        handled()
        setZoom((z) => stepZoom(z, -1))
      } else if (meta && key === '0') {
        handled()
        setZoom('fit')
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (editor.selectedId) {
          handled()
          editor.deleteSelected()
        }
      } else if (event.key === 'Escape') {
        editor.select(null)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editor])

  return (
    <main className="app">
      <header className="app__header">
        <h1>LabelForge</h1>
        <p className="app__sub">
          Design and print labels on a MarkLife P50 straight from the browser.
        </p>
      </header>

      <ConnectionPanel connection={connection} flags={diagnostics.flags} />

      <section className="panel">
        <h2>Label</h2>
        <div className="row">
          <label className="field">
            <span>Name</span>
            <input value={editor.doc.name} onChange={(e) => editor.rename(e.target.value)} />
          </label>
          <label className="field">
            <span>Stock</span>
            <select
              value={editor.doc.size.presetId ?? 'custom'}
              onChange={(e) => {
                if (e.target.value === 'custom') {
                  // Keep the current dimensions and just unlock them.
                  editor.setSize(editor.doc.size.widthMm, editor.doc.size.heightMm, undefined)
                  return
                }
                const preset = findPreset(e.target.value)
                if (!preset) return
                editor.setSize(preset.widthMm, preset.heightMm, preset.id)
                editor.setPaper(preset.paper)
              }}
            >
              {STOCK_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Custom…</option>
            </select>
          </label>
          <label className="field">
            <span>Paper</span>
            <select
              value={editor.doc.paper.type}
              onChange={(e) => editor.setPaper(e.target.value as 'gap' | 'continuous')}
            >
              <option value="gap">Gap labels</option>
              <option value="continuous">Continuous</option>
            </select>
          </label>
          <label className="field">
            <span>Width</span>
            <input
              type="number"
              step={1}
              min={6}
              disabled={isPreset}
              value={editor.doc.size.widthMm}
              onChange={(e) =>
                editor.setSize(Number(e.target.value) || 1, editor.doc.size.heightMm)
              }
            />
            <em>mm</em>
          </label>
          <label className="field">
            <span>Height</span>
            <input
              type="number"
              step={1}
              min={6}
              disabled={isPreset}
              value={editor.doc.size.heightMm}
              onChange={(e) => editor.setSize(editor.doc.size.widthMm, Number(e.target.value) || 1)}
            />
            <em>mm</em>
          </label>
        </div>
      </section>

      <section className="panel">
        <h2>Design</h2>
        {/* Toolbar and view controls share one band: the toolbar takes the width
            that is left and wraps within it, the selects keep their own column at
            the right. `min-width: 0` on the toolbar is what makes it wrap instead
            of pushing the selects off the end. */}
        <div className="design__controls">
          <Toolbar
            editor={editor}
            // Inserting into a turned canvas should give what the button implies:
            // something upright, on the label. See editor/insertPlacement.ts.
            place={
              turned ? (draft) => placeForTurnedView(draft, editor.doc.size.heightMm) : undefined
            }
          />
          {/*
            Both are view controls, not document ones — hence their place here rather
            than in the label-size panel above, which is about the label itself.
            Stacked in one two-column grid so the two labels and the two selects line
            up with each other; each `label` is display: contents so it associates
            with its select without adding a box that would break that alignment.

            Orientation is offered as the orientation you get, because that is the
            question being asked. The quarter turn needed to reach it is arithmetic
            the user should not have to do.
          */}
          <div className="views">
            <label className="views__row">
              <span>Zoom</span>
              <select
                value={String(zoom)}
                onChange={(e) =>
                  setZoom(e.target.value === 'fit' ? 'fit' : (Number(e.target.value) as EditZoom))
                }
              >
                {EDIT_ZOOMS.map((z) => (
                  <option key={z} value={z}>
                    {z === 'fit' ? 'Fit' : `${z}×`}
                  </option>
                ))}
              </select>
            </label>
            <label className="views__row">
              <span>Editor</span>
              <select
                value={shownAcross ? 'horizontal' : 'vertical'}
                onChange={(e) => setTurned((e.target.value === 'horizontal') !== docAcross)}
              >
                <option value="vertical">Vertical</option>
                <option value="horizontal">Horizontal</option>
              </select>
            </label>
          </div>
        </div>

        <div className="editor">
          <div className="editor__stage" ref={stageRef}>
            <EditorCanvas
              doc={editor.doc}
              selectedId={editor.selectedId}
              zoom={effectiveZoom}
              turned={turned}
              onSelect={editor.select}
              onUpdate={editor.updateElement}
              resolveAsset={resolveAssetUrl}
            />
          </div>
          <Inspector editor={editor} />
        </div>

        <Shortcuts />
      </section>

      <TemplatesPanel doc={editor.doc} onLoad={editor.replaceDoc} />

      <PrintPanel
        doc={editor.doc}
        connection={connection}
        flags={diagnostics.flags}
        updateElement={editor.updateElement}
      />

      <footer className="app__footer">
        <DiagnosticsPanel connection={connection} diagnostics={diagnostics} />
        <span className="app__footer-links">
          {/* The OFL asks that the licence travel with the font software, which
              shipping OFL.txt beside the files already satisfies. This link is
              so a person can actually find it. BASE_URL rather than a bare path,
              because the app is served from a subdirectory on GitHub Pages. */}
          <a
            href={`${import.meta.env.BASE_URL}fonts/OFL.txt`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Font licences
          </a>
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            Source on GitHub
          </a>
        </span>
      </footer>
    </main>
  )
}
