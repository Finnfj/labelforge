/**
 * Line icons for the toolbar.
 *
 * Inline SVG rather than a font or a package: there are thirteen of them, they are
 * a dozen path commands each, and a bundled icon set would be a megabyte to avoid
 * writing that. They inherit `currentColor` and size from the button, so a disabled
 * or hovered button carries its icon with it.
 *
 * Deliberately separate from `render/icons.ts`, which is the *label* symbol
 * library — those get rasterised onto paper and are chosen by the user. These are
 * chrome, and the two must not be confused: adding to the wrong one either puts
 * furniture on a label or a barcode glyph in the toolbar.
 *
 * Everything is drawn as geometry rather than set as text, including the T. A glyph
 * would render differently on every platform and depend on a serif face being
 * installed, which for a 18 px icon is the difference between crisp and blurry.
 */

const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function Icon({ children, label }: { children: React.ReactNode; label: string }) {
  // `aria-hidden` because every button that uses one carries the same text in its
  // `aria-label`; announcing both would read the action out twice.
  return (
    <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
      <title>{label}</title>
      {children}
    </svg>
  )
}

/**
 * A slab-serif T, which is what every design tool uses for its text tool.
 *
 * One filled outline rather than a bar and a stem, so the serifs stay attached at
 * any size and there are no seams where two shapes meet.
 */
export const TextIcon = () => (
  <Icon label="Text">
    <path d="M3 3h14v2.6h-5.4v9.3h2.2V17H6.2v-2.1h2.2V5.6H3z" fill="currentColor" stroke="none" />
  </Icon>
)

export const RectIcon = () => (
  <Icon label="Rectangle">
    <rect x="3" y="5" width="14" height="10" rx="1.5" {...STROKE} />
  </Icon>
)

export const EllipseIcon = () => (
  <Icon label="Ellipse">
    <ellipse cx="10" cy="10" rx="7" ry="5.5" {...STROKE} />
  </Icon>
)

export const LineIcon = () => (
  <Icon label="Line">
    <path d="M3.5 15.5 16.5 4.5" {...STROKE} />
  </Icon>
)

/** Bars of uneven width, which is the one thing that says barcode and not grille. */
export const BarcodeIcon = () => (
  <Icon label="Barcode">
    <g fill="currentColor">
      <rect x="2.6" y="4" width="1.5" height="12" />
      <rect x="5.2" y="4" width="0.8" height="12" />
      <rect x="7.1" y="4" width="1.9" height="12" />
      <rect x="10.1" y="4" width="0.8" height="12" />
      <rect x="12" y="4" width="1.5" height="12" />
      <rect x="14.6" y="4" width="0.8" height="12" />
      <rect x="16.5" y="4" width="1" height="12" />
    </g>
  </Icon>
)

/** The three finder squares are what a reader recognises, so they carry the icon. */
export const QrIcon = () => (
  <Icon label="QR code">
    <g fill="currentColor">
      {[
        [2.5, 2.5],
        [12, 2.5],
        [2.5, 12],
      ].map(([x, y]) => (
        <path
          key={`${x}-${y}`}
          d={`M${x} ${y}h5.5v5.5H${x}z M${x + 1.4} ${y + 1.4}v2.7h2.7v-2.7z`}
          fillRule="evenodd"
        />
      ))}
      <rect x="12" y="12" width="2.3" height="2.3" />
      <rect x="15.7" y="12" width="1.8" height="1.8" />
      <rect x="15.2" y="15.7" width="2.3" height="1.8" />
      <rect x="12" y="15.9" width="1.8" height="1.6" />
    </g>
  </Icon>
)

export const ImageIcon = () => (
  <Icon label="Image">
    <rect x="2.5" y="4" width="15" height="12" rx="2" {...STROKE} />
    <circle cx="7" cy="8.2" r="1.5" {...STROKE} />
    <path d="M3.2 14.2 8 9.6l3 2.9 2.4-2 3.4 3.4" {...STROKE} />
  </Icon>
)

/** A star: the mark that says "one of a set of little pictures" in every picker. */
export const SymbolIcon = () => (
  <Icon label="Symbol">
    <path
      d="M10 2.6 12.3 7.3 17.5 8.1 13.75 11.75 14.6 16.9 10 14.5 5.4 16.9 6.25 11.75 2.5 8.1 7.7 7.3Z"
      {...STROKE}
    />
  </Icon>
)

export const DuplicateIcon = () => (
  <Icon label="Duplicate">
    <rect x="3" y="3" width="10" height="10" rx="1.5" {...STROKE} />
    <path d="M7 17h9a1 1 0 0 0 1-1V7" {...STROKE} />
  </Icon>
)

export const DeleteIcon = () => (
  <Icon label="Delete">
    <path d="M4 6h12M8 6V4h4v2M6.5 6l.7 10h5.6l.7-10" {...STROKE} />
  </Icon>
)

/**
 * Layering, as a shape with an arrow rather than two overlapping squares.
 *
 * The overlapping-squares convention needs one of them to occlude the other to read
 * at all, and occlusion means painting the button's own background into the icon —
 * which then shows as a hole the moment the button is hovered or disabled. An arrow
 * says the same thing in two strokes and survives every state.
 */
export const ForwardIcon = () => (
  <Icon label="Bring forward">
    <rect x="3" y="11" width="14" height="6" rx="1.5" {...STROKE} />
    <path d="M10 8.6V2.4M6.9 5.5 10 2.4l3.1 3.1" {...STROKE} />
  </Icon>
)

export const BackwardIcon = () => (
  <Icon label="Send backward">
    <rect x="3" y="3" width="14" height="6" rx="1.5" {...STROKE} />
    <path d="M10 11.4v6.2M6.9 14.5 10 17.6l3.1-3.1" {...STROKE} />
  </Icon>
)

export const UndoIcon = () => (
  <Icon label="Undo">
    <path d="M7 6.5H3.5V3M3.8 6.6A6.5 6.5 0 1 1 4 13.4" {...STROKE} />
  </Icon>
)

export const RedoIcon = () => (
  <Icon label="Redo">
    <path d="M13 6.5h3.5V3M16.2 6.6A6.5 6.5 0 1 0 16 13.4" {...STROKE} />
  </Icon>
)
