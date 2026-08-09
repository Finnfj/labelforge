import { useCallback, useEffect, useRef, useState } from 'react'
import type { LabelDoc } from '../model/labelDoc'
import { newId } from '../model/labelDoc'
import {
  PORTABLE_EXTENSION,
  deleteTemplate,
  exportDoc,
  importDoc,
  listTemplates,
  saveTemplate,
  type StoredTemplate,
} from '../storage/templates'

export function TemplatesPanel({
  doc,
  onLoad,
}: {
  doc: LabelDoc
  onLoad(doc: LabelDoc): void
}) {
  const [templates, setTemplates] = useState<StoredTemplate[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    try {
      setTemplates(await listTemplates())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <div className="row row--between">
        <h2>Templates</h2>
        <div className="row">
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                await saveTemplate(doc)
                await refresh()
              })
            }
          >
            Save as template
          </button>
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                const json = await exportDoc(doc)
                const blob = new Blob([json], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const anchor = document.createElement('a')
                anchor.href = url
                anchor.download = `${slug(doc.name)}${PORTABLE_EXTENSION}`
                anchor.click()
                URL.revokeObjectURL(url)
              })
            }
          >
            Export
          </button>
          <button disabled={busy} onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              void run(async () => {
                const imported = await importDoc(await file.text())
                // A fresh id, so importing the same file twice does not overwrite
                // the copy already open.
                onLoad({ ...imported, id: newId() })
              })
            }}
          />
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      {templates.length === 0 ? (
        <p className="hint">
          No saved templates yet. &ldquo;Save as template&rdquo; keeps a copy of the current
          label, including its images.
        </p>
      ) : (
        <ul className="templates">
          {templates.map((template) => (
            <li key={template.id}>
              <button
                className="templates__load"
                onClick={() => onLoad({ ...structuredClone(template.doc), id: newId() })}
              >
                <strong>{template.name}</strong>
                <span className="hint">
                  {template.doc.size.widthMm} × {template.doc.size.heightMm} mm ·{' '}
                  {template.doc.elements.length} element
                  {template.doc.elements.length === 1 ? '' : 's'}
                </span>
              </button>
              <button
                className="danger"
                aria-label={`Delete ${template.name}`}
                onClick={() =>
                  run(async () => {
                    await deleteTemplate(template.id)
                    await refresh()
                  })
                }
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'label'
  )
}
