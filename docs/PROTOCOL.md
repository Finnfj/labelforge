# MarkLife P50 / P50S wire protocol

How this document was arrived at, and how much to trust each part of it. See
`docs/THIRD_PARTY.md` for provenance.

There are four tiers of evidence here, and the difference between them turned out to
matter enormously:

1. **Read from the vendor SDK.** A starting point, no more. The published SDK is a
   tidied-up facade over an archived original, and where they disagree the facade is
   frequently wrong — it invents commands that appear nowhere in the vendor's own code
   and that no real printer answers. Marked **[unconfirmed]** where untested.
2. **Tested against a real P50S** (firmware V2.0.00). Reliable about what was tested,
   but read the _exact_ claim: "does nothing" always means "does nothing in the
   position it was sent in", which is not the same as unimplemented. That distinction
   is what hid the gap-seek command for four rounds of investigation.
3. **Captured from the vendor Android app** over Bluetooth HCI snoop, then replayed
   and confirmed on hardware. This is ground truth and it overrides both of the above.
   `scripts/parse-btsnoop.mjs` decodes such a capture; the procedure is at the end of
   this document.
4. **Third-party reverse engineering, unconfirmed here.** Facts published by someone
   else that have never been seen on our own wire. Weaker than tier 1, not stronger:
   an SDK at least ships with the product, whereas this is a stranger's reading of a
   decompile we have not repeated. Useful for knowing what to look for and for
   corroborating something already confirmed; never sufficient on its own. Marked
   **[tier 4]** at the point of use, and where it contradicts tiers 2 or 3 the
   confirmed evidence wins and the disagreement is recorded rather than resolved.

**Where a section carries a tier-3 finding it says so.** Several tier-1 and tier-2
conclusions in here were flatly wrong, and rather than quietly deleting them the
reasoning that failed is kept alongside the correction — the failure modes repeat, and
a plausible inference that fit the evidence is exactly the thing to be wary of next
time.

## Transport

Bluetooth **Low Energy** (GATT). Not Bluetooth Classic / SPP — the device never
appears as a pairable device in the OS Bluetooth settings, which is why the vendor
manual tells users not to pair from system settings.

| Role                          | UUID                                   |
| ----------------------------- | -------------------------------------- |
| Primary service               | `0000ff00-0000-1000-8000-00805f9b34fb` |
| Notify — printer status       | `0000ff01-0000-1000-8000-00805f9b34fb` |
| Write — host to printer       | `0000ff02-0000-1000-8000-00805f9b34fb` |
| Notify — flow-control credits | `0000ff03-0000-1000-8000-00805f9b34fb` |

Discovery: filter on the advertised **name prefix** (`P50`), _not_ on the service
UUID. These printers do not advertise the 128-bit service UUID, so a service filter
returns an empty device chooser. Advertised names look like `P50_2950_BLE`.

Writes go to `ff02` in chunks of ~90 bytes.

**Flow control — confirmed on a P50S (firmware V2.0.00).** `ff03` frames are
`[type, ...]` and **only type `0x01` carries credits**. The opening frame is
`01 04`, which sets the window to 4; subsequent `01 01` frames each add one, and
one arrives per write. A frame of `02 dc 00` was also observed on this channel
and is _not_ a credit grant — its meaning is unknown. Reading byte 1 regardless
of the type, as the vendor SDK does, turns that into a phantom grant of 220 and
silently disables flow control for the rest of the session.

Use ~5 ms between chunks while credits are flowing, falling back to ~30 ms if
`ff03` never fires.

Subscribe to **both** `ff01` and `ff03` before starting a print, or the job stalls.

## Commands

All multi-byte values are big-endian.

### Print control

| Purpose                             | Bytes                            |
| ----------------------------------- | -------------------------------- |
| Start print job                     | `1F C0 01 00`                    |
| Stop print job                      | `1F C0 01 01`                    |
| Set BT type (send after connecting) | `1F B2 00`                       |
| Align paper to start                | `1F 11 51`                       |
| Align paper to end (feed out)       | `1F 11 50`                       |
| Adjust position                     | `1F 11 <mode> <distHi> <distLo>` |
| Locate                              | `1F 12 <mode> 00`                |
| Locate (auto)                       | `0C`                             |

`adjustPosition` mode: `0x00` forward in dots, `0x01` forward in mm, `0x10` backward
in dots, `0x11` backward in mm.
`locate` mode: `0x10` none, `0x20` gap (die-cut labels), `0x30` black mark.

### Configuration

| Purpose                | Bytes                                                          |
| ---------------------- | -------------------------------------------------------------- |
| Set paper type         | `1F 80 01 <type>` — `10` continuous, `20` gap, `30` black mark |
| Get paper type         | `1F 80 00`                                                     |
| Set density (darkness) | `1F 70 01 <1..15>`                                             |
| Get density            | `1F 70 00`                                                     |
| Set speed              | `1F 60 01 <0 low \| 1 med \| 2 high>`                          |
| Get speed              | `1F 60 00`                                                     |

### Commands from the SDK's archived original — prefer these

The published SDK ships a tidied-up facade **and** the original it was derived
from, in `lib/archive/original_interface_chinese.js`. Where they disagree, trust
the original: several of the facade's commands appear nowhere in the vendor's own
code and are silent on real hardware.

| Purpose            | Original                      | Tidied facade           | Notes                                                           |
| ------------------ | ----------------------------- | ----------------------- | --------------------------------------------------------------- |
| Locate next label  | `1D 0C`                       | `0C` / `1F 12 <m> 00`   | ESC/POS `GS FF`. The gap-alignment primitive.                   |
| Feed n dot lines   | `1B 4A <n>`                   | _absent_                | ESC/POS `ESC J`. 8 lines = 1 mm.                                |
| Learn label gap    | `10 FF 03`                    | `1F 30 60`              |                                                                 |
| Label height       | `10 FF 50 F2`                 | _absent_                | Same family as battery, which answers.                          |
| Status (bit field) | `10 FF 40`                    | `1F 20 00`              | See below.                                                      |
| Printer info       | `10 FF 70`                    | _absent_                |                                                                 |
| Bluetooth name     | `10 FF 30 11`                 | used as _MAC_           |                                                                 |
| Bluetooth MAC      | `10 FF 30 12`                 | _absent_                |                                                                 |
| BT module version  | `10 FF 30 10`                 | _absent_                |                                                                 |
| Density            | `10 FF 10 00 <n>`             | `1F 70 01 <n>`          | Which the P50S honours is unknown.                              |
| Set BT type        | `1F B2 11`                    | `1F B2 00`              | The facade's value works in practice.                           |
| Job start / stop   | `10 FF FE 01` / `10 FF FE 45` | `1F C0 01 00` / `01 01` | **The facade's is correct here** — printing works with `1F C0`. |

**Status is a bit field, not an enum.** Zero means healthy; bit 0 printing,
bit 1 cover open, bit 2 out of paper, bit 3 low battery, bit 4 head overheating.

**Gap alignment procedure**, from the original's own comment on `getLabelHeight`:
issue `1D 0C` about three times, waiting for an `OK` after each, and only then
read `10 FF 50 F2`. Asking earlier returns an inaccurate height.

**`setPaperType` takes two arguments** in the original — `1F 80 <model> <type>`,
where model `0x01` makes the printer reply `OK`/`ER` and `0x02` is silent. The
facade hardcodes `0x01`, which is why an `OK` shows up during a print.

### Maintenance and status

**Several of these are inert on a P50S (firmware V2.0.00) when sent on their own.**
`1f 40` (self test), `1f 30 60` (learn paper) and `1f 11 50` (feed) produced no
observable effect — the printer accepts the write, grants a credit, and does
nothing. Wrapping them in an _empty_ `1f c0 01 00` … `1f c0 01 01` makes no
difference; that was tried and refuted.

**`1f 12 20 00` (locate gap) was on this list and does not belong here.** It is
inert in isolation and it is also the working sensor gap seek, once it follows a
raster payload inside a job. That is now the basis of label registration — see
"Keeping successive labels aligned". The lesson generalises: this list records
where a command was tested, not what the firmware implements.

They are kept in the command table because they come from the vendor SDK and may
be implemented on other models in the family, but nothing should depend on them.
**Printing does not need any of them.**

A caution about how this was nearly mis-concluded: `1f 11 50` seemed to "work
inside a print", but printing a raster advances the paper by itself, so the feed
could not be attributed to the command. Only commands whose effect is
distinguishable from the raster print should be treated as confirmed.

Confirmed working, by contrast: `1f c0` (job control), `1f 10` (raster) and the
`10 ff` information queries.

| Purpose                            | Bytes                                      |
| ---------------------------------- | ------------------------------------------ |
| Self test print                    | `1F 40`                                    |
| Learn paper (calibrate gap sensor) | `1F 30 60`                                 |
| Read sensor                        | `1F 30 <00 temp \| 01 voltage \| 02 opto>` |
| Printer status                     | `1F 20 00`                                 |
| Model                              | `10 FF 20 F0`                              |
| Firmware version                   | `10 FF 20 F1`                              |
| Serial number                      | `10 FF 20 F2`                              |
| Battery                            | `10 FF 50 F1`                              |
| Bluetooth MAC                      | `10 FF 30 11`                              |
| Set auto-shutdown minutes          | `10 FF 12 <hi> <lo>`                       |
| Get auto-shutdown                  | `10 FF 13`                                 |

Note the two prefixes are not two protocol generations: `1F` is used for print
control and configuration, `10 FF` for device-information queries. There is no
version negotiation anywhere in the command set.

### Dangerous — never expose in normal UI

| Purpose               | Bytes            |
| --------------------- | ---------------- |
| Reset to factory data | `1F 50 BE`       |
| Enter bootloader      | `1F A0 BE 66 88` |

Reachable only through the diagnostics raw-hex box.

## Raster image command

```
1F 10 <rowBytesHi> <rowBytesLo> <heightHi> <heightLo> <payloadLen BE32> <payload>
```

- `rowBytes = (widthDots + 7) >> 3`.
  **The width field carries bytes per row, not dots.** Community documentation
  describes this field as "width", which is misleading and will cost you a debugging
  session.
- `height` is in dots (rows).
- `payloadLen` is the length of the compressed payload, 32-bit big-endian.
- `payload` is `zlib.deflate(packed, { level: -1, windowBits: 10, memLevel: 8,
strategy: 0 })` — a standard zlib stream, _not_ raw deflate.

Bit packing: row-major, rows padded to a whole byte, **MSB first**, a set bit means a
**black** dot.

Source pixels (RGBA) are binarised as:

```
black  ⟺  (r + g + b) / 3 <= 200  AND  alpha != 0
```

Note this is a naive mean, not a luminance-weighted grayscale, and fully transparent
pixels are always white regardless of colour. We binarise upstream in the render
pipeline (with proper luminance weighting and, for photos, Floyd–Steinberg dithering)
and hand this stage pure black-or-white pixels, so its own threshold is a pass-through.

## Replies — confirmed on a P50S (firmware V2.0.00)

Replies arrive on `ff01` as unsolicited notifications; there is no request id, so
a query takes the next frame.

| Query                  | Reply                  | Decoded                      |
| ---------------------- | ---------------------- | ---------------------------- |
| firmware `10 FF 20 F1` | `56 32 2e 30 2e 30 30` | ASCII `V2.0.00`              |
| serial `10 FF 20 F2`   | `35 30 …  00`          | ASCII digits, NUL-terminated |
| battery `10 FF 50 F1`  | `00 64`                | `0x64` = 100 (percent)       |
| print complete         | `4f 4b`                | ASCII `OK`                   |

### What a P50S (V2.0.00) actually implements

Tested one at a time, each waiting out a 1.2 s timeout. Replies land ~330 ms
after the request.

| Query                                       | Result                                          |
| ------------------------------------------- | ----------------------------------------------- |
| `10 FF 20 F1` firmware                      | ✅ `V2.0.00`                                    |
| `10 FF 20 F2` serial                        | ✅ ASCII digits, NUL-terminated                 |
| `10 FF 50 F1` battery                       | ✅ `00 53` → 83 %                               |
| `10 FF 13` shutdown time                    | ✅ `0f` → 15 minutes                            |
| `10 FF 20 F0` model                         | ❌ silent                                       |
| `10 FF 40` status flags                     | ❌ silent                                       |
| `10 FF 50 F2` label height                  | ❌ silent                                       |
| `10 FF 70` printer info                     | ❌ silent                                       |
| `10 FF 30 10/11/12` BT version / name / MAC | ❌ silent                                       |
| `10 FF 03` learn label gap                  | ❌ silent                                       |
| every `1F` getter from the tidied facade    | ❌ silent — they do not exist in the vendor SDK |

So the archived original's byte sequences are transcribed correctly, but this
firmware implements only a subset. The model is taken from the advertised BLE
name instead; observed forms are `P50S-F871-BLE` and `P50_2950_BLE`, so split on
either separator.

### Paper motion: only printing moves paper

**Every dedicated motion command is inert when sent on its own.** `1D 0C` (locate
label), `1B 4A n` (ESC/POS feed dot lines), `1F 30 60` (learn paper), `1F 40`
(self test) and `1F 11 5x` bare are all acknowledged with a credit and then
ignored. The documented three-locates-then-read-height calibration cannot run: the
locates do nothing and the height query is unimplemented.

**Caveat, added later and important:** "on its own" is doing real work in that
sentence. `1F 12 20 00` behaves exactly like the commands above in isolation, and
it is nevertheless the working gap seek when it follows a raster inside a job. Do
not read the list as proof that these opcodes are unimplemented — only that they
are inert in the position they were tested in. See "Keeping successive labels
aligned" below.

What does move paper is a **print job**. So to feed a known distance, print an
all-white raster of that height: the head advances the rows and fires no dots.
Confirmed working on hardware; every alternative was confirmed not to.

### Keeping successive labels aligned — solved and confirmed

**A sensor gap seek does exist, it is `1F 12 20 00` — `locate` in gap mode — and with
it in the right place labels now register correctly print after print.**

This was reverse-engineered wrongly twice before an HCI capture of the vendor
Android app settled it, so the reasoning is worth recording:

- Sent standalone, `1F 12 20 00` does nothing. That is real, repeatable, and it is
  why the command was written off as inert.
- Sent inside an _empty_ print job it also does nothing. That refuted the
  "commands only work inside a job" theory.
- The capture shows the vendor app issuing it **after the raster payload and before
  `stopPrintjob`**. The theory was not wrong, it was too weak: what the command
  needs is a job with something in it.

So the earlier conclusion that "no closed-loop option exists" was wrong. It was
also wrongly _argued_ — the reasoning ran that because the vendor app misprints the
first label after a roll change and gets every later one right, it must be doing
open-loop post-print feeding, since a seek would have fixed the first too. That
sounded tidy and was false: the seek runs at the _end_ of each job, so it registers
the _next_ label. The first print after loading is misaligned precisely because no
job has ended yet.

The workaround built on that mistaken conclusion — appending blank rows to advance
a full label pitch — still works and is still available for continuous stock, but
it is no longer the mechanism.

### What the vendor app never sends

Worth knowing, because several of these were assumed:

- **No `setSpeed` (`1F 60`) at all.** Speed may be one of the six unidentified
  bytes in `1F 70 02`.
- **No feed command of any kind** — no `1B 4A`, no `1D 0C`.
- **No `learnLabelGap` (`10 FF 03`)** and no `getLabelHeight`.
- **No `setPaperType` mode `01`.** It uses mode `02` exclusively.
- **No padding of the raster to head width.** See Geometry.

## Print sequence — captured, then confirmed working

**Tier 3, and confirmed on hardware.** Transcribed from an HCI capture of the vendor
app printing the same label three times, then implemented here and verified: labels
now register correctly print after print, which is what four earlier attempts built on
inference failed to achieve.

Repeated verbatim per copy, configuration included. Byte-identical across all three
captured prints.

The shape of it, from connect to a registered label. The bytes below the diagram are
the authority — this is a reading aid. `printJobFraming()` in
`src/printer/protocol/commands.ts` is where the code keeps to it: both the Bluetooth
driver and the virtual printer build their job from that one function, so neither can
drift from the other without the tests noticing.

```mermaid
sequenceDiagram
    autonumber
    participant A as LabelForge
    participant P as P50S

    rect rgb(240, 244, 250)
    Note over A,P: Connect — BlePrinterDriver.connect()
    A->>P: requestDevice, filtered on the name prefix "P50"
    A->>P: GATT connect, discover service ff00
    A->>P: subscribe ff01 (status) and ff03 (credits)
    Note right of A: Both, before any print.<br/>Subscribing to one stalls the job.
    P-->>A: ff03: 01 04 — opening credit window, size 4
    A->>P: 1F 07 setBluetoothType
    A->>P: 10 FF 20 F2 / F1 / F3 — version, serial, MAC
    P-->>A: firmware, serial (model is taken from the advertised name)
    end

    rect rgb(245, 243, 236)
    Note over A,P: Print job — repeated verbatim per copy
    rect rgb(236, 240, 233)
    Note over A,P: One stream, chunked at 90 bytes over ff02 — see below
    A->>P: 1F 80 02 20 setPaperTypeSilent(gap)
    A->>P: 1F 70 02 0A 00×6 setPrintParams(density)
    A->>P: 1F C0 01 00 startPrintJob
    A->>P: 1F 11 51 alignPaperStart
    A->>P: 1F 10 … zlib raster payload
    A->>P: 1F 12 20 00 locate(gap)
    A->>P: 1F C0 01 01 stopPrintJob
    P-->>A: ff03: 01 01 — one credit back per chunk
    end
    Note right of A: Chunk boundaries fall wherever they fall.<br/>~5 ms between them while credits flow, ~30 ms if not.

    A->>P: 1F 11 50 alignPaperEnd
    P-->>A: ff01: 4F 4B ("OK"), ~300 ms later
    Note right of A: Waiting for this before the next copy<br/>is what stops multi-copy runs stacking.
    end
```

```
10 FF 50 F1                        battery — the app's own UI polling, not required
1F 80 02 20                        setPaperTypeSilent(gap)      mode 02, not 01
1F 70 02 0A 00 00 00 00 00 00      setPrintParams(density 10)   six unknown bytes
1F C0 01 00                        startPrintjob
1F 11 51                           alignPaperStart
1F 10 00 28 00 F0 00 00 04 EF …    raster: 40 bytes/row, 240 rows, 1263 bytes zlib
1F 12 20 00                        locate(gap)  <-- the alignment fix
                                   ^ mode follows the paper type: 10 continuous,
                                     20 gap, 30 black mark — the same values
                                     setPaperTypeSilent takes
1F C0 01 01                        stopPrintjob
1F 11 50                           alignPaperEnd
```

The printer then answers `4F 4B` — ASCII `OK` — on `ff01`, about 300 ms later.
Waiting for it before starting the next copy stops multi-copy runs stacking jobs.

### Chunking and MTU, from the same capture

The app negotiates an ATT MTU and writes the whole stream — commands and raster
alike, undifferentiated — in **217-byte** chunks. 217 = 220 − 3, and **220 is what
the `02 DC 00` frame on `ff03` is telling us**: `DC 00` little-endian is 220. That
frame was already known not to be a credit grant; now it has a meaning.

We still chunk at 90 bytes, which is proven on this hardware, because Web Bluetooth
neither exposes nor lets you request the MTU — so a 217-byte write is a guess that
fails mid-raster if Chrome negotiated less. Throughput has not been a problem.

**"Undifferentiated" is the load-bearing word, and it cost a bug to learn it.** The
capture's six 217-byte writes total 1302 bytes, which is 21 + 1273 + 8 — preamble,
raster command, then `1F 12 20 00` and `1F C0 01 01` arriving glued to the tail of
the last raster chunk. There is no transfer boundary anywhere in a job except
before `1F 11 50`. This is not cosmetic:

- The printer reads a byte stream off a UART. Transfer boundaries mean nothing to
  it.
- They are not free, either. Only the chunk loop waits for credits, so a command
  written outside it is written blind, and `writeValueWithoutResponse` reports
  nothing when the far side has no room.

This app used to write the framing as its own transfers. On short labels the window
had slack and it worked. On an 80 mm label it does not: a wire log of one shows the
window pinned at zero for the whole tail of the raster — 47 consecutive
credit-then-chunk pairs, the driver blocking on each — and then three uncredited
transfers in 3 ms, 60 ms before the printer granted anything again. The first of the
three was the gap seek. The label printed and did not register.

So `printJobStream()` in `src/printer/protocol/commands.ts` concatenates the job the
way the capture shows it, and the driver chunks _that_. Every byte of a print now
goes out under flow control.

### The gap seek has a job-size limit — confirmed

**Tier 2, confirmed on a P50S (V2.0.00) by controlled experiment.** The captured
sequence registers a label reliably right up until the job stops fitting in the
printer's input buffer, and then stops working entirely. Two wire logs of the same
design at two heights, everything else held constant:

|                          | 30 mm     | 80 mm          |
| ------------------------ | --------- | -------------- |
| raster                   | 48 x 240  | 48 x 640       |
| payload                  | 8,672 B   | 23,273 B       |
| whole job                | 8,714 B   | 23,315 B       |
| transfer                 | 932 ms    | 6,316 ms       |
| credits throttled        | never     | after 18,360 B |
| `4F 4B` after last write | 424 ms    | 8,492 ms       |
| **gap seek**             | **works** | **does not**   |

Both jobs are byte-for-byte the captured vendor sequence — same preamble, same
`1F 12 20 00` between raster and `1F C0 01 01`, same `1F 11 50` as its own transfer,
every byte sent under flow control. The only difference is the row count.

The credit trace is what explains it. On the short job credits come back faster than
we can spend them and the window never empties: the printer takes the whole thing,
_then_ prints. On the long one they arrive every ~10 ms for the first 18 KB and then
drop to ~75 ms — the buffer is full and the printer is granting only as fast as it
prints. It has started the motor before reading the end of the job, so
`1F 12 20 00` is still sitting in the unread remainder when the label comes out.
The 8.5 s to `4F 4B` is the rest of the label printing at 43 rows/s.

So the gap seek is not an action the printer performs when it reaches the command.
It is closer to a property of a job the printer has read in full, and a job it has
to stream is not one of those.

Things this rules out, all of which looked plausible first:

- **The header.** `1F 10 00 30 02 80` is 48 bytes/row and 640 rows. A one-byte
  height field would have explained a correct print with broken end-of-label logic;
  golden `checker-384x1200` from the vendor SDK encodes 1200 rows as `04 B0`, so the
  field really is 16-bit big-endian and ours is right.
- **Anything in the byte stream.** There is nothing left to correct in it.
- **Flow control.** Both jobs are fully credited, trailer included.

`SEEK_SAFE_JOB_BYTES` in `src/printer/protocol/constants.ts` carries the limit, set
to 16 KB rather than the observed 18,360 B because the throttle point is where the
buffer was already full and nothing says the figure holds at a different battery
level. Erring low costs an unnecessary 52-byte follow-up; erring high costs a label.

It is a threshold, not a ceiling — nothing about a large label is refused or warned
about, because the next section is the remedy and it is automatic.

### What `1F 11 51` and `1F 11 50` appear to be — [unconfirmed]

Named alignPaperStart and alignPaperEnd here since the SDK, and never isolated.
Three observations that made no sense separately fit one reading: **`1F 11 50`
advances the paper to a tear-off position and `1F 11 51` retracts it again before
printing.** Standard behaviour for a label printer with a tear bar downstream of
the head, and about 20 mm of travel on a P50S.

- A follow-up seek that ended "through the gap and about 20 mm into the next
  label" was not overshooting. It found the gap, and then `1F 11 50` advanced to
  the tear bar. That is where the paper is supposed to end up.
- A follow-up seek on a registered roll took a whole blank label. Retract 20 mm
  from the tear position lands at the gap; the 1 mm of blank raster then puts the
  paper just past it; the seek has nowhere to stop before the next gap, a full
  pitch away.
- A second consecutive print "fed some of the label back into the printer before
  printing", from paper that _was_ at the tear position and had not been pulled.
  That is the retract doing exactly what it should. The print that followed was
  cut off at 80%, which is a separate fault — see `4F 4B` below — and not a
  positioning one: the label started in the right place and stopped early.

**Where the paper starts is not the variable.** Three attempts moved it and none
changed the outcome:

| attempt                                      | paper moved  | result            |
| -------------------------------------------- | ------------ | ----------------- |
| as captured                                  | —            | whole blank label |
| 5 mm rewind, `1F 11 10 00 28`                | yes, visibly | whole blank label |
| tear-off round trip removed, ~20 mm each way | yes          | whole blank label |

That is a sweep of roughly 25 mm of starting position with an identical result each
time, so the seek is not deciding where to stop from where it began. Nor is there
another rewind to try: `adjustPosition` (`1F 11 10` dots, `1F 11 11` mm) and
`alignPaperStart` are the only backwards motions in the protocol, `1B 4A` and
`1D 0C` are forward-only and inert, and both backwards commands have now been used.

The round trip stays removed regardless — one label is one print, and advancing to
the tear position and retracting again in the middle of it was wrong on its own
terms. The label job is sent with an empty epilogue when a follow-up is coming, and
the follow-up drops `alignPaperStart`.

**What does correlate is the height of the raster in the job that carries the
seek.** 640 rows and it registers; 8 rows and it advances a label, from every
starting position tried. The reading that fits is that the printer tracks how far
it has printed within the current label and the seek advances the remainder — so a
job that prints a millimetre is a job that thinks it has a whole label left to go.
If that is right, no separate job can ever seek correctly, because the only raster
that would work is a full label of blank. Untested, and it would cost a label to
test.

Which leaves the size of the label _job_ as the thing to attack. The dither section
above does that by making the raster compress; splitting does it without touching
the picture at all.

### Splitting one label across several jobs — works, one at a time

`planSeekableBands()` cuts the raster into the fewest horizontal bands that each
encode under `SEEK_SAFE_JOB_BYTES`, and the driver sends them as consecutive jobs:
only the first retracts, only the last seeks, and the tear-off advance happens once
at the very end. A 50 x 80 photograph at full-strength diffusion comes out as three
bands.

**Back-to-back does not work, and this is now measured.** The appeal was that the
final band's seek would be in the buffer before the head reached it, which a single
oversized job can never manage. The bytes went out correctly — three jobs of 223,
223 and 194 rows, one `1F 11 51` in the first, one `1F 12 20 00` in the last, one
`1F 11 50` closing the stream — and the printer answered `4F 4B` **once** and
printed the first band only. A 640-row label came out 223 rows tall.

One acknowledgement for three jobs is the tell: every other log here shows one per
job. **The printer will not accept a job while it is working on one**, so there is
no way to get a second job into its buffer, and that whole line of reasoning is
closed.

So the bands go one at a time, each waiting for the last to be acknowledged, and the
driver stops and says so if an acknowledgement does not arrive rather than firing the
next band at a printer still moving paper.

**And that works.** A 50 x 80 photograph at full-strength diffusion prints whole,
registers, and wastes no label — which is the original goal reached with the picture
exactly as designed. It is the only route to that; every other answer trades image
quality for compressed size.

It also answers the open question about the printer's sense of position, in the
affirmative: whatever it uses to decide where the gap is survives a job boundary, so
the last band's seek lands correctly even though that band printed only a third of
the label.

**The seam is exactly 1 mm, and it cannot be closed.** The printer takes up eight
dots at the start of a job before it lays down a raster. That millimetre passes the
head with nothing fired at it, and nothing takes it back:

- **Winding back eight dots** — sent, acknowledged, ignored.
- **Winding back forty** — sent, acknowledged, ignored. Forty had looked as though
  it worked, from an earlier experiment where the paper visibly pulled back. It did
  not: that job also carried `alignPaperStart`, which retracts about twenty
  millimetres and is a known paper-mover. The movement was that. **`adjustPosition`
  is inert like every other dedicated motion command on this firmware, and the note
  in this document claiming otherwise was wrong** — two attempts were built on it
  before a band with no other motion in it showed the truth.
- **Overlapping the rasters** — wrong sign. The advance happens without printing;
  repeating rows does not undo it, it prints them again after the gap and pushes
  everything below down by another millimetre.

Printing rows and the gap seek remain the only two things that move paper on a
P50S, which is where this document started.

So the millimetre is spent, and what is left is choosing what it costs and where it
falls.

**What it costs:** the eight rows that land in it are skipped, not printed late.
Late shifts the whole remainder of the label down a millimetre per boundary, which
accumulates and walks the bottom of the design off the label. Skipping keeps every
other row exactly where it was designed and gives up a millimetre of image.

**Where it falls:** `planSeekableBands()` nudges the cut earlier, up to five
millimetres, to whichever row loses the least ink — scoring candidates by the dots
set in the rows that would be skipped, ties going to the latest so bands stay large.
A millimetre of white across a photograph shows; a millimetre across the space
between two lines of text does not. On a design with any white space near the cut
the seam disappears into it; on a full-bleed photograph it will still show, at the
quietest row available.

The cost is that the head now stops at each boundary while the driver waits, and a
stopped head is where a seam would show. The planner minimises the band count for
that reason, and the option is off by default.

### The diagnostics feed used to seek

`Feed by printing blank` builds a real print job, and the job trailer carries the
gap seek — so asking for 2 mm fed 2 mm and then went to the boundary. The tool
exists to step the paper a measured distance and read the millimetres off, which
that makes impossible. `PrintSettings.seekGap` leaves the seek out for jobs whose
purpose is moving paper rather than printing a label.

Worth noting what the same log confirms in passing: that 44-byte job's seek was
honoured, first time. Every small job's seek has been.

### `4F 4B` is the only sign a label finished

A healthy job answers `4F 4B` on `ff01` once the printer works through it — a
fraction of a second for a short label, ten seconds for a full-height one, since
the reply comes when the stream has been consumed rather than when the bytes
landed. `printDurationMs()` sizes the wait from the row count.

**A job that does not answer may not have finished — but the two are not the same
thing.** One run printed a 50 x 80 label at a third of the usual rate, cut the
image off about 80% of the way down, and sent nothing. A later run printed the
whole motif and also sent nothing, so silence is a reason to look at the label
rather than proof that it is wrong; the warning is worded that way. Flow control was clean throughout — 280 credits for 281 writes, no gap
over a second — so every byte was accepted; the printer simply stopped putting
them on paper.

Two things followed from that being invisible:

- The driver only waited for the acknowledgement _between_ copies, so a single
  print reported `done` while the printer still had ten seconds of label to go,
  and a job it never finished looked exactly like one it did. Every copy now
  waits, and a missing reply is reported rather than shrugged off.
- Nothing in the app consumed the driver's `log` events, so the one channel it
  had for saying "that label may be incomplete" went nowhere. The print panel
  shows them.

### Battery

`10 FF 50 F1` answers `00 <percent>`. The truncated run above reported `00 00`,
and nothing in the UI drew attention to it. A thermal head takes its heat from the
battery, so a flat one is the first thing to rule out when a print is slow or
cut short — the connection panel now says so below 20%. `00 00` seems to mean
charging as well as empty; nothing distinguishes them.

### The dither decides whether a tall label can register itself

The threshold is on _compressed_ bytes and the compressor's input is a dithered
bitmap, so the choice of dither decides which side of it a photograph lands on.
Error diffusion scatters a picture into nearly random dots that deflate cannot
touch; ordered dithering lays them on a grid, which compresses. Measured on a
384 x 640 raster — the failing 50 x 80 label exactly — at the app's own zlib
settings:

| source         | Floyd–Steinberg | Atkinson | Bayer 8x8  |
| -------------- | --------------- | -------- | ---------- |
| smooth photo   | 23,140          | 25,266   | **6,422**  |
| textured photo | 25,519          | 27,397   | **13,780** |
| heavy grain    | 28,861          | 29,344   | 21,396     |

Diffusion strength is a gentler lever on the same axis, and worth having because it
keeps error diffusion rather than switching to a grid. Same raster, Floyd–Steinberg:
23,140 bytes at full strength, 21,239 at 80%, 18,950 at 60%, **15,284 at 40%**,
8,639 at 20%. Contrast is not a lever — lifting it to +80 saves 14%.

`SEEK_SAFE_JOB_BYTES` is 16,384, and the real payloads from the wire logs were
23,051–25,095. So for most photographs one of these takes a tall label under the
line, and **then none of the rest of this section applies** — the job is
ordinary, the printer reads it whole, and its own `1F 12 20 00` registers the label
exactly as it does at 30 mm. Not for all of them, which is why the print panel
rasterises the alternative and reports the real number rather than promising one.

`src/printer/protocol/encodeImage.test.ts` pins the ratio and the threshold
crossing, since the advice is worthless if either stops holding.

**`windowBits` is not a lever here, and this is where that gets settled.** The note
under "Three places we disagree" called a wider window "untested and uninteresting
until something needs it". Something needed it, and the answer is no: 10 → 15 moves
Floyd–Steinberg from 23,140 to 22,829 bytes, 1.3%. The parameter the goldens pin can
stay pinned.

### The follow-up seek job — confirmed working

The seek is honoured by any job the printer reads in full, so the fix is to send one
of those. After an oversized label is out the driver sends a second, ordinary job
whose raster is 1 mm of blank:

```
1F 80 02 20  1F 70 02 08 00×6  1F C0 01 00  1F 11 51
1F 10 00 30 00 08 00 00 00 0D …13 bytes of zlib…
1F 12 20 00  1F C0 01 01                        then  1F 11 50
```

52 bytes. The blank raster is there because a seek with nothing in front of it is
inert; blank rows deflate to almost nothing, so this costs one millimetre of paper
and a single BLE write, and even that millimetre is absorbed into the travel to the
gap. `followUpSeekJob()` builds it from the same `printJobFraming()` as the label,
so it is the confirmed-working shape by construction rather than by resemblance.

**Timing is the whole of it.** The first trial sent the follow-up on a flat 5 s
timer against a label that needed 8.5 s, so it queued behind the raster it exists to
get past and the paper stopped short. The wire log names the cause exactly: the main
job's last byte at 11,588 ms, the follow-up at 16,597 ms — 5,009 ms later, which is
a timeout expiring rather than an acknowledgement arriving, and no `4F 4B` anywhere
in the log.

That looks like a distance-limited seek and is not one: a 30 mm label on the same
80 mm roll seeks the whole remaining ~50 mm and lands correctly. The seek travels as
far as it needs to. It simply has to be issued to a printer that has finished.

So the wait now comes from the row count and `printDurationMs()` rather than a
constant, and the follow-up goes out on `4F 4B`. **Confirmed on hardware: an 80 mm
label registers.**

One pass, not several. Repeating was the obvious hedge while the travel looked
bounded, and it is the wrong instinct now that the seek is known to reach: a pass
that finds the gap would send the next one on to the label after it, and there is
nothing to stop on — no status query on this firmware answers, and `4F 4B` says a
job was processed, not where the paper stopped.

**And that is not hypothetical, which is why the follow-up is off by default and a
repair rather than a routine.** It registers a roll that has lost its place. On a
roll that has not, it costs paper and does not settle — a full-height label ends at
the gap, and seeking from there has been seen to run a whole pitch onto the label
after next. Where it stops is not something the wire predicts, and nothing on this
firmware reports where the paper is.

**It is also never sent without `4F 4B` first.** A trial where the acknowledgement
never arrived ran the full `printDurationMs()` budget — 29,770 ms for 640 rows, the
log shows the follow-up going out at exactly that offset — and then sent it anyway,
into a printer that had not said it was finished. The paper went through the gap and
20 mm into the next label. Leaving a roll unregistered is recoverable; seeking from a
position nobody knows is not, so a timed-out wait now skips the follow-up and says
so.

**`feedAfterDots` is the fallback, not the answer.** Blank rows move paper by exactly
as many as you send, which is predictable in a way the seek has not been — but it
means measuring the stock, and the printer has a sensor that works. It comes last in
the print panel for that reason, behind the dither and behind the follow-up.

**Answered: a registered roll does need something, and `1F 11 51` is not it.**
Consecutive full-height prints with the follow-up off and `feedAfterDots` at zero
drift — each one starts a gap-width earlier than the last and ends short of the
label, motif intact. The retract undoes the tear-off advance and nothing more, so
with the in-job seek unread there is nothing left to cross the gap.

That leaves `feedAfterDots` as the mechanism for tall stock, and it is the better
one anyway: blank rows advance the paper by exactly as many as you send, every
time. The print panel now offers it directly whenever a job is over the threshold,
rather than leaving it under Diagnostics for someone to find.

**The vendor app does not do this.** Printing the same stock from it leaves the
paper mid-label with no seek at all, so this is a firmware limit rather than a trick
the vendor knows, and the behaviour here is better than the reference implementation
rather than catching up to it.

## Geometry

203 dpi = **8 dots/mm** exactly.

**Head width on a P50S is 384 dots = 48.0 mm**, agreeing with the vendor SDK.
Established with the `edgeFrame` pattern, which inks the outermost dots of the
raster: at 384 all four sides print; at 400 the edge is lost.

This was briefly recorded here as 400 on weaker evidence — a label right-aligned
against 384 landed 16 dots too far left, and 400 − 384 = 16 looked conclusive.
It was not. That inference assumed the printable label was exactly 320 dots wide,
and a horizontal _placement_ error cannot distinguish a wider head from paper
sitting further right. Prefer the test that measures the thing directly.

**The raster is not padded to head width.** The capture shows the vendor app
printing a 40 mm label as `rowBytes = 40`, i.e. 320 dots — exactly the label — and
letting the printer position it. So head width is a _limit_, not a canvas.

That also explains the misplacement recorded here as unresolved: a rectangle on the
label bounds landed left of them because we were padding to 384 and right-aligning
inside it. Both halves of that were invented. Sending an unpadded label-width raster
is what the working implementation does, so it is what we do; `padToHead` survives
as a diagnostic for addressing a specific head column, off by default.

Head width still is not queryable, so it stays per-printer configuration.

## The rest of the family — [tier 4]

**Everything in this section is tier 4** unless it says otherwise: it comes from reading
[tomLadder/thermoprint](https://github.com/tomLadder/thermoprint), another browser app
for these printers, whose own protocol notes derive from a JADX decompile of the vendor
Android app (`com.feioou.deliprint.yxq` v3.6.0). None of it has been seen on our wire,
and we have no hardware but a P50S to check it against.

MarkLife printers do not all speak one protocol. There are at least two dialects:

| Dialect | Models                   | Raster                                           | Us              |
| ------- | ------------------------ | ------------------------------------------------ | --------------- |
| **x2**  | P50, P50S, M60, X2       | `1F 10`, zlib-compressed, big-endian dims        | implemented     |
| **L11** | P15, P12, P7 and aliases | `1D 76 30`, **uncompressed**, little-endian dims | not implemented |

L11's command vocabulary differs throughout, not just in the raster: `10 FF F1 02` to
enable, `1B 4A n` to feed, `1D 0C` to seek the gap, `10 FF 10 00 t` for thickness. A
P15 sent our commands would ignore all of them. `src/printer/profiles.ts` recognises the
L11 name prefixes and refuses to connect, which is the only responsible thing to do with
a printer we cannot drive.

### The x2 correspondence, which is worth more than it looks

thermoprint's x2 dialect and our captured P50 sequence agree byte for byte on the
service and characteristics (`ff00`/`ff01`/`ff02`/`ff03`), the credit-based flow
control, the `1F 10 <rowBytesHi> <rowBytesLo> <heightHi> <heightLo> <payloadLen BE32>`
raster header, and the job bracketing — `1F 80 02 20`, `1F C0 01 00`, `1F 11 51`,
`1F 12 20 00`, `1F C0 01 01`, `1F 11 50`.

That is two independent routes to the same bytes: theirs from decompiling the Android
app, ours from an HCI capture of it. It does not upgrade anything to tier 3, but it is
the strongest corroboration this reconstruction has had, and it arrived after the fact
rather than being what the reconstruction was built from.

### Three places we disagree, and keep our own

Recorded rather than reconciled, because in each case a tier-4 claim contradicts
something we confirmed ourselves.

- **A wakeup frame.** thermoprint sends six zero bytes before `startPrintJob` on the x2
  path. Our capture of the vendor app printing the same label three times shows no such
  frame, and printing works without it. We do not send it.
- **A shorter `setPrintParams`.** thermoprint uses a 4-byte `1F 70 02 <d>` with the
  density remapped through `{1: 3, 2: 8, 3: 14}`. Our capture shows the 10-byte
  `1F 70 02 <d> 00×6` with the density passed straight through. We send what we
  captured.
- **zlib parameters.** thermoprint compresses with fflate at `level: 6`; its notes
  claim `windowBits 14`. Our golden fixtures, taken from the vendor SDK's own encoder,
  pin `windowBits: 10` — a different CMF byte, so the streams are not interchangeable.
  Ours is evidenced for this printer and theirs is not, so ours stands. Whether a P50S
  would also accept a wider window is untested and uninteresting until something needs
  it.

### What this buys, and what it does not

An `m60` profile ships, marked **unverified** in the UI and in
`src/printer/profiles.ts`. It claims only that the M60 uses the dialect we already
implement; its head width and chunk size are the P50's numbers because nobody has
measured an M60. It exists to be disproved by someone with the hardware. The L11
refusal, by contrast, is certainly correct: we know we cannot drive those printers.

## What is left, and how to find it

### The SDK is exhausted (and that was not the end of it)

All forty functions in `lib/archive/original_interface_chinese.js` have been
enumerated and every byte sequence transcribed. **It contains no motion or gap
command beyond the ones already shown to be inert.** The `feed()` call inside its
`printP80` path references a function that does not exist in the file.

The P80 model in the same SDK speaks CPCL — `PAGE-WIDTH`, `FORM`, `PRINT` as ASCII
text — which is a different protocol entirely and not what the P50 raster path
uses. Mentioned only so nobody re-reads it hoping for a P50 command.

So anything further is not in this SDK. It did not need to be: the gap seek turned
out to be a command already in the table, issued in a position nobody had tried.
Exhausting the _command space_ was not the same as exhausting the _state space_, and
conflating the two is what stalled this for so long.

### Does a gap-seek command exist at all? — yes

**Answered by capture: `1F 12 20 00`, after the raster, inside the job.** See
"Keeping successive labels aligned".

This section previously argued the opposite, and the argument is preserved here as a
worked example of a plausible-sounding inference that was simply wrong:

> With the vendor app the _first_ print after loading a roll is misaligned and every
> one after it is correct. A sensor-driven seek would fix the first print too,
> because it would locate before printing. What fits is open-loop feeding.

The observation was accurate; the conclusion did not follow. The seek runs at the
_end_ of a job, registering the _next_ label — so a misaligned first print and
correct later ones is exactly what a seek predicts too. Both hypotheses explained the
evidence equally well, and nothing in the reasoning acknowledged that. The capture
cost twenty minutes and settled in one pass what four rounds of inference had not.

### Capturing the ground truth

If the question needs settling, capture what the vendor app really sends.

**On the phone**

1. Enable **Developer options → Enable Bluetooth HCI snoop log**.
2. Reboot, so the log starts clean and is as short as possible.
3. Turn off other Bluetooth devices first — earbuds, watch, car. The log records
   _all_ Bluetooth traffic, so this is both less noise and less private data.
4. Open the MarkLife app, connect, print **the same label three times**, and let it
   feed after each. Three prints is what distinguishes a one-off from a per-print
   feed, which is the whole question.
5. Note the label size you told the app, and that it was three prints.

**Getting the log off the phone**

The log lives at `/data/misc/bluetooth/logs/btsnoop_hci.log`, which needs root, so
the practical route is a bug report:

```
adb bugreport snoop.zip
```

Inside that zip, the capture is at
`FS/data/misc/bluetooth/logs/btsnoop_hci.log`. Extract just that one file — the zip
itself is large and full of unrelated diagnostics. Without `adb`, **Developer
options → Bug report** produces the same zip and can be shared off the phone.

**Decoding it**

```
node scripts/parse-btsnoop.mjs captures/btsnoop_hci.log
```

`scripts/parse-btsnoop.mjs` parses the btsnoop container, reassembles L2CAP,
decodes ATT, resolves handles to characteristic UUIDs from whatever GATT discovery
the capture contains, and prints two things: a timeline, and the concatenated
command stream with every byte matched against the table above. Unrecognised bytes
are marked `?` — those are the interesting ones. It reports other devices as packet
counts only and decodes the printer's connection alone, so a capture can be shared
without handing over unrelated Bluetooth traffic.

Compare that sequence against `1F C0 01 00` / `1F 10 …` / `1F C0 01 01`. Anything
present there and absent here is the answer, and it is a fact rather than an
inference — which everything in this section otherwise is not.

Wireshark remains a fine alternative (filter `btatt`); the script exists so that
settling this needs no extra tooling installed.
