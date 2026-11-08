# Coding standards

Read during review. These are the judgement calls; mechanical rules live in the
checks CI runs (`lint`, `format:check`, `check:layering`, `check:paths`, the tests).

## Domain language

- A name, comment or sentence that uses a [`GLOSSARY.md`](GLOSSARY.md) term means
  exactly that term. A different thing gets a term of its own, added to the glossary
  in the same change: the planner's split threshold is the **band budget**, not the
  printer's **read-ahead**.
- Use the glossary's words, and none from an entry's _Avoid_ line: a band is never a
  "part", a job is never a "transfer", a gap seek is never "alignment".
- **Seam** is the paper join between two bands. The code-design sense of the word is
  an **interface**.

## Comments

- A comment says why: the evidence behind the code (a capture, a measurement, the
  vendor SDK, a hardware trial) and the failure it prevents. A protocol fact carries
  its evidence tier, as `docs/PROTOCOL.md` does.
- A change to behaviour changes the comments that describe it, in the same diff. A
  comment that describes the old behaviour is a defect.

## Tests

- Test names are plain-English sentences about behaviour: "waits for each band
  before sending the next".
- Bytes on the wire are pinned absolutely, in the wire snapshots or the vendor
  goldens, never only relative to another driver.
- Tests cross the module's interface. What a dialect sends is tested on the dialect;
  what a driver does with a plan is tested with the test dialect.

## Copy the user reads

- Copy claims only what the code knows. A number shown comes from the same source the
  behaviour uses, and "could" stays "could" where the code cannot say "will".
- Copy that applies to any printer names no printer model.

## Dialects

- x2's bytes, limits and paper physics live under `src/printer/dialects/x2/`.
  Everything else asks the dialect, through the interface ADR 0003 describes.
