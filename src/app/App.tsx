import { useEffect, useState } from 'react'
import { STOCK_PRESETS, findPreset } from '../model/presets'
import { EditorCanvas } from '../editor/EditorCanvas'
import { Toolbar } from '../editor/panels/Toolbar'
import { Inspector } from '../editor/panels/Inspector'
import { useLabelEditor } from '../editor/useLabelEditor'
import { PrintPanel } from './PrintPanel'
import { TemplatesPanel } from './TemplatesPanel'
import { resolveAssetUrl } from '../storage/assets'

const EDIT_ZOOMS = [1, 1.5, 2, 3] as const

export default function App() {
  const editor = useLabelEditor()
  const [zoom, setZoom] = useState<number>(2)

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
                const preset = findPreset(e.target.value)
                if (!preset) return
                editor.setSize(preset.widthMm, preset.heightMm, preset.id)
                editor.setPaper(preset.paper)
              }}
            >
              {!editor.doc.size.presetId && <option value="custom">Custom</option>}
              {STOCK_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Width</span>
            <input
              type="number"
              step={1}
              min={6}
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
              value={editor.doc.size.heightMm}
              onChange={(e) =>
                editor.setSize(editor.doc.size.widthMm, Number(e.target.value) || 1)
              }
            />
            <em>mm</em>
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
        </div>
      </section>

      <section className="panel">
        <div className="row row--between">
          <h2>Design</h2>
          <label className="field">
            <span>Zoom</span>
            <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
              {EDIT_ZOOMS.map((z) => (
                <option key={z} value={z}>
                  {z}&times;
                </option>
              ))}
            </select>
          </label>
        </div>

        <Toolbar editor={editor} />

        <div className="editor">
          <div className="editor__stage">
            <EditorCanvas
              doc={editor.doc}
              selectedId={editor.selectedId}
              zoom={zoom}
              onSelect={editor.select}
              onUpdate={(id, patch) => editor.updateElement(id, patch)}
              resolveAsset={resolveAssetUrl}
            />
          </div>
          <Inspector editor={editor} />
        </div>
      </section>

      <TemplatesPanel doc={editor.doc} onLoad={editor.replaceDoc} />

      <PrintPanel doc={editor.doc} />
    </main>
  )
}
