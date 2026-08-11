import { useMemo } from 'react'
import type {
  BarcodeElement,
  IconElement,
  ImageElement,
  QrElement,
  ShapeElement,
  TextElement,
} from '../../model/labelDoc'
import { ICONS, iconToSvg } from '../../render/icons'
import { mmToDots } from '../../model/units'
import { checkCode } from '../../render/barcode'
import type { LabelEditor } from '../useLabelEditor'

const SYMBOLOGIES: Array<{ value: BarcodeElement['symbology']; label: string }> = [
  { value: 'code128', label: 'Code 128' },
  { value: 'code39', label: 'Code 39' },
  { value: 'ean13', label: 'EAN-13' },
  { value: 'ean8', label: 'EAN-8' },
  { value: 'itf14', label: 'ITF-14' },
  { value: 'gs1-128', label: 'GS1-128' },
  { value: 'datamatrix', label: 'Data Matrix' },
]

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

function CodeStatus({ element }: { element: BarcodeElement | QrElement }) {
  const check = useMemo(
    () => checkCode(element, mmToDots(element.widthMm), mmToDots(element.heightMm)),
    [element],
  )
  if (check.error) return <p className="error">{check.error}</p>
  if (check.warning) return <p className="warn">{check.warning}</p>
  return <p className="hint">Modules {check.moduleDots} dots wide.</p>
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
              Below about 6 pt, glyph stems fall under one dot at 203 dpi and the text tends to
              smear shut. Check the thermal preview.
            </p>
          )}
        </>
      )}

      {element.kind === 'barcode' && (
        <>
          <label className="field field--block">
            <span>Value</span>
            <input
              value={(element as BarcodeElement).value}
              onChange={(e) => set({ value: e.target.value } as Partial<BarcodeElement>)}
            />
          </label>
          <div className="grid2">
            <label className="field">
              <span>Type</span>
              <select
                value={(element as BarcodeElement).symbology}
                onChange={(e) =>
                  set({
                    symbology: e.target.value as BarcodeElement['symbology'],
                  } as Partial<BarcodeElement>)
                }
              >
                {SYMBOLOGIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field field--check">
              <input
                type="checkbox"
                checked={(element as BarcodeElement).showText}
                onChange={(e) => set({ showText: e.target.checked } as Partial<BarcodeElement>)}
              />
              <span>Show text</span>
            </label>
          </div>
          <CodeStatus element={element as BarcodeElement} />
        </>
      )}

      {element.kind === 'qr' && (
        <>
          <label className="field field--block">
            <span>Value</span>
            <textarea
              rows={2}
              value={(element as QrElement).value}
              onChange={(e) => set({ value: e.target.value } as Partial<QrElement>)}
            />
          </label>
          <label className="field">
            <span>Correction</span>
            <select
              value={(element as QrElement).ecLevel}
              onChange={(e) =>
                set({ ecLevel: e.target.value as QrElement['ecLevel'] } as Partial<QrElement>)
              }
            >
              <option value="L">L — 7%</option>
              <option value="M">M — 15%</option>
              <option value="Q">Q — 25%</option>
              <option value="H">H — 30%</option>
            </select>
          </label>
          <CodeStatus element={element as QrElement} />
        </>
      )}

      {element.kind === 'image' && (
        <>
          <div className="grid2">
            <label className="field">
              <span>Render</span>
              <select
                value={(element as ImageElement).mode}
                onChange={(e) =>
                  set({ mode: e.target.value as ImageElement['mode'] } as Partial<ImageElement>)
                }
              >
                <option value="lineart">Line art</option>
                <option value="photo">Photo</option>
              </select>
            </label>
            <label className="field">
              <span>Fit</span>
              <select
                value={(element as ImageElement).fit}
                onChange={(e) =>
                  set({ fit: e.target.value as ImageElement['fit'] } as Partial<ImageElement>)
                }
              >
                <option value="contain">Contain</option>
                <option value="cover">Cover</option>
                <option value="stretch">Stretch</option>
              </select>
            </label>
            {(element as ImageElement).mode === 'lineart' && (
              <NumberField
                label="Threshold"
                value={(element as ImageElement).threshold ?? 128}
                step={8}
                min={0}
                onChange={(threshold) => set({ threshold } as Partial<ImageElement>)}
              />
            )}
            <label className="field field--check">
              <input
                type="checkbox"
                checked={Boolean((element as ImageElement).invert)}
                onChange={(e) => set({ invert: e.target.checked } as Partial<ImageElement>)}
              />
              <span>Invert</span>
            </label>
          </div>
          <p className="hint">
            {(element as ImageElement).mode === 'photo'
              ? 'Dithered for tone. Check the thermal preview — dithering can print muddy.'
              : 'Thresholded for sharp edges. Raise the threshold to catch faint lines.'}
          </p>
        </>
      )}

      {element.kind === 'icon' && (
        <div className="symbols symbols--inline">
          {ICONS.map((icon) => (
            <button
              key={icon.id}
              className={
                'symbols__item' +
                (icon.id === (element as IconElement).iconId ? ' symbols__item--active' : '')
              }
              title={icon.label}
              onClick={() => set({ iconId: icon.id } as Partial<IconElement>)}
              // Markup comes from our own icon table, not user input.
              dangerouslySetInnerHTML={{ __html: iconToSvg(icon, 22) }}
            />
          ))}
        </div>
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
