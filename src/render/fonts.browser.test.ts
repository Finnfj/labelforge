import { describe, expect, it } from 'vitest'
import { createEmptyDoc, type LabelDoc, type TextElement } from '../model/labelDoc'
import { ensureDocumentFonts, registerUserFont } from './fonts'

// The bundled declarations, exactly as the app loads them in main.tsx. Importing
// them here means this file exercises the real @font-face path rather than a
// stand-in, and fails if the packaged CSS ever moves.
import '@fontsource/fira-sans/latin-400.css'
import '@fontsource/fira-sans/latin-700.css'
import firaSansUrl from '@fontsource/fira-sans/files/fira-sans-latin-400-normal.woff2?url'

/**
 * The load-and-check contract.
 *
 * This is the guard that stops a not-yet-loaded face rasterising as a fallback —
 * the one font failure that produces a completely plausible wrong label.
 */

function docWithText(fontFamily: string, text = 'Handling 8.5', fontSizePt = 10): LabelDoc {
  const doc = createEmptyDoc(40, 30)
  doc.elements = [
    {
      id: 't1',
      kind: 'text',
      text,
      fontFamily,
      fontSizePt,
      align: 'left',
      x: 2,
      y: 2,
      widthMm: 30,
      heightMm: 8,
      rotation: 0,
      z: 1,
    } satisfies TextElement,
  ]
  return doc
}

describe('ensureDocumentFonts', () => {
  it('loads and accepts a bundled family', async () => {
    // The whole point of bundling: this must pass without the machine owning the
    // font, and without anything in the DOM having used it first.
    expect(await ensureDocumentFonts(docWithText('Fira Sans'))).toEqual([])
  })

  it('reports a family this machine does not have', async () => {
    // `document.fonts.check()` returns true here — a family nothing matches has
    // no unloaded faces — so this is the case measurement exists to catch.
    const missing = await ensureDocumentFonts(docWithText('Definitely Not Installed Anywhere'))
    expect(missing).toEqual(['Definitely Not Installed Anywhere'])
  })

  it('never reports a generic family', async () => {
    for (const family of ['sans-serif', 'serif', 'monospace']) {
      expect(await ensureDocumentFonts(docWithText(family))).toEqual([])
    }
  })

  it('accepts a font registered from raw bytes', async () => {
    const bytes = await (await fetch(firaSansUrl)).arrayBuffer()
    await registerUserFont('lf-testfont', bytes, 'Test Font')
    expect(await ensureDocumentFonts(docWithText('lf-testfont'))).toEqual([])
  })

  it('refuses a file that is not a font, loudly', async () => {
    // Silence here would mean an upload that looks like it worked and prints in
    // a substitute face.
    const notAFont = new TextEncoder().encode('this is not a font at all').buffer
    await expect(registerUserFont('lf-garbage', notAFont, 'Broken.ttf')).rejects.toThrow(
      /could not be read as a font/,
    )
  })

  it('loads the bold face for bold text, not just the regular one', async () => {
    // Regression: the spec used to omit the weight, so only the 400 face was
    // ever loaded. Bold text then rasterised against an unloaded 700 and came
    // out as the browser's synthetic bold — a real difference at 203 dpi, and
    // exactly the silent substitution this guard exists to stop.
    const doc = docWithText('Fira Sans')
    ;(doc.elements[0] as TextElement).bold = true
    expect(await ensureDocumentFonts(doc)).toEqual([])

    const bold = [...document.fonts].find((f) => f.family === 'Fira Sans' && f.weight === '700')
    expect(bold?.status).toBe('loaded')
  })

  it('reports each missing family once, however many elements want it', async () => {
    const doc = docWithText('Missing Face A')
    doc.elements.push({ ...(doc.elements[0] as TextElement), id: 't2', fontSizePt: 18 })
    doc.elements.push({
      ...(doc.elements[0] as TextElement),
      id: 't3',
      fontFamily: 'Missing Face B',
    })
    expect((await ensureDocumentFonts(doc)).sort()).toEqual(['Missing Face A', 'Missing Face B'])
  })

  it('ignores documents with no text at all', async () => {
    expect(await ensureDocumentFonts(createEmptyDoc(40, 30))).toEqual([])
  })

  it('still decides when the text is blank', async () => {
    // Empty text measures zero against every fallback, which would read as
    // "missing" for a font that is perfectly fine. A fixed probe covers it.
    expect(await ensureDocumentFonts(docWithText('Fira Sans', '   '))).toEqual([])
  })

  it('does not let a family containing a quote break the CSS shorthand', async () => {
    // The family goes into a `font` shorthand; an unescaped quote would make it
    // unparseable, and an unparseable spec silently measures as the fallback.
    expect(await ensureDocumentFonts(docWithText('Bad "Quoted" Family'))).toEqual([
      'Bad "Quoted" Family',
    ])
  })
})
