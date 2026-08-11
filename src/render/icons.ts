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
  /** Heading the picker files this under. */
  group: IconGroup
}

export type IconGroup =
  | 'Arrows'
  | 'Marks'
  | 'Shapes'
  | 'Rights & licences'
  | 'Handling'
  | 'Hazard'
  | 'Conditions'
  | 'Care'
  | 'Tech'
  | 'Objects'

export const ICONS: IconDef[] = [
  {
    id: 'arrow-right',
    group: 'Arrows',
    label: 'Arrow right',
    body: '<line x1="3" y1="12" x2="20" y2="12"/><polyline points="14 6 20 12 14 18"/>',
  },
  {
    id: 'arrow-left',
    group: 'Arrows',
    label: 'Arrow left',
    body: '<line x1="21" y1="12" x2="4" y2="12"/><polyline points="10 6 4 12 10 18"/>',
  },
  {
    id: 'arrow-up',
    group: 'Arrows',
    label: 'Arrow up',
    body: '<line x1="12" y1="21" x2="12" y2="4"/><polyline points="6 10 12 4 18 10"/>',
  },
  {
    id: 'arrow-down',
    group: 'Arrows',
    label: 'Arrow down',
    body: '<line x1="12" y1="3" x2="12" y2="20"/><polyline points="6 14 12 20 18 14"/>',
  },
  { id: 'check', group: 'Marks', label: 'Check', body: '<polyline points="3 13 9 19 21 5"/>' },
  {
    id: 'cross',
    group: 'Marks',
    label: 'Cross',
    body: '<line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>',
  },
  {
    id: 'plus',
    group: 'Marks',
    label: 'Plus',
    body: '<line x1="12" y1="4" x2="12" y2="20"/><line x1="4" y1="12" x2="20" y2="12"/>',
  },
  { id: 'minus', group: 'Marks', label: 'Minus', body: '<line x1="4" y1="12" x2="20" y2="12"/>' },
  {
    id: 'warning',
    group: 'Marks',
    label: 'Warning',
    body: '<path d="M12 3 L22 20 L2 20 Z"/><line x1="12" y1="9" x2="12" y2="14"/><line x1="12" y1="17" x2="12" y2="17.01"/>',
  },
  {
    id: 'info',
    group: 'Marks',
    label: 'Info',
    body: '<circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="12" y1="7" x2="12" y2="7.01"/>',
  },
  { id: 'circle', group: 'Shapes', label: 'Circle', body: '<circle cx="12" cy="12" r="9"/>' },
  {
    id: 'square',
    group: 'Shapes',
    label: 'Square',
    body: '<rect x="3" y="3" width="18" height="18" rx="2"/>',
  },
  { id: 'triangle', group: 'Shapes', label: 'Triangle', body: '<path d="M12 3 L22 20 L2 20 Z"/>' },
  {
    id: 'star',
    group: 'Shapes',
    label: 'Star',
    body: '<path d="M12 3 L14.8 9.3 L21.5 10 L16.5 14.5 L18 21 L12 17.6 L6 21 L7.5 14.5 L2.5 10 L9.2 9.3 Z"/>',
  },
  {
    id: 'heart',
    group: 'Shapes',
    label: 'Heart',
    body: '<path d="M12 20 C5 15.5 2.5 12 2.5 8.8 A4.6 4.6 0 0 1 12 6.6 A4.6 4.6 0 0 1 21.5 8.8 C21.5 12 19 15.5 12 20 Z"/>',
  },
  {
    id: 'lock',
    group: 'Marks',
    label: 'Lock',
    body: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10 V7 a4 4 0 0 1 8 0 v3"/>',
  },
  {
    id: 'thermometer',
    group: 'Conditions',
    label: 'Temperature',
    body: '<path d="M14 14.8 V4 a2 2 0 0 0 -4 0 v10.8 a4 4 0 1 0 4 0 Z"/>',
  },
  {
    id: 'droplet',
    group: 'Conditions',
    label: 'Moisture',
    body: '<path d="M12 3 C12 3 5 10.5 5 14.5 A7 7 0 0 0 19 14.5 C19 10.5 12 3 12 3 Z"/>',
  },
  {
    id: 'flame',
    group: 'Hazard',
    label: 'Flammable',
    // The kink at the left is what makes this read as a flame rather than a
    // droplet, which is how the earlier all-smooth curve came out.
    body: '<path d="M13 2 C9.5 5 8 8 8.5 11 C7.5 10.5 7 9.5 6.8 8.5 C5 10.5 4.5 13 4.5 15 A7.5 7.5 0 0 0 19.5 15 C19.5 10.5 15 8 13 2 Z"/>',
  },
  {
    id: 'snowflake',
    group: 'Conditions',
    label: 'Cold',
    body: '<line x1="12" y1="3" x2="12" y2="21"/><line x1="4.2" y1="7.5" x2="19.8" y2="16.5"/><line x1="4.2" y1="16.5" x2="19.8" y2="7.5"/>',
  },
  {
    id: 'box',
    group: 'Handling',
    label: 'Box',
    body: '<path d="M3 8 L12 3.5 L21 8 v8 L12 20.5 L3 16 Z"/><path d="M3 8 L12 12.5 L21 8"/><line x1="12" y1="12.5" x2="12" y2="20.5"/>',
  },
  {
    id: 'tag',
    group: 'Objects',
    label: 'Tag',
    body: '<path d="M3 11 V4 h7 l11 11 -7 7 Z"/><circle cx="7" cy="8" r="1.4"/>',
  },
  {
    id: 'home',
    group: 'Objects',
    label: 'Home',
    body: '<path d="M3 11 L12 3 L21 11"/><path d="M5.5 9.5 V20 h13 V9.5"/>',
  },
  {
    id: 'clock',
    group: 'Objects',
    label: 'Clock',
    body: '<circle cx="12" cy="12" r="9"/><polyline points="12 6.5 12 12 16 14"/>',
  },
  {
    id: 'calendar',
    group: 'Objects',
    label: 'Date',
    body: '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
  },
  {
    id: 'mail',
    group: 'Objects',
    label: 'Mail',
    body: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><polyline points="2.5 7 12 13.5 21.5 7"/>',
  },
  {
    id: 'user',
    group: 'Objects',
    label: 'Person',
    body: '<circle cx="12" cy="8" r="4"/><path d="M4 21 a8 8 0 0 1 16 0"/>',
  },
  {
    id: 'trash',
    group: 'Objects',
    label: 'Waste',
    body: '<polyline points="3.5 6 20.5 6"/><path d="M6 6 v14 a2 2 0 0 0 2 2 h8 a2 2 0 0 0 2 -2 V6"/><path d="M9 6 V4 a1.5 1.5 0 0 1 1.5 -1.5 h3 A1.5 1.5 0 0 1 15 4 v2"/>',
  },
  {
    id: 'battery',
    group: 'Objects',
    label: 'Battery',
    body: '<rect x="2" y="8" width="17" height="9" rx="2"/><line x1="21" y1="11" x2="21" y2="14"/>',
  },
  {
    id: 'power',
    group: 'Objects',
    label: 'Power',
    body: '<path d="M7.5 6.5 a7.5 7.5 0 1 0 9 0"/><line x1="12" y1="2.5" x2="12" y2="11"/>',
  },
  {
    id: 'sun',
    group: 'Conditions',
    label: 'Sun',
    body: '<circle cx="12" cy="12" r="4.5"/><line x1="12" y1="1.5" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22.5"/><line x1="1.5" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22.5" y2="12"/><line x1="4.6" y1="4.6" x2="6.4" y2="6.4"/><line x1="17.6" y1="17.6" x2="19.4" y2="19.4"/><line x1="19.4" y1="4.6" x2="17.6" y2="6.4"/><line x1="6.4" y1="17.6" x2="4.6" y2="19.4"/>',
  },
  {
    id: 'moon',
    group: 'Conditions',
    label: 'Night',
    body: '<path d="M20 14.5 A9 9 0 0 1 9.5 4 A9 9 0 1 0 20 14.5 Z"/>',
  },
  {
    id: 'leaf',
    group: 'Care',
    label: 'Organic',
    body: '<path d="M4 20 C4 10 10 4 20 4 C20 14 14 20 4 20 Z"/><line x1="4" y1="20" x2="14" y2="10"/>',
  },
  {
    id: 'bell',
    group: 'Marks',
    label: 'Alert',
    body: '<path d="M6 10 a6 6 0 0 1 12 0 c0 5 2 6 2 6 H4 s2 -1 2 -6"/><path d="M10 20 a2 2 0 0 0 4 0"/>',
  },
  {
    id: 'up-arrows',
    group: 'Handling',
    label: 'This way up',
    body: '<polyline points="6 11 12 5 18 11"/><polyline points="6 19 12 13 18 19"/>',
  },
  {
    id: 'fragile',
    group: 'Handling',
    label: 'Fragile',
    body: '<path d="M8 3 h8 l-1 7 a3 3 0 0 1 -6 0 Z"/><line x1="12" y1="13" x2="12" y2="20"/><line x1="8" y1="21" x2="16" y2="21"/>',
  },

  // --- Rights & licences --------------------------------------------------
  // The whole family, since the useful thing about these is having the right one
  // to hand. Each is a ring plus one simple inner glyph, which is also the only
  // way this sort of mark survives a thermal head: the official artwork has fine
  // lettering that closes up into a blob well before 10 mm.
  //
  // Copyleft and copyright differ *only* in which side the C opens, so the two
  // arcs are deliberately written as mirror images of each other — if one is ever
  // edited, the other has to move with it.
  {
    id: 'copyright',
    group: 'Rights & licences',
    label: 'Copyright',
    body: '<circle cx="12" cy="12" r="9"/><path d="M15.2 8.8 A4.5 4.5 0 1 0 15.2 15.2"/>',
  },
  {
    id: 'copyleft',
    group: 'Rights & licences',
    label: 'Copyleft',
    body: '<circle cx="12" cy="12" r="9"/><path d="M8.8 8.8 A4.5 4.5 0 1 1 8.8 15.2"/>',
  },
  {
    id: 'registered',
    group: 'Rights & licences',
    label: 'Registered trademark',
    body: '<circle cx="12" cy="12" r="9"/><path d="M10 16.5 V7.5 h3.2 a2.3 2.3 0 0 1 0 4.6 H10"/><line x1="12.7" y1="12.1" x2="15" y2="16.5"/>',
  },
  {
    id: 'trademark',
    group: 'Rights & licences',
    label: 'Trademark',
    body: '<path d="M3.5 8 h6"/><path d="M6.5 8 v8"/><path d="M12.5 16 V8 l2.75 5 L18 8 v8"/>',
  },
  {
    id: 'cc',
    group: 'Rights & licences',
    label: 'Creative Commons',
    body: '<circle cx="12" cy="12" r="9"/><path d="M10.5 10.2 A2.5 2.5 0 1 0 10.5 13.8"/><path d="M17.1 10.2 A2.5 2.5 0 1 0 17.1 13.8"/>',
  },
  {
    id: 'cc-by',
    group: 'Rights & licences',
    label: 'Attribution (BY)',
    body: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="8.2" r="1.9"/><path d="M8.4 18.4 a3.6 3.6 0 0 1 7.2 0"/>',
  },
  {
    id: 'cc-sa',
    group: 'Rights & licences',
    label: 'Share-alike (SA)',
    body: '<circle cx="12" cy="12" r="9"/><path d="M7.2 14.6 A4.9 4.9 0 1 1 16.8 14.6"/><polyline points="14.3 13.1 16.8 14.7 18 12.1"/>',
  },
  {
    id: 'cc-nc',
    group: 'Rights & licences',
    label: 'Non-commercial (NC)',
    body: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.6 a2.7 2.7 0 0 0 -5.2 0.9 c0.3 2.4 5.2 1.2 5.2 3.6 a2.7 2.7 0 0 1 -5.2 0.9"/><line x1="6.5" y1="17.5" x2="17.5" y2="6.5"/>',
  },
  {
    id: 'cc-nd',
    group: 'Rights & licences',
    label: 'No derivatives (ND)',
    body: '<circle cx="12" cy="12" r="9"/><line x1="7.5" y1="10" x2="16.5" y2="10"/><line x1="7.5" y1="14" x2="16.5" y2="14"/>',
  },
  {
    id: 'cc-zero',
    group: 'Rights & licences',
    label: 'CC0 / no rights reserved',
    body: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="3.2" ry="4.6"/>',
  },
  {
    id: 'public-domain',
    group: 'Rights & licences',
    label: 'Public domain',
    body: '<circle cx="12" cy="12" r="9"/><path d="M15.2 8.8 A4.5 4.5 0 1 0 15.2 15.2"/><line x1="5.6" y1="18.4" x2="18.4" y2="5.6"/>',
  },

  // --- Additions to the existing groups -----------------------------------
  {
    id: 'prohibited',
    group: 'Marks',
    label: 'Prohibited',
    body: '<circle cx="12" cy="12" r="9"/><line x1="5.6" y1="18.4" x2="18.4" y2="5.6"/>',
  },
  {
    id: 'no-entry',
    group: 'Marks',
    label: 'No entry',
    body: '<circle cx="12" cy="12" r="9"/><line x1="6.5" y1="12" x2="17.5" y2="12"/>',
  },
  {
    id: 'keep-dry',
    group: 'Handling',
    label: 'Keep dry',
    body: '<path d="M3.5 12 a8.5 8.5 0 0 1 17 0 Z"/><path d="M12 12 v6.3 a2.2 2.2 0 0 0 4.4 0"/><line x1="5" y1="15" x2="4" y2="18"/><line x1="8.5" y1="16" x2="7.5" y2="19"/>',
  },
  {
    id: 'no-stack',
    group: 'Handling',
    label: 'Do not stack',
    body: '<rect x="5" y="13.5" width="14" height="6.5" rx="1"/><rect x="5" y="4.5" width="14" height="6.5" rx="1"/><line x1="3.5" y1="20.5" x2="20.5" y2="4"/>',
  },
  {
    id: 'high-voltage',
    group: 'Hazard',
    label: 'High voltage',
    body: '<path d="M12 3 L22 20 L2 20 Z"/><path d="M13.4 7.5 L9.5 14 h3 l-1.4 5 4.2 -7 h-3 Z"/>',
  },
  {
    id: 'bolt',
    group: 'Hazard',
    label: 'Electrical',
    body: '<path d="M14.5 2 L6 13.5 h5 L9 22 l9 -12 h-5.2 Z"/>',
  },
  {
    id: 'no-water',
    group: 'Conditions',
    label: 'Keep away from water',
    body: '<path d="M12 3 C12 3 5 10.5 5 14.5 A7 7 0 0 0 19 14.5 C19 10.5 12 3 12 3 Z"/><line x1="4" y1="20" x2="20" y2="4"/>',
  },
  {
    id: 'wash',
    group: 'Care',
    label: 'Washable',
    body: '<path d="M3.5 8.5 h17 l-2 11 H5.5 Z"/><path d="M6.5 12.5 q2.75 -2 5.5 0 t5.5 0"/>',
  },
  {
    id: 'iron',
    group: 'Care',
    label: 'Iron',
    body: '<path d="M3 16.5 h18 l-2 -5.5 H8 a5 5 0 0 0 -5 5.5 Z"/><line x1="3" y1="19.5" x2="21" y2="19.5"/>',
  },
  {
    id: 'microwave',
    group: 'Care',
    label: 'Microwave safe',
    body: '<rect x="2.5" y="5.5" width="19" height="13" rx="2"/><line x1="16" y1="5.5" x2="16" y2="18.5"/><path d="M5 12 q1.5 -2.5 3 0 t3 0"/>',
  },
  {
    id: 'dishwasher',
    group: 'Care',
    label: 'Dishwasher safe',
    body: '<circle cx="12" cy="14" r="6.5"/><circle cx="12" cy="14" r="2.4"/><line x1="8" y1="3.5" x2="8" y2="6"/><line x1="12" y1="2.5" x2="12" y2="5"/><line x1="16" y1="3.5" x2="16" y2="6"/>',
  },
  {
    id: 'wifi',
    group: 'Tech',
    label: 'Wi-Fi',
    body: '<path d="M3.5 10 a12 12 0 0 1 17 0"/><path d="M7.2 13.6 a7 7 0 0 1 9.6 0"/><circle cx="12" cy="18.2" r="1.4"/>',
  },
  {
    id: 'bluetooth',
    group: 'Tech',
    label: 'Bluetooth',
    body: '<path d="M8 6.8 L16 17.2 L12 20.5 V3.5 L16 6.8 L8 17.2"/>',
  },
  {
    id: 'usb',
    group: 'Tech',
    label: 'USB',
    body: '<line x1="12" y1="21.5" x2="12" y2="6"/><circle cx="12" cy="3.8" r="1.7"/><path d="M12 14.5 L7.5 10 V7.5 h3"/><path d="M12 11.5 L16.5 7.2 h2.6 v3"/>',
  },
  {
    id: 'plug',
    group: 'Tech',
    label: 'Mains power',
    body: '<line x1="9" y1="2.5" x2="9" y2="8"/><line x1="15" y1="2.5" x2="15" y2="8"/><path d="M6 8 h12 v3 a6 6 0 0 1 -12 0 Z"/><line x1="12" y1="17" x2="12" y2="21.5"/>',
  },
  {
    id: 'key',
    group: 'Objects',
    label: 'Key',
    body: '<circle cx="7.5" cy="12" r="4"/><line x1="11.5" y1="12" x2="21" y2="12"/><line x1="17.5" y1="12" x2="17.5" y2="16"/><line x1="20" y1="12" x2="20" y2="15"/>',
  },
  {
    id: 'scissors',
    group: 'Objects',
    label: 'Cut here',
    body: '<circle cx="6.5" cy="18" r="2.4"/><circle cx="6.5" cy="6" r="2.4"/><line x1="8.7" y1="16.9" x2="20" y2="5"/><line x1="8.7" y1="7.1" x2="20" y2="19"/>',
  },
  {
    id: 'phone',
    group: 'Objects',
    label: 'Phone',
    body: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><line x1="10" y1="18.5" x2="14" y2="18.5"/>',
  },
  {
    id: 'pin',
    group: 'Objects',
    label: 'Location',
    body: '<path d="M12 21.5 C12 21.5 19 14.5 19 10 A7 7 0 1 0 5 10 C5 14.5 12 21.5 12 21.5 Z"/><circle cx="12" cy="10" r="2.5"/>',
  },
  {
    id: 'printer',
    group: 'Objects',
    label: 'Printer',
    body: '<path d="M7 8 V3.5 h10 V8"/><rect x="3" y="8" width="18" height="8" rx="2"/><path d="M7 16 v4.5 h10 V16"/>',
  },
  {
    id: 'ruler',
    group: 'Objects',
    label: 'Ruler',
    body: '<rect x="2" y="8" width="20" height="8" rx="1.5"/><line x1="6.5" y1="8" x2="6.5" y2="12"/><line x1="11" y1="8" x2="11" y2="12"/><line x1="15.5" y1="8" x2="15.5" y2="12"/><line x1="19" y1="8" x2="19" y2="12"/>',
  },
  {
    id: 'weight',
    group: 'Objects',
    label: 'Weight',
    body: '<path d="M6 20 L8 8 h8 l2 12 Z"/><path d="M9.5 8 a2.5 2.5 0 0 1 5 0"/>',
  },
  {
    id: 'barcode',
    group: 'Objects',
    label: 'Barcode',
    body: '<line x1="4" y1="5" x2="4" y2="19"/><line x1="7.5" y1="5" x2="7.5" y2="19"/><line x1="11" y1="5" x2="11" y2="19"/><line x1="14.5" y1="5" x2="14.5" y2="19"/><line x1="17.5" y1="5" x2="17.5" y2="19"/><line x1="20.5" y1="5" x2="20.5" y2="19"/>',
  },
]

/** Groups in the order the pickers should show them. */
export const ICON_GROUPS: IconGroup[] = [...new Set(ICONS.map((i) => i.group))]

export function iconsByGroup(): Array<{ group: IconGroup; icons: IconDef[] }> {
  return ICON_GROUPS.map((group) => ({ group, icons: ICONS.filter((i) => i.group === group) }))
}

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
