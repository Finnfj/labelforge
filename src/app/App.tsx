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

/**
 * Editor zoom. "fit" leads because it is what you want on almost every screen:
 * the label as large as the panel can show it, and on a phone that is the
 * difference between seeing the design and seeing a third of it.
 */
const EDIT_ZOOMS = ['fit', 1, 1.5, 2, 3] as const
type EditZoom = (typeof EDIT_ZOOMS)[number]

export default function App() {
  const editor = useLabelEditor()
  const connection = usePrinter()
  const diagnostics = useDiagnosticFlags()
  const [zoom, setZoom] = useState<EditZoom>('fit')
  const stageRef = useRef<HTMLDivElement>(null)
  const stageWidth = useElementWidth(stageRef)
  // Resolved to a number here rather than inside EditorCanvas, which keeps the
  // canvas ignorant of where its scale came from.
  const effectiveZoom =
    zoom === 'fit' ? fitScale(stageWidth, mmToDots(editor.doc.size.widthMm)) : zoom
  // Dimensions are the preset's to define; "Custom…" hands them back to the user.
  const isPreset = editor.doc.size.presetId != null

  // Added fonts survive a reload in IndexedDB but not in the browser's font set,
  // so a label using one would render as a fallback until it was added again.
  // Re-registering them at startup is what makes them persist.
  useEffect(() => {
    void registerStoredFonts()
  }, [])

  // Keyboard shortcuts. Deliberately skipped while a field has focus, so that
  // Delete in a text box removes a character rather than the whole element.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

      const meta = event.ctrlKey || event.metaKey
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) editor.redo()
        else editor.undo()
      } else if (meta && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        editor.duplicateSelected()
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (editor.selectedId) {
          event.preventDefault()
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
        <div className="row row--between">
          <h2>Design</h2>
          <label className="field">
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
        </div>

        <Toolbar editor={editor} />

        <div className="editor">
          <div className="editor__stage" ref={stageRef}>
            <EditorCanvas
              doc={editor.doc}
              selectedId={editor.selectedId}
              zoom={effectiveZoom}
              onSelect={editor.select}
              onUpdate={editor.updateElement}
              resolveAsset={resolveAssetUrl}
            />
          </div>
          <Inspector editor={editor} />
        </div>
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
