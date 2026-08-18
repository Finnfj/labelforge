import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

/*
 * Label fonts, bundled so a label prints the same on every machine.
 *
 * Latin only, regular and bold. Bold is shipped rather than left to the
 * browser's synthetic emboldening, which thickens stems by an unpredictable
 * amount — fine on a screen, a real difference at 203 dpi. Italic is not
 * shipped: the field exists on TextElement but no control sets it, so the files
 * would be bytes for a state the UI cannot reach.
 *
 * Imported here, in the app layer, rather than from `render/fonts.ts` — that
 * module is the catalogue and the loader, and keeping bundler asset imports out
 * of it leaves it a plain module the node test tier can import.
 *
 * These declare the faces; they do not load them. Canvas never triggers a font
 * load, so `ensureDocumentFonts` in `render/fonts.ts` is what actually pulls the
 * bytes in before anything is rasterised.
 */
import '@fontsource/fira-sans/latin-400.css'
import '@fontsource/fira-sans/latin-700.css'
import '@fontsource/archivo-narrow/latin-400.css'
import '@fontsource/archivo-narrow/latin-700.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-700.css'

import './index.css'
import App from './app/App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
