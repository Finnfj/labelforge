import type { ShapeElement, TextElement } from '../../model/labelDoc'
import type { LabelEditor } from '../useLabelEditor'

const FONTS = [
  { value: 'sans-serif', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'monospace', label: 'Mono' },
]

function NumberField({
  label,
  value,
  onChange,
  step = 0.5,
  min,
  suffix,
}: {
  label: string
  value: number
  onChange(next: number): void
  step?: number
  min?: number
  suffix?: string
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0}
        step={step}
        min={min}
        onChange={(e) => {
          const next = Number(e.target.value)
          if (Number.isFinite(next)) onChange(next)
        }}
      />
      {suffix && <em>{suffix}</em>}
    </label>
  )
}

export function Inspector({ editor }: { editor: LabelEditor }) {
  const element = editor.selected

  if (!element) {
    return (
      <div className="inspector">
        <p className="hint">Select an element to edit it, or add one from the toolbar.</p>
      </div>
    )
  }

  const set = (patch: Parameters<LabelEditor['updateElement']>[1]) =>
    editor.updateElement(element.id, patch)

  return (
    <div className="inspector">
      <h3>{element.kind}</h3>

      <div className="grid2">
        <NumberField label="X" value={element.x} onChange={(x) => set({ x })} suffix="mm" />
        <NumberField label="Y" value={element.y} onChange={(y) => set({ y })} suffix="mm" />
        <NumberField
          label="Width"
          value={element.widthMm}
          min={0.5}
          onChange={(widthMm) => set({ widthMm })}
          suffix="mm"
        />
        <NumberField
          label="Height"
          value={element.heightMm}
          min={0.5}
          onChange={(heightMm) => set({ heightMm })}
          suffix="mm"
        />
        <NumberField
          label="Rotation"
          value={element.rotation}
          step={15}
          onChange={(rotation) => set({ rotation })}
          suffix="°"
        />
      </div>

      {element.kind === 'text' && (
        <>
          <label className="field field--block">
            <span>Text</span>
            <textarea
              rows={3}
              value={(element as TextElement).text}
              onChange={(e) => set({ text: e.target.value } as Partial<TextElement>)}
            />
          </label>
          <div className="grid2">
            <label className="field">
              <span>Font</span>
              <select
                value={(element as TextElement).fontFamily}
                onChange={(e) => set({ fontFamily: e.target.value } as Partial<TextElement>)}
              >
                {FONTS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <NumberField
              label="Size"
              value={(element as TextElement).fontSizePt}
              step={1}
              min={4}
              onChange={(fontSizePt) => set({ fontSizePt } as Partial<TextElement>)}
              suffix="pt"
            />
            <label className="field">
              <span>Align</span>
              <select
                value={(element as TextElement).align}
                onChange={(e) =>
                  set({ align: e.target.value as TextElement['align'] } as Partial<TextElement>)
                }
              >
                <option value="left">Left</option>
                <option value="center">Centre</option>
                <option value="right">Right</option>
              </select>
            </label>
            <label className="field field--check">
              <input
                type="checkbox"
                checked={Boolean((element as TextElement).bold)}
                onChange={(e) => set({ bold: e.target.checked } as Partial<TextElement>)}
              />
              <span>Bold</span>
            </label>
          </div>
          {(element as TextElement).fontSizePt < 6 && (
            <p className="warn">
              Below about 6 pt, glyph stems fall under one dot at 203 dpi and the text
              tends to smear shut. Check the thermal preview.
            </p>
          )}
        </>
      )}

      {element.kind === 'shape' && (
        <div className="grid2">
          <label className="field field--check">
            <input
              type="checkbox"
              checked={(element as ShapeElement).filled}
              onChange={(e) => set({ filled: e.target.checked } as Partial<ShapeElement>)}
            />
            <span>Filled</span>
          </label>
          <NumberField
            label="Stroke"
            value={(element as ShapeElement).strokeMm}
            step={0.1}
            min={0}
            onChange={(strokeMm) => set({ strokeMm } as Partial<ShapeElement>)}
            suffix="mm"
          />
        </div>
      )}
    </div>
  )
}
