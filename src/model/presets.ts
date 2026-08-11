import { DEFAULT_HEAD_WIDTH_DOTS, dotsToMm } from './units'

export interface StockPreset {
  id: string
  label: string
  widthMm: number
  heightMm: number
  paper: 'gap' | 'continuous'
}

/**
 * Common die-cut sizes for the P50 family, plus continuous tape.
 *
 * "Width" is across the paper path — the direction the head is fixed in — and
 * "height" runs with the feed. For gap stock the printer detects the height
 * itself, so the value here is the design canvas; a mismatch shows up as content
 * landing over the gap, which is what `learnLabelGap` and the calibration offset
 * are for.
 */
export const STOCK_PRESETS: StockPreset[] = [
  { id: '12x40', label: '12 × 40 mm', widthMm: 12, heightMm: 40, paper: 'gap' },
  { id: '25x15', label: '25 × 15 mm', widthMm: 25, heightMm: 15, paper: 'gap' },
  { id: '25x30', label: '25 × 30 mm', widthMm: 25, heightMm: 30, paper: 'gap' },
  { id: '40x30', label: '40 × 30 mm', widthMm: 40, heightMm: 30, paper: 'gap' },
  { id: '40x60', label: '40 × 60 mm', widthMm: 40, heightMm: 60, paper: 'gap' },
  { id: '50x30', label: '50 × 30 mm', widthMm: 50, heightMm: 30, paper: 'gap' },
  { id: '50x80', label: '50 × 80 mm', widthMm: 50, heightMm: 80, paper: 'gap' },
  { id: 'cont-40', label: '40 mm continuous', widthMm: 40, heightMm: 25, paper: 'continuous' },
  { id: 'cont-50', label: '50 mm continuous', widthMm: 50, heightMm: 25, paper: 'continuous' },
]

export const DEFAULT_PRESET_ID = '40x30'

export function findPreset(id: string): StockPreset | undefined {
  return STOCK_PRESETS.find((p) => p.id === id)
}

/**
 * Widest label the head can physically cover, in mm.
 *
 * With the measured 400-dot head this is 50 mm, so the 50 mm presets fit exactly
 * rather than triggering the clip warning they used to under the vendor SDK's
 * mistaken 384.
 */
export function maxLabelWidthMm(headWidthDots = DEFAULT_HEAD_WIDTH_DOTS): number {
  return dotsToMm(headWidthDots)
}
