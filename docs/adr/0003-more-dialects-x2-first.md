# Drive more than one dialect, starting with x2

MarkLife printers speak at least two dialects. LabelForge is meant to drive more than
one, but implements only x2 for now. A printer of a dialect the app cannot drive is
recognised by its advertised name and refused with a reason, never guessed at. That
refusal holds until the dialect is supported, not permanently.

A dialect not confirmed on our own hardware ships only behind an opt-in under
Diagnostics, labelled experimental. Without the opt-in its printers stay refused, so
nobody sends untested bytes to a printer by accident.

Where the line falls between dialect-neutral code and what each dialect supplies is
not decided here. The architecture work that prepares for a second dialect finds it
and records it in this ADR.
