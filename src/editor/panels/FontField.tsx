import { useEffect, useRef, useState } from 'react'
import { BUNDLED_FONTS, SYSTEM_FONTS, isGenericFamily } from '../../render/fonts'
import { listFonts, putFont, type UserFontRecord } from '../../storage/fonts'

/**
 * The font picker, and the only place a font is added.
 *
 * Its own component because the Inspector returns early when nothing is
 * selected, so there is nowhere above that return to hang the effect this needs.
 */
export function FontField({ value, onChange }: { value: string; onChange(family: string): void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [added, setAdded] = useState<UserFontRecord[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void listFonts().then(setAdded)
  }, [])

  async function onFile(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      const record = await putFont(file)
      setAdded(await listFonts())
      onChange(record.family)
    } catch (e) {
      // Loud on purpose. A font that failed to load and said nothing would
      // simply render as a fallback, which looks like a font that worked.
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  // A family the document names but this machine does not have — an added font
  // that travelled in a template without its bytes. Offered explicitly so the
  // select shows what the label actually wants instead of rendering blank.
  const known =
    BUNDLED_FONTS.some((f) => f.family === value) ||
    SYSTEM_FONTS.some((f) => f.family === value) ||
    added.some((f) => f.family === value)

  const selected =
    BUNDLED_FONTS.find((f) => f.family === value) ?? SYSTEM_FONTS.find((f) => f.family === value)

  return (
    <>
      <label className="field">
        <span>Font</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {!known && <option value={value}>{value} — not on this machine</option>}
          <optgroup label="Bundled">
            {BUNDLED_FONTS.map((f) => (
              <option key={f.family} value={f.family}>
                {f.label}
              </option>
            ))}
          </optgroup>
          {added.length > 0 && (
            <optgroup label="Added">
              {added.map((f) => (
                <option key={f.family} value={f.family}>
                  {f.displayName}
                </option>
              ))}
            </optgroup>
          )}
          {/* Named for what they are. `sans-serif` is Arial here, Liberation or
              DejaVu on Linux, Roboto on Android — same label, different metrics,
              and until now nothing said so. */}
          <optgroup label="System — varies by machine">
            {SYSTEM_FONTS.map((f) => (
              <option key={f.family} value={f.family}>
                {f.label}
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      <div className="row">
        <button onClick={() => fileRef.current?.click()}>Add font…</button>
        <input
          ref={fileRef}
          type="file"
          accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
          hidden
          onChange={(e) => {
            void onFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>

      {error && <p className="error">{error}</p>}
      {selected?.note && <p className="hint">{selected.note}</p>}
      {added.some((f) => f.family === value) && (
        <p className="hint">
          Added fonts stay on this device &mdash; nothing is sent anywhere. An export names the font
          rather than carrying it, unless you tick the box in Templates.
        </p>
      )}
      {isGenericFamily(value) && (
        <p className="hint">
          A system font resolves to whatever this machine has, so this label may print in a
          different typeface elsewhere. A bundled font is carried with the app and prints the same
          everywhere.
        </p>
      )}
    </>
  )
}
