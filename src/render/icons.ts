/**
 * Symbol library.
 *
 * These are original, deliberately plain 24×24 stroke icons rather than an
 * imported icon set. Two reasons: a thermal head at 203 dpi turns fine detail
 * into mush, so icons need heavier strokes and fewer features than screen icons
 * do; and shipping our own means no third-party attribution to track.
 *
 * Each entry is the inner markup of a 24×24 viewBox. Stroke colour and width are
 * applied by the wrapper so a single icon can be rendered at any size.
 */
export interface IconDef {
  id: string
  label: string
  /** Inner SVG markup, 24×24 coordinate space. */
  body: string
  /** Icons drawn as filled areas rather than strokes. */
  filled?: boolean
}

export const ICONS: IconDef[] = [
  { id: 'arrow-right', label: 'Arrow right', body: '<line x1="3" y1="12" x2="20" y2="12"/><polyline points="14 6 20 12 14 18"/>' },
  { id: 'arrow-left', label: 'Arrow left', body: '<line x1="21" y1="12" x2="4" y2="12"/><polyline points="10 6 4 12 10 18"/>' },
  { id: 'arrow-up', label: 'Arrow up', body: '<line x1="12" y1="21" x2="12" y2="4"/><polyline points="6 10 12 4 18 10"/>' },
  { id: 'arrow-down', label: 'Arrow down', body: '<line x1="12" y1="3" x2="12" y2="20"/><polyline points="6 14 12 20 18 14"/>' },
  { id: 'check', label: 'Check', body: '<polyline points="3 13 9 19 21 5"/>' },
  { id: 'cross', label: 'Cross', body: '<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>' },
  { id: 'plus', label: 'Plus', body: '<line x1="12" y1="4" x2="12" y2="20"/><line x1="4" y1="12" x2="20" y2="12"/>' },
  { id: 'minus', label: 'Minus', body: '<line x1="4" y1="12" x2="20" y2="12"/>' },
  { id: 'warning', label: 'Warning', body: '<path d="M12 3 L22 20 L2 20 Z"/><line x1="12" y1="9" x2="12" y2="14"/><line x1="12" y1="17" x2="12" y2="17.01"/>' },
  { id: 'info', label: 'Info', body: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="12" y1="7" x2="12" y2="7.01"/>' },
  { id: 'circle', label: 'Circle', body: '<circle cx="12" cy="12" r="9"/>' },
  { id: 'square', label: 'Square', body: '<rect x="3" y="3" width="18" height="18" rx="2"/>' },
  { id: 'triangle', label: 'Triangle', body: '<path d="M12 3 L22 20 L2 20 Z"/>' },
  { id: 'star', label: 'Star', body: '<path d="M12 3 L14.8 9.3 L21.5 10 L16.5 14.5 L18 21 L12 17.6 L6 21 L7.5 14.5 L2.5 10 L9.2 9.3 Z"/>' },
  { id: 'heart', label: 'Heart', body: '<path d="M12 20 C5 15.5 2.5 12 2.5 8.8 A4.6 4.6 0 0 1 12 6.6 A4.6 4.6 0 0 1 21.5 8.8 C21.5 12 19 15.5 12 20 Z"/>' },
  { id: 'lock', label: 'Lock', body: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10 V7 a4 4 0 0 1 8 0 v3"/>' },
  { id: 'thermometer', label: 'Temperature', body: '<path d="M14 14.8 V4 a2 2 0 0 0 -4 0 v10.8 a4 4 0 1 0 4 0 Z"/>' },
  { id: 'droplet', label: 'Moisture', body: '<path d="M12 3 C12 3 5 10.5 5 14.5 A7 7 0 0 0 19 14.5 C19 10.5 12 3 12 3 Z"/>' },
  { id: 'flame', label: 'Flammable', body: '<path d="M12 22 A6 6 0 0 0 18 16 C18 11 12 9 13 2 C9 5 6 9 6 16 A6 6 0 0 0 12 22 Z"/>' },
  { id: 'snowflake', label: 'Cold', body: '<line x1="12" y1="3" x2="12" y2="21"/><line x1="4.2" y1="7.5" x2="19.8" y2="16.5"/><line x1="4.2" y1="16.5" x2="19.8" y2="7.5"/>' },
  { id: 'box', label: 'Box', body: '<path d="M3 8 L12 3.5 L21 8 v8 L12 20.5 L3 16 Z"/><path d="M3 8 L12 12.5 L21 8"/><line x1="12" y1="12.5" x2="12" y2="20.5"/>' },
  { id: 'tag', label: 'Tag', body: '<path d="M3 11 V4 h7 l11 11 -7 7 Z"/><circle cx="7" cy="8" r="1.4"/>' },
  { id: 'home', label: 'Home', body: '<path d="M3 11 L12 3 L21 11"/><path d="M5.5 9.5 V20 h13 V9.5"/>' },
  { id: 'clock', label: 'Clock', body: '<circle cx="12" cy="12" r="9"/><polyline points="12 6.5 12 12 16 14"/>' },
  { id: 'calendar', label: 'Date', body: '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>' },
  { id: 'mail', label: 'Mail', body: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><polyline points="2.5 7 12 13.5 21.5 7"/>' },
  { id: 'user', label: 'Person', body: '<circle cx="12" cy="8" r="4"/><path d="M4 21 a8 8 0 0 1 16 0"/>' },
  { id: 'trash', label: 'Waste', body: '<polyline points="3.5 6 20.5 6"/><path d="M6 6 v14 a2 2 0 0 0 2 2 h8 a2 2 0 0 0 2 -2 V6"/><path d="M9 6 V4 a1.5 1.5 0 0 1 1.5 -1.5 h3 A1.5 1.5 0 0 1 15 4 v2"/>' },
  { id: 'battery', label: 'Battery', body: '<rect x="2" y="8" width="17" height="9" rx="2"/><line x1="21" y1="11" x2="21" y2="14"/>' },
  { id: 'power', label: 'Power', body: '<path d="M7.5 6.5 a7.5 7.5 0 1 0 9 0"/><line x1="12" y1="2.5" x2="12" y2="11"/>' },
  { id: 'sun', label: 'Sun', body: '<circle cx="12" cy="12" r="4.5"/><line x1="12" y1="1.5" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22.5"/><line x1="1.5" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22.5" y2="12"/><line x1="4.6" y1="4.6" x2="6.4" y2="6.4"/><line x1="17.6" y1="17.6" x2="19.4" y2="19.4"/><line x1="19.4" y1="4.6" x2="17.6" y2="6.4"/><line x1="6.4" y1="17.6" x2="4.6" y2="19.4"/>' },
  { id: 'moon', label: 'Night', body: '<path d="M20 14.5 A9 9 0 0 1 9.5 4 A9 9 0 1 0 20 14.5 Z"/>' },
  { id: 'leaf', label: 'Organic', body: '<path d="M4 20 C4 10 10 4 20 4 C20 14 14 20 4 20 Z"/><line x1="4" y1="20" x2="14" y2="10"/>' },
  { id: 'bell', label: 'Alert', body: '<path d="M6 10 a6 6 0 0 1 12 0 c0 5 2 6 2 6 H4 s2 -1 2 -6"/><path d="M10 20 a2 2 0 0 0 4 0"/>' },
  { id: 'up-arrows', label: 'This way up', body: '<polyline points="6 11 12 5 18 11"/><polyline points="6 19 12 13 18 19"/>' },
  { id: 'fragile', label: 'Fragile', body: '<path d="M8 3 h8 l-1 7 a3 3 0 0 1 -6 0 Z"/><line x1="12" y1="13" x2="12" y2="20"/><line x1="8" y1="21" x2="16" y2="21"/>' },
]

export const ICON_IDS = ICONS.map((i) => i.id)

export function findIcon(id: string): IconDef | undefined {
  return ICONS.find((i) => i.id === id)
}

/**
 * Build a standalone SVG for an icon at a given size in dots.
 *
 * Stroke width is expressed in the 24-unit coordinate space and scales with the
 * icon, then is floored to keep it from thinning below a dot at small sizes —
 * a hairline that rounds away leaves gaps in the printed outline.
 */
export function iconToSvg(icon: IconDef, sizeDots: number, strokeScale = 1): string {
  const minStrokeUnits = (24 / Math.max(sizeDots, 1)) * 1.2
  const strokeWidth = Math.max(2 * strokeScale, minStrokeUnits)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${sizeDots}" height="${sizeDots}">` +
    `<g fill="${icon.filled ? '#000' : 'none'}" stroke="#000" stroke-width="${strokeWidth}" ` +
    `stroke-linecap="round" stroke-linejoin="round">${icon.body}</g></svg>`
  )
}

export function iconToDataUrl(icon: IconDef, sizeDots: number, strokeScale = 1): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconToSvg(icon, sizeDots, strokeScale))}`
}
