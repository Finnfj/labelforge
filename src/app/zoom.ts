/** CSS pixels per inch, as assumed by every browser. */
const CSS_DPI = 96
const PRINTER_DPI = 203

export type ZoomSetting = 'actual' | 1 | 2 | 4

/**
 * Display scale for a printer dot.
 *
 * "actual" shows the label at its real physical size on screen, which is the only
 * honest way to judge whether 6 pt text is going to be readable once printed.
 */
export function zoomFactor(zoom: ZoomSetting): number {
  return zoom === 'actual' ? CSS_DPI / PRINTER_DPI : zoom
}
