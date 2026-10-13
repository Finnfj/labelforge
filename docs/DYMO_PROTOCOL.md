# Dymo LetraTag LT-200B wire protocol

Working notes from Bluetooth HCI captures of the vendor Android app, cross-checked
against an independent clean-room implementation. Read `docs/PROTOCOL.md` first for
the capture procedure and for why evidence is graded rather than stated flatly — the
same discipline applies here.

**Evidence tiers differ from `PROTOCOL.md`'s four.** There is no vendor SDK to read for
this device. What exists is:

1. **Our own HCI captures** of the vendor Android app — four jobs across three
   capture sessions, reassembled and decoded with `scripts/parse-btsnoop.mjs`.
2. **[ysfchn/dymo-bluetooth](https://github.com/ysfchn/dymo-bluetooth)** (MIT), an
   independent Python implementation that drives this exact printer in production,
   with its own protocol write-up. See `docs/THIRD_PARTY.md` for the credit and
   licence note.

Where the two agree, that is two independently-reached conclusions corroborating each
other — stronger than either alone, and about as good as the evidence gets without a
driver of our own confirmed on hardware. Where they disagree, both the published claim
and our observed bytes are recorded, because a disagreement here is exactly the kind
of thing worth not quietly resolving in whichever direction seems more likely.
**Nothing below has been sent to a printer by this project** — there is still no Dymo
driver, only these notes.

## Device identity

**DYMO LetraTag LT-200B**, per ysfchn/dymo-bluetooth's compatibility list and matching
GATT profile (see "Transport"). A LetraTag advertises as `Letratag<MAC-without-colons>`
(confirmed in their `bluetooth.py`); our captures never show an advertising report for
it, only the GATT session, so this project has not independently observed the
advertised name — check the phone's paired-devices list to see it directly, which
needs no new capture.

The captured device's address, `10:b4:1d:81:fa:5a`, is **not** in
ysfchn/dymo-bluetooth's known Espressif MAC-prefix list (`58:CF:79`, `DC:54:75`,
`34:85:18` at time of writing). Not a contradiction — that list is user-submitted and
explicitly incomplete — but worth a line in case it matters later.

Printable area: **30 px** (of 32 physically addressable — see "Raster encoding"), at
200 DPI, ~7 mm/s print speed, label height 12 mm. At 200 DPI the 30 dots cover only
**~3.8 mm** of that 12 mm tape. The lid must be closed to print; an open lid or empty
cassette can still report success.

## Transport

Bluetooth **Low Energy** (GATT).

| Role                     | UUID                                   |
| ------------------------ | -------------------------------------- |
| Primary service          | `be3dd650-2b3d-42f1-99c1-f0f749dd0678` |
| Write — host to printer  | `be3dd651-2b3d-42f1-99c1-f0f749dd0678` |
| Notify — printer to host | `be3dd652-2b3d-42f1-99c1-f0f749dd0678` |
| Unused                   | `be3dd653-2b3d-42f1-99c1-f0f749dd0678` |

Matches ysfchn/dymo-bluetooth exactly. Their note: "`2b3d` part in the UUID may not be
future-proof, but so far all produced printers of the same model seem to share the
same UUID." The third characteristic is discovered in every capture of ours too, and
is confirmed by them as "not used in the actual vendor app" — not just unobserved.

Unlike the MarkLife family this app already drives, this is a genuine custom 128-bit
service, not a 16-bit UUID built on the Bluetooth base. The service's handle range
runs to `0xffff` — it's the last service in the GATT table.

**No credit/flow-control channel.** Pacing falls out of the write procedure itself:
every `Prepare Write Request` gets a `Prepare Write Response` echoing the handle,
offset and value back (standard ATT, not vendor-specific) before the next one is sent,
and every `Execute Write Request` gets an `Execute Write Response`.

**Chunking is a byte-counted sequence of independent characteristic writes, not one
long ATT write.** ysfchn/dymo-bluetooth's model (confirmed against our captures):
the 9-byte header (below) is sent as its own write, then the payload is split into
pieces of **at most 500 bytes**, each prefixed with a **1-byte sequence index**
(`0, 1, 2, …`) and written as its own GATT characteristic write — which is why each one
shows up as its own ATT queued-write transaction (`Prepare Write` × N → `Execute
Write`) in the capture: each ~500-byte piece exceeds the negotiated MTU on its own,
independently of the others. The **last** piece has the 2-byte magic value `12 34`
appended after its data.

One quirk their own code flags without explaining: the sequence index **skips 27**
— `index` for `index < 27`, `index + 1` thereafter (e.g. `…, 25, 26, 28, 29, …`). Their
comment: "not sure what is the purpose of this, but the original vendor app skips this
index, so we do the same here." Unconfirmed why; carried over as a fact to reproduce
rather than second-guess.

## Header

Every job — ours and theirs — opens with a fixed 9-byte header:

```
FF F0  MAGIC[2]  LENGTH[4, LE]  CHECKSUM[1]
```

- `FF F0`: constant preamble.
- `MAGIC`: constant `12 34`. The same two bytes recur appended to the last chunk (see
  above) and in the footer (see "Job framing") — one fixed value used in three places,
  not three different fields.
- `LENGTH`: little-endian length of everything that follows the header (the directive
  stream, below).
- `CHECKSUM`: sum of the preceding 8 header bytes, `& 0xFF`.

**Confirmed against all four of our captured jobs independently of their repo**: for
header bytes `FF F0 12 34` + `LENGTH`, `sum(first 8 bytes) & 0xFF` reproduces the
captured 9th byte exactly in every case (checksums `0x3d`, `0x59`, `0x44`, `0x3f` for
jobs of 1300, 2350, 3096 and 4114 bytes respectively) — this is what our earlier notes
called "byte 11, varies, does not track job size," now resolved.

## Job framing (directive stream)

After the header, a sequence of **directives** — each `ESC` (`0x1b`) followed by an
ASCII command character:

| Directive       | Char |  Byte  | Arguments                                                          |
| --------------- | :--: | :----: | ------------------------------------------------------------------ |
| `START`         | `s`  | `0x73` | 4 fixed bytes: `9A 02 00 00`                                       |
| `MEDIA_TYPE`    | `M`  | `0x4d` | 1 byte, cassette type (unused by the vendor app per their testing) |
| `PRINT_DENSITY` | `C`  | `0x43` | unknown — never observed by either source                          |
| `PRINT_DATA`    | `D`  | `0x44` | see below                                                          |
| `FORM_FEED`     | `E`  | `0x45` | none                                                               |
| `STATUS`        | `A`  | `0x41` | none (but see the note below on our capture)                       |
| `END`           | `Q`  | `0x51` | none                                                               |

A print job's directive stream is `START, PRINT_DATA, FORM_FEED, STATUS, END`.
`PRINT_DATA`'s layout:

```
ESC D  BPP[1]  ALIGN[1]  WIDTH[4, LE]  HEIGHT[4, LE]  IMAGE_DATA[4 × WIDTH bytes]
```

- `ALIGN`: constant `0x02` in every job, ours and theirs.
- `HEIGHT`: constant `0x00000020` (32) in every job — the full addressable height in
  dots, not the 30 px printable area (see "Raster encoding").
- `WIDTH`: little-endian, **the field our earlier notes called "varies with job size,
  ≈ total/4."** It's exactly what it looks like: the image width in columns. Confirmed
  in all four jobs (314, 576, 762, 1016 for the four job sizes), each matching
  `(jobLength − fixedOverhead) / 4` once `IMAGE_DATA`'s `4 × WIDTH` is accounted for.
- `BPP`: ysfchn/dymo-bluetooth hardcodes `0x01` ("bits per pixel, always 1") and their
  printer accepts it. **All four of our captured jobs instead show `0x81`** at this
  position — confirmed by direct byte inspection, not a transcription slip (the
  surrounding `ALIGN=0x02`, `WIDTH` and `HEIGHT` all line up exactly where their layout
  predicts). Unexplained: `0x81` is `0b1000_0001` — bit 0 agrees with "1 bit per
  pixel," and bit 7 may be a flag the stock app sets that a from-scratch 1-bpp
  implementation has no reason to. Not yet worth a named constant for the flag; just
  send what the vendor app sends until it's understood.

**One directive appears in every one of our captures that neither
ysfchn/dymo-bluetooth's write-up nor its own payload-builder code produces:**
`1b 23 01` (`ESC #` + one argument byte, value `1` in every job), inserted between
`START` and `PRINT_DATA`. Not `PRINT_DENSITY` (that's `ESC C`, `0x43`, not `0x23`) and
not in their directive table at all. Their library works without sending it, which
means the printer doesn't require it — but the real app sends it anyway, so its
purpose (copy count? a mode flag?) is an open question, not a contradiction.

**Also unexplained**: every one of our captures shows a standalone 3-byte write,
`1b 41 00`, sent on its own — its own ATT write and its own `Write Response` — _before_
the header-and-directive-stream job even begins, sometimes with a multi-second gap
before the response arrives. `STATUS` as ysfchn/dymo-bluetooth defines it is 2 bytes
(`1b 41`, no argument) and only appears _inside_ a job's directive stream, never sent
bare beforehand. Their library has no equivalent call. Plausibly a connectivity or
cassette-readiness probe the stock app performs before committing to building a job;
unconfirmed.

### Footer

```
1b 45 1b 41 1b 51 12 34
FORM_FEED STATUS END  [magic, appended to the last chunk]
```

`FORM_FEED` + `STATUS` + `END` is exactly the directive stream's documented tail; the
trailing `12 34` is the same magic value appended to the final chunk (see "Transport"),
not a separate directive.

## Raster encoding

`IMAGE_DATA` is `4 × WIDTH` bytes, one 4-byte (32-bit) group per column, **big-endian
within each group**. Per ysfchn/dymo-bluetooth: bit 0 of the first byte (i.e. the
highest bit of the last of the 4 bytes, since 4-byte groups are big-endian but pixel 0
is the _least_-significant bit of the _last_ byte) is the top-left pixel, and the
printable height is 30 of the 32 addressable rows — "the actual printable area is 30
pixels, so the first row will be missed on the label."

**This also resolves our earlier "every 4-byte group is duplicated" observation.**
Every column in every one of our captured jobs does appear twice in a row — but that
is not a wire-level framing duplication. ysfchn/dymo-bluetooth's own README: _"Images
needs to be stretched by at least 2 times like how its mobile app does, otherwise
printer will render the labels too narrow."_ The stock app bakes a 2× horizontal
stretch directly into the pixel data it sends — `WIDTH` already counts the stretched
columns — rather than the printer or protocol doing any doubling itself. A driver
built from scratch needs to replicate the stretch in the image encoder, the same way
their `Canvas.stretch(2)` does, not as a framing detail.

### Lessons from the first real print

The first LabelForge print on hardware came out **mirrored** and **far too small**:

- **Mirrored**: the first column sent is the left end of the tape as read, and bit 0
  is the top. Sending the design's rows top-to-bottom with dot 0 at the top is a
  transpose of the design — a mirror image in every orientation. The encoder now sends
  the last row first, a quarter turn clockwise, matching the editor's "Horizontal"
  view.
- **Too small**: the dot pitch had been estimated as 30 dots / 12 mm (2.5 dots/mm),
  assuming the head spans the whole tape. It doesn't; at the stated 200 DPI it spans
  ~3.8 mm, and the stretch puts columns at ~15.7/mm. The estimate predicted a print
  ~3.1x too short, consistent with what came out. Now 200 DPI — **still to be confirmed
  by measuring a print**.

## Result notifications

The printer notifies on the write-response characteristic with 3 bytes:
`1b 52 <status>` (`ESC R` + a status code).

**Our captures show three per connection, and only one per job**: one when
notifications are enabled, one answering the `1b 41 00` probe, and one 6–9 s after the
job's last write, once it has printed. An earlier version of these notes read that as
"two per job" and, following ysfchn/dymo-bluetooth's `reply_get`, discarded the first
after the job — which was the only one, so every LabelForge print timed out waiting
for a second. ysfchn/dymo-bluetooth (which sends no probe) does see two after a job,
the first a provisional "printing"; the driver now treats status `1` as that and
keeps waiting, and takes anything else as the result.

| Status | Printed? | Meaning                                                                                                 |
| :----: | :------: | ------------------------------------------------------------------------------------------------------- |
|  `0`   |  maybe   | completed (their note: can report success even with an open lid or missing cassette)                    |
|  `1`   |   yes    | completed (treat the same as `0`)                                                                       |
|  `2`   |    no    | failed, unknown reason                                                                                  |
|  `3`   |   yes    | completed, battery low                                                                                  |
|  `4`   |    no    | cancelled                                                                                               |
|  `5`   |    no    | failed, unknown reason (treat the same as `2`)                                                          |
|  `6`   |    no    | battery too low to print                                                                                |
|  `7`   |    no    | no cassette (never actually observed by ysfchn/dymo-bluetooth — a missing cassette reports `0` instead) |

## Open questions

- **The standalone `1b 41 00` write before every job.** Not in ysfchn/dymo-bluetooth's
  model at all. Probably a pre-flight probe; unconfirmed.
- **The undocumented `1b 23 01` directive** between `START` and `PRINT_DATA`. Sent by
  the real app in every capture, not required by the printer (their library omits it
  and still works), purpose unknown.
- **`BPP = 0x81`** instead of ysfchn/dymo-bluetooth's `0x01`. Both apparently work;
  what bit 7 means is unconfirmed.
- **Exact pixel bit-order**, beyond what their write-up states — not yet independently
  checked against a printed label from this project's own capture. Printing a simple,
  known bitmap (solid black, a single vertical line) and comparing the physical output
  to the decoded bytes would settle this directly.
- **Behaviour at scale.** All captured jobs are small (≤ 4114 bytes, well under the
  500-byte-chunk count where the index-skip-at-27 quirk would even matter much). Larger
  jobs, battery effects, and print timing are all unexplored here.

## Capturing more evidence

Same procedure as `docs/PROTOCOL.md`'s "Capturing the ground truth" section, with two
adjustments learned from captures that didn't pan out:

- **Confirm "Full" logging, not "Filtered."** One capture used Android's filtered HCI
  snoop mode, which truncates every packet to a short prefix and silently destroys any
  payload over a few bytes. `scripts/parse-btsnoop.mjs` now detects and warns about
  this (`!! N ACL packets are cut short…`); if that warning appears, the capture must
  be retaken. Some Android versions expose this as a 3-way choice (Disabled / Filtered
  / Full) rather than a toggle — make sure "Full" is selected explicitly.
- **Reconnecting between prints is handled.** The vendor app opens a fresh BLE
  connection per print rather than reusing one; `parse-btsnoop.mjs --all` renders each
  as its own `--- connection 0x… ---` section instead of splicing unrelated jobs
  together.

```
node scripts/parse-btsnoop.mjs --full --all captures/<file>.log
```
