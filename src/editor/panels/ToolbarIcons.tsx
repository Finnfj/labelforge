/**
 * Line icons for the toolbar.
 *
 * Inline SVG rather than a font or a package: there are eleven of them, they are a
 * dozen path commands each, and a bundled icon set would be a megabyte to avoid
 * writing that. They inherit `currentColor` and size from the button, so a disabled
 * or hovered button carries its icon with it.
 *
 * Deliberately separate from `render/icons.ts`, which is the *label* symbol
 * library — those get rasterised onto paper and are chosen by the user. These are
 * chrome, and the two must not be confused: adding to the wrong one either puts
 * furniture on a label or a barcode glyph in the toolbar.
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

/** An element stepping up out of the stack, which is what "forward" means here. */
export const ForwardIcon = () => (
  <Icon label="Forward">
    <rect x="7" y="2.5" width="10" height="7" rx="1.5" {...STROKE} />
    <path d="M3 7.5h2.5V17H13v-2.5" {...STROKE} />
  </Icon>
)

export const BackwardIcon = () => (
  <Icon label="Backward">
    <rect x="3" y="10.5" width="10" height="7" rx="1.5" {...STROKE} />
    <path d="M17 12.5h-2.5V3H7v2.5" {...STROKE} />
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
