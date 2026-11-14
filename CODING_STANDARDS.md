# Coding standards

Read during review. These are the judgement calls; mechanical rules live in the
checks CI runs (`lint`, `format:check`, `check:layering`, `check:paths`, `check:copy`,
the tests).

## Domain language

- A name, comment or sentence that uses a [`GLOSSARY.md`](GLOSSARY.md) term means
  exactly that term, and never a word from the entry's _Avoid_ line. A thing the
  glossary has no term for gets one, added to the glossary in the same change: a band
  is never called a chunk, because a chunk is one Bluetooth write and a band is a
  slice of the label sent as a job of its own.

## Comments

- A comment says why: the evidence behind the code (a capture, a measurement, the
  vendor SDK, a hardware trial) and the failure it prevents. A protocol fact carries
  its evidence tier (see GLOSSARY.md).
- A change to behaviour changes the comments that describe it, in the same diff. A
  comment that describes the old behaviour is a defect.

## Tests

- Test names are plain-English sentences about behaviour: "waits for each band
  before sending the next".
- Bytes on the wire are pinned absolutely, never only relative to another driver: in
  the wire snapshots (`src/printer/drivers/__snapshots__/`) or the vendor goldens
  (`src/printer/dialects/x2/__fixtures__/`).
- Tests cross the module's interface. What a dialect sends is tested on the dialect;
  what a driver (`src/printer/drivers/`) does with a print plan is tested with the
  test dialect.

## Copy the user reads

- Copy claims only what the code knows. A number shown comes from the same source the
  behaviour uses, and "could" stays "could" where the code cannot say "will".
- Copy that applies to any printer names no printer model, and no feature only some
  printers have: bands, a gap seek, a density setting. `check:copy` catches a model's
  name; the feature is for review.

## Moved and ported code

- A change that moves, ports or rewrites code compares it with the original, and
  accounts for every behaviour the original had: kept, or dropped with the reason. A
  guard that does not survive the move is the defect to look for.
