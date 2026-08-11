import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createEmptyDoc,
  newId,
  nextZ,
  type LabelDoc,
  type LabelElement,
  type DraftElement,
  type ElementPatch,
} from '../model/labelDoc'
import { parseDoc } from '../model/labelDoc.schema'
import { DEFAULT_PRESET_ID, findPreset } from '../model/presets'

const AUTOSAVE_KEY = 'labelforge.doc.v1'
const HISTORY_LIMIT = 100

function initialDoc(): LabelDoc {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(AUTOSAVE_KEY) : null
  if (saved) {
    try {
      return parseDoc(JSON.parse(saved))
    } catch (error) {
      // A corrupt or future-version autosave must not brick the editor.
      console.warn('Discarding unreadable autosave', error)
    }
  }
  const preset = findPreset(DEFAULT_PRESET_ID)!
  const doc = createEmptyDoc(preset.widthMm, preset.heightMm)
  doc.size.presetId = preset.id
  doc.paper.type = preset.paper
  return doc
}

export interface LabelEditor {
  doc: LabelDoc
  selectedId: string | null
  selected: LabelElement | null
  canUndo: boolean
  canRedo: boolean
  select(id: string | null): void
  addElement(element: DraftElement): string
  updateElement(id: string, patch: ElementPatch, options?: { transient?: boolean }): void
  deleteSelected(): void
  duplicateSelected(): void
  setSize(widthMm: number, heightMm: number, presetId?: string): void
  setPaper(type: 'gap' | 'continuous'): void
  rename(name: string): void
  replaceDoc(doc: LabelDoc): void
  undo(): void
  redo(): void
}

/**
 * Document state with undo/redo.
 *
 * History holds whole `LabelDoc` snapshots rather than Fabric canvas state.
 * Documents are small plain objects, so the memory cost is trivial, and it means
 * undo works identically whether a change came from the canvas, a properties
 * field or an import.
 *
 * Continuous gestures (dragging, typing) pass `transient: true` so a single drag
 * produces one history entry instead of sixty.
 */
export function useLabelEditor(): LabelEditor {
  const [doc, setDocState] = useState<LabelDoc>(initialDoc)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const past = useRef<LabelDoc[]>([])
  const future = useRef<LabelDoc[]>([])
  const [historyTick, setHistoryTick] = useState(0)

  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(doc))
      } catch (error) {
        console.warn('Autosave failed', error)
      }
    }, 400)
    return () => clearTimeout(id)
  }, [doc])

  const commit = useCallback((next: LabelDoc, transient = false) => {
    setDocState((current) => {
      if (!transient) {
        past.current = [...past.current, current].slice(-HISTORY_LIMIT)
        future.current = []
        setHistoryTick((t) => t + 1)
      }
      return { ...next, updatedAt: Date.now() }
    })
  }, [])

  const mutate = useCallback((fn: (draft: LabelDoc) => LabelDoc, transient = false) => {
    setDocState((current) => {
      if (!transient) {
        past.current = [...past.current, current].slice(-HISTORY_LIMIT)
        future.current = []
        setHistoryTick((t) => t + 1)
      }
      return { ...fn(current), updatedAt: Date.now() }
    })
  }, [])

  const addElement = useCallback(
    (element: DraftElement) => {
      const id = newId()
      mutate((current) => ({
        ...current,
        elements: [...current.elements, { ...element, id, z: nextZ(current) } as LabelElement],
      }))
      setSelectedId(id)
      return id
    },
    [mutate],
  )

  const updateElement = useCallback(
    (id: string, patch: ElementPatch, options?: { transient?: boolean }) => {
      mutate(
        (current) => ({
          ...current,
          elements: current.elements.map((e) =>
            e.id === id ? ({ ...e, ...patch } as LabelElement) : e,
          ),
        }),
        options?.transient,
      )
    },
    [mutate],
  )

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    mutate((current) => ({
      ...current,
      elements: current.elements.filter((e) => e.id !== selectedId),
    }))
    setSelectedId(null)
  }, [mutate, selectedId])

  const duplicateSelected = useCallback(() => {
    if (!selectedId) return
    const id = newId()
    mutate((current) => {
      const source = current.elements.find((e) => e.id === selectedId)
      if (!source) return current
      return {
        ...current,
        elements: [
          ...current.elements,
          { ...source, id, x: source.x + 2, y: source.y + 2, z: nextZ(current) },
        ],
      }
    })
    setSelectedId(id)
  }, [mutate, selectedId])

  const setSize = useCallback(
    (widthMm: number, heightMm: number, presetId?: string) => {
      mutate((current) => ({ ...current, size: { widthMm, heightMm, presetId } }))
    },
    [mutate],
  )

  const setPaper = useCallback(
    (type: 'gap' | 'continuous') => mutate((current) => ({ ...current, paper: { type } })),
    [mutate],
  )

  const rename = useCallback(
    (name: string) => mutate((current) => ({ ...current, name })),
    [mutate],
  )

  const replaceDoc = useCallback((next: LabelDoc) => commit(next), [commit])

  const undo = useCallback(() => {
    setDocState((current) => {
      const previous = past.current[past.current.length - 1]
      if (!previous) return current
      past.current = past.current.slice(0, -1)
      future.current = [current, ...future.current]
      setHistoryTick((t) => t + 1)
      return previous
    })
    setSelectedId(null)
  }, [])

  const redo = useCallback(() => {
    setDocState((current) => {
      const next = future.current[0]
      if (!next) return current
      future.current = future.current.slice(1)
      past.current = [...past.current, current]
      setHistoryTick((t) => t + 1)
      return next
    })
    setSelectedId(null)
  }, [])

  // Referenced so React re-renders when only the history refs changed.
  void historyTick

  return {
    doc,
    selectedId,
    selected: doc.elements.find((e) => e.id === selectedId) ?? null,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    select: setSelectedId,
    addElement,
    updateElement,
    deleteSelected,
    duplicateSelected,
    setSize,
    setPaper,
    rename,
    replaceDoc,
    undo,
    redo,
  }
}
