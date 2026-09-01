/**
 * The keyboard shortcuts, written down where the editor is.
 *
 * Collapsed by default and folded into the same disclosure the other panels use, so
 * it costs a line rather than a block. The summary still names the common ones,
 * which is the point: a user who never opens it has still seen that Ctrl+Z and
 * Ctrl+C work here.
 *
 * Kept as data rather than markup so the list cannot drift into two columns of
 * different lengths, and so the one place to add a key when the handler in `App`
 * gains one is obvious.
 */

const GROUPS: Array<{ heading: string; keys: Array<[string, string]> }> = [
  {
    heading: 'Edit',
    keys: [
      ['Ctrl+C', 'Copy'],
      ['Ctrl+X', 'Cut'],
      ['Ctrl+V', 'Paste'],
      ['Ctrl+D', 'Duplicate'],
      ['Delete', 'Remove the selection'],
    ],
  },
  {
    heading: 'History',
    keys: [
      ['Ctrl+Z', 'Undo'],
      ['Ctrl+Shift+Z', 'Redo'],
      ['Ctrl+Y', 'Redo'],
    ],
  },
  {
    heading: 'View',
    keys: [
      ['Ctrl+plus', 'Zoom in'],
      ['Ctrl+minus', 'Zoom out'],
      ['Ctrl+scroll', 'Zoom smoothly'],
      ['Ctrl+0', 'Fit to the panel'],
      ['Esc', 'Deselect'],
    ],
  },
]

export function Shortcuts() {
  return (
    <details className="advanced shortcuts">
      <summary>
        Keyboard shortcuts
        <span className="advanced__hint">copy, paste, undo, zoom &mdash; the usual ones</span>
      </summary>
      <div className="advanced__body shortcuts__body">
        {GROUPS.map((group) => (
          <div key={group.heading} className="shortcuts__group">
            <h4 className="shortcuts__heading">{group.heading}</h4>
            <dl className="shortcuts__list">
              {group.keys.map(([combination, meaning]) => (
                <div key={combination + meaning} className="shortcuts__row">
                  <dt>
                    {/* Split so each key gets its own cap, with the separator
                        outside them — "Ctrl+Shift+Z" in one cap reads as a single
                        enormous key. */}
                    {combination.split('+').map((part, index) => (
                      <span key={part}>
                        {index > 0 && <span className="shortcuts__plus">+</span>}
                        <kbd>{part}</kbd>
                      </span>
                    ))}
                  </dt>
                  <dd>{meaning}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        <p className="shortcuts__note">
          Pinching a trackpad over the editor zooms it too. Shortcuts pause while a text field or an
          element on the canvas is being typed into, so Delete removes a character there rather than
          the whole element.
        </p>
      </div>
    </details>
  )
}
