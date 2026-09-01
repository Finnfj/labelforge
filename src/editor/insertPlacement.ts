import type { DraftElement } from '../model/labelDoc'

/**
 * How far a turned view rotates what is on it, in degrees clockwise.
 *
 * From `EditorCanvas`'s viewport transform: document +x runs down the screen and
 * document +y runs left, which is content turned a quarter turn clockwise. An
 * element with no rotation of its own therefore reads top-to-bottom on a turned
 * canvas.
 */
const VIEW_TURN_DEGREES = 90

/** Where a new element sits from the corner it is placed against, in mm. */
const MARGIN_MM = 2

/**
 * Place a new element so it reads upright on a turned canvas.
 *
 * Turning the canvas is a view choice, but inserting into it is not: a user
 * working in the turned frame is thinking in that frame, and text that arrives
 * lying on its side has to be rotated by hand every single time. So an element
 * inserted while the canvas is turned gets the counter-rotation that cancels the
 * view out, and it appears the way the toolbar button implies.
 *
 * That does mean the element is genuinely rotated in the document, and so on the
 * printed label — which is the point. The label is being designed in the turned
 * frame. The Inspector's Rotation field undoes it for anyone who wanted otherwise.
 *
 * ## Why the position moves too
 *
 * Elements rotate about their centre (see `placement()` in `render/toFabric.ts`),
 * so counter-rotating alone would leave a wide text box hanging off the top of the
 * label: 24 mm of text at y = 2 spins to occupy y = -7 to 17. Correct on screen,
 * a third of it off the paper.
 *
 * A quarter turn swaps the element's footprint, so a w x h element covers h x w of
 * label. Putting that footprint's corner a margin in from the label's bottom-left
 * — which is the corner a turned canvas shows at its top left — lands the element
 * where the top-left of the screen is, upright, wholly on the label.
 *
 * `x`/`y` stay what the document means by them, the *unrotated* top-left, so they
 * come out offset from the footprint and can even go negative on a wide element.
 * That is bookkeeping, not a bug: the footprint is what is on the paper.
 */
export function placeForTurnedView(
  draft: DraftElement,
  labelHeightMm: number,
  marginMm = MARGIN_MM,
): DraftElement {
  const { widthMm: w, heightMm: h } = draft
  // The footprint after the turn: h across the label, w down it.
  const footprintX = marginMm
  // Clamped, because an element longer than the label is short is not placeable
  // against that corner at all — better flush with the edge than off it.
  const footprintY = Math.max(0, labelHeightMm - w - marginMm)
  return {
    ...draft,
    rotation: normalise(draft.rotation - VIEW_TURN_DEGREES),
    // Centre of the footprint, less half the *unrotated* size.
    x: footprintX + (h - w) / 2,
    y: footprintY + (w - h) / 2,
  }
}

/** Into [0, 360), so the Inspector shows 270 rather than -90. */
function normalise(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}
