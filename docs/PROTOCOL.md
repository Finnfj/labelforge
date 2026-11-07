# MarkLife P50 / P50S wire protocol

The reference for anyone changing the printer driver or the encoder: what goes over
the wire, in what order, and what the printer does with it. Words such as _job_,
_band_, _gap seek_ and _retract_ are used as [`GLOSSARY.md`](../GLOSSARY.md) defines
them. The decisions this protocol forced are in [`docs/adr/`](adr/), and how to
capture and test new findings is in [`CAPTURING.md`](CAPTURING.md).

## Scope and trust

Everything here is confirmed on a **P50S, firmware V2.0.00**, unless it carries one
of these markers:

- **[SDK only]**: read from the vendor SDK and never confirmed on hardware. The
  published SDK is a tidied-up facade over an archived original
  (`lib/archive/original_interface_chinese.js`), and where they disagree the facade
  is often wrong.
- **[inferred]**: fits every observation, never isolated.
- **[third-party]**: from someone else's reverse engineering, never seen on our own
  wire. See [`THIRD_PARTY.md`](THIRD_PARTY.md) for provenance.

The print sequence itself comes from a Bluetooth capture of the vendor Android app,
replayed and confirmed here. Where a capture and the SDK disagree, the capture wins.

## Transport

Bluetooth **Low Energy** (GATT), not Classic or SPP. The printer never appears in the
OS Bluetooth settings, which is why the vendor manual says not to pair from there.

| Role                          | UUID                                   |
| ----------------------------- | -------------------------------------- |
| Primary service               | `0000ff00-0000-1000-8000-00805f9b34fb` |
| Notify — printer status       | `0000ff01-0000-1000-8000-00805f9b34fb` |
| Write — host to printer       | `0000ff02-0000-1000-8000-00805f9b34fb` |
| Notify — flow-control credits | `0000ff03-0000-1000-8000-00805f9b34fb` |

**Discovery** filters on the advertised name prefix (`P50`), not the service UUID.
These printers do not advertise the service, so a service filter returns an empty
device chooser. Observed names are `P50S-F871-BLE` and `P50_2950_BLE`.

**Subscribe to both `ff01` and `ff03` before printing**, or the job stalls.

**Credits.** `ff03` frames are `[type, ...]`, and only type `0x01` carries credits.
The opening frame `01 04` sets the window to 4; each later `01 01` adds one, and one
arrives per chunk written. Pace chunks ~5 ms apart while credits flow, ~30 ms if
`ff03` never fires.

The `02 DC 00` frame on the same channel is _not_ a credit grant: `DC 00` is 220
little-endian, the negotiated ATT MTU. Reading byte 1 regardless of type, as the
vendor SDK does, turns it into a phantom grant of 220 and silently disables flow
control for the rest of the session.

**Chunks are 90 bytes** (`DEFAULT_CHUNK_SIZE`). The vendor app writes 217-byte chunks
(MTU 220 − 3), but Web Bluetooth neither exposes nor requests the MTU, so 217 is a
guess that fails mid-raster if Chrome negotiated less. 90 is proven on this hardware
and throughput has not been a problem.

**A job is one byte stream** ([ADR 0002](adr/0002-one-flow-controlled-stream-per-job.md)).
Preamble, raster and trailer are concatenated and chunked as a whole, so chunk
boundaries fall wherever they fall and every byte waits for a credit.
The Bluetooth driver joins each job of the print plan into that stream before
chunking it. The only write boundary is before the tear-off advance, which goes out
on its own after the job.

## Commands

All multi-byte values are big-endian. Two prefixes are in use: `1F` for print control
and configuration, `10 FF` for device queries. They are not two protocol generations,
and nothing negotiates a version.

### Print control

| Purpose           | Bytes                            | On a P50S                                               |
| ----------------- | -------------------------------- | ------------------------------------------------------- |
| Start print job   | `1F C0 01 00`                    | works                                                   |
| Stop print job    | `1F C0 01 01`                    | works                                                   |
| Set BT type       | `1F B2 00`                       | sent after connecting, as the SDK does; effect unknown  |
| Align paper start | `1F 11 51`                       | the **retract**: acts only before a raster in a job     |
| Align paper end   | `1F 11 50`                       | the **tear-off advance**, sent after the job [inferred] |
| Adjust position   | `1F 11 <mode> <distHi> <distLo>` | inert in every mode, on either side of a raster         |
| Locate            | `1F 12 <mode> 00`                | the **gap seek**: acts only after a raster in a job     |
| Locate (auto)     | `0C`                             | [SDK only]                                              |

`adjustPosition` mode: `0x00` forward dots, `0x01` forward mm, `0x10` backward dots,
`0x11` backward mm. `locate` mode: `0x10` none, `0x20` gap, `0x30` black mark; it
follows the paper type.

### Configuration

| Purpose          | Bytes                             | On a P50S                                              |
| ---------------- | --------------------------------- | ------------------------------------------------------ |
| Set paper type   | `1F 80 <reply> <type>`            | works; type `10` continuous, `20` gap, `30` black mark |
| Set print params | `1F 70 02 <density> 00×6`         | works; what the vendor app sends; six unknown bytes    |
| Set density      | `1F 70 01 <1..15>`                | [SDK only]; the vendor app never sends it              |
| Set speed        | `1F 60 01 <0 low, 1 med, 2 high>` | [SDK only]; the vendor app never sends it              |

`<reply>` `0x01` makes the printer answer `OK`/`ER`; `0x02` is silent and is what the
vendor app uses. Every `1F` getter in the SDK facade (`1F 80 00`, `1F 70 00`,
`1F 60 00`, `1F 20 00`) is silent.

### Queries and maintenance

| Purpose                             | Bytes                                  | On a P50S                           |
| ----------------------------------- | -------------------------------------- | ----------------------------------- |
| Firmware version                    | `10 FF 20 F1`                          | ASCII, e.g. `V2.0.00`               |
| Serial number                       | `10 FF 20 F2`                          | ASCII digits, NUL-terminated        |
| Battery                             | `10 FF 50 F1`                          | `00 <percent>`                      |
| Get auto-shutdown                   | `10 FF 13`                             | minutes, e.g. `0f` = 15             |
| Set auto-shutdown                   | `10 FF 12 <hi> <lo>`                   | [SDK only]                          |
| Model                               | `10 FF 20 F0`                          | silent; taken from the name instead |
| Bluetooth name (the facade's "MAC") | `10 FF 30 11`                          | silent                              |
| Self test                           | `1F 40`                                | inert                               |
| Learn paper (gap)                   | `1F 30 60`                             | inert                               |
| Read sensor                         | `1F 30 <00 temp, 01 voltage, 02 opto>` | [SDK only]                          |

The model comes from the advertised name: split on `-` or `_` and take the first
part.

### From the SDK's archived original

These appear only in the original, not in the facade. All are **silent or inert** on
this firmware, so nothing depends on them:

| Purpose           | Bytes              | On a P50S |
| ----------------- | ------------------ | --------- |
| Locate next label | `1D 0C`            | inert     |
| Feed n dot lines  | `1B 4A <n>`        | inert     |
| Learn label gap   | `10 FF 03`         | silent    |
| Label height      | `10 FF 50 F2`      | silent    |
| Status bit field  | `10 FF 40`         | silent    |
| Printer info      | `10 FF 70`         | silent    |
| BT version / MAC  | `10 FF 30 10`/`12` | silent    |
| Density           | `10 FF 10 00 <n>`  | untested  |

The SDK's calibration procedure (locate three times, then read the label height)
cannot run here: the locates are inert and the height query is unimplemented. Its
status bit field is [SDK only]: zero is healthy, bit 0 printing, 1 cover open, 2 out
of paper, 3 low battery, 4 head overheating.

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

- `rowBytes = (widthDots + 7) >> 3`. **The width field carries bytes per row, not
  dots**, whatever community notes call it.
- `height` is in dots (rows), 16-bit.
- `payloadLen` is the compressed length, 32-bit.
- `payload` is `zlib.deflate(packed, { level: -1, windowBits: 10, memLevel: 8,
strategy: 0 })`: a standard zlib stream, not raw deflate. `windowBits: 10` is
  load-bearing; the golden fixtures in `src/printer/dialects/x2/` pin the SDK's output
  byte for byte.

Bit packing: row-major, rows padded to a whole byte, **MSB first**, a set bit is a
**black** dot.

The SDK binarises RGBA as `black ⟺ (r + g + b) / 3 <= 200 AND alpha != 0`, a naive
mean in which transparent pixels are always white. The render pipeline binarises
upstream with proper luminance weighting and dithering, and hands this stage pure
black or white, so its threshold is a pass-through.

## Replies

Replies arrive on `ff01` as unsolicited notifications, about 330 ms after the
request. There is no request id, so a query takes the next frame; send queries one at
a time.

`4F 4B` (ASCII `OK`) means a job has been consumed. It comes when the printer has
worked through the stream, not when the bytes landed: a fraction of a second for a
short label, around ten seconds for a full-height one. `printDurationMs()` sizes the
wait from the row count: twice the time the rows take at the printer's drain-limited
speed of about 43 rows per second (`PRINT_ROWS_PER_SECOND`).

## Print sequence

Captured from the vendor app printing the same label three times, byte-identical each
time, and repeated verbatim per copy, configuration included. `printJobFraming()` in
`src/printer/dialects/x2/commands.ts` builds each job, and the x2 print plan in
`src/printer/dialects/x2/plan.ts` is the one place both the Bluetooth driver and the
virtual printer get a print from, so they cannot drift apart.

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
    A->>P: 1F B2 00 setBluetoothType
    A->>P: 10 FF 20 F0 / F1 / F2, 10 FF 30 11 — model, firmware, serial, MAC
    P-->>A: firmware, serial (model and MAC stay silent; model comes from the advertised name)
    end

    rect rgb(245, 243, 236)
    Note over A,P: Print job — repeated verbatim per copy
    rect rgb(236, 240, 233)
    Note over A,P: One stream, chunked at 90 bytes over ff02
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
    P-->>A: ff01: 4F 4B ("OK") once the job is consumed
    Note right of A: Every copy waits for this<br/>before the next one starts.
    end
```

```
1F 80 02 20                        setPaperTypeSilent(gap)      reply mode 02
1F 70 02 0A 00 00 00 00 00 00      setPrintParams(density 10)   six unknown bytes
1F C0 01 00                        startPrintJob
1F 11 51                           alignPaperStart              the retract
1F 10 00 28 00 F0 00 00 04 EF …    raster: 40 bytes/row, 240 rows, 1263 bytes zlib
1F 12 20 00                        locate(gap)                  the gap seek
1F C0 01 01                        stopPrintJob
1F 11 50                           alignPaperEnd                the tear-off advance
```

The vendor app also polls the battery (`10 FF 50 F1`) from its own UI; that is not
part of a print. Every copy waits for `4F 4B` before the next starts, which stops
multi-copy runs stacking. A missing reply is reported, not shrugged off.

**What the vendor app never sends**, though the SDK suggests it might: `setSpeed`
(`1F 60`), any feed command (`1B 4A`, `1D 0C`), `learnLabelGap`, `getLabelHeight`,
`setPaperType` reply mode `01`, or a raster padded to head width.

## What moves paper

Three things, and only three:

1. **Printing rows.** Blank rows advance the paper by exactly their count and fire no
   dots, so feeding a known distance means printing an all-white raster.
2. **The gap seek**, only when it follows a raster inside a job. Sent alone, or in an
   empty job, it is inert.
3. **The retract**, only when it comes before a raster inside a job.

The tear-off advance after a job makes a fourth if the [inferred] reading of
`1F 11 50` is right. Every other motion command is acknowledged with a credit and
then ignored, in any position tried.

**Position decides what a command does.** The same opcode can be inert before a
raster and act after it, or the reverse.

**Take-up.** A job advances 8 dots (1 mm) before it prints its first row, with
nothing fired at it.

**Retract.** One per job: repeats within a job are ignored, and retracts sent as
separate jobs still move the paper one retract's worth in total. It is an align to a
position the printer tracks, not a relative move, so its distance depends on where
the paper starts: about 20 mm from the tear-off position, where it undoes the tear-off
advance, and 64 dots (8 mm) mid-label.

**Gap seek.** It travels as far as it needs to: a 30 mm label on an 80 mm roll seeks
the whole remaining ~50 mm and lands correctly. It registers the _next_ label, since
it runs at the end of a job. Two limits:

- **The printer must have read the whole job.** A job too large to be read before
  printing starts is not registered. See "Tall labels".
- **A seek in a job of its own needs about 24 mm of approach distance.** Below that it
  misses its own gap and runs a full pitch to the next one. A seek in the same job as
  a real raster needs no approach at all. One retract buys back under 20 mm, so a
  standalone seek cannot register a full-height label, which ends at its gap. This
  ruled out the follow-up seek ([ADR 0001](adr/0001-split-tall-labels-into-bands.md)).

## Tall labels

**The printer starts printing before it has read a large job.** Its input buffer
fills at about 18 KB; past that, credits slow to the rate it prints at, and the gap
seek at the end of the job is still unread when the label comes out. Measured on the
same design at two heights: a 30 mm job of 8.7 KB registers; an 80 mm job of 23.3 KB,
throttled after 18,360 bytes, does not. The vendor app has the same limit and does
nothing about it.

`SEEK_SAFE_JOB_BYTES` is **16 KB**, below the observed throttle point because nothing
says it holds at every battery level. Erring low costs a band; erring high costs a
label.

The size that counts is the _compressed_ raster, so a job over the line has three
remedies, in the order the print panel offers them.

### 1. Splitting into bands — the default

[ADR 0001](adr/0001-split-tall-labels-into-bands.md) records why. `planSeekableBands()`
in `src/printer/dialects/x2/splitJob.ts` cuts the raster into the fewest horizontal bands
that each encode under the limit. The bands go out one at a time, each waiting for
`4F 4B`, because the printer accepts no job while it is working on one; only the last
band carries the gap seek, and the tear-off advance happens once at the end. A raster
under the limit is one band, so small labels are unaffected. `splitForSeek`, on by
default.

**The seam is closed** (`closeSplitSeam`, on by default). Each band after the first
retracts in its preamble and leads with blank rows. Per boundary, the take-up adds 8
dots and the mid-label retract takes back 64, a net 56 dots (7 mm) early, so the band
leads with 56 blank rows (`SEAM_RETRACT_OVERSHOOT_DOTS`). They pass over ground the
previous band already printed, and the band's first real row lands exactly where the
previous one stopped. `planBands()` makes both halves of that decision, so the two
drivers cannot disagree.

**Fallback, with the seam fix off:** the 8 rows that fall in each band's take-up are
skipped (`SPLIT_SEAM_DOTS`), which keeps every other row where it was designed. The cut
is nudged up to 5 mm earlier, to the row that loses the least ink, so on most designs
the seam falls into white space. Worth keeping: 7 mm is one measurement on one stock,
and if it reads differently elsewhere it shows as a seam or an overlap.

### 2. A dither that compresses

Error diffusion scatters a photograph into nearly random dots that deflate cannot
compress; ordered dithering lays them on a grid. Compressed bytes for a 384 × 640
raster at the app's zlib settings:

| source         | Floyd–Steinberg | Atkinson | Bayer 8x8  |
| -------------- | --------------- | -------- | ---------- |
| smooth photo   | 23,140          | 25,266   | **6,422**  |
| textured photo | 25,519          | 27,397   | **13,780** |
| heavy grain    | 28,861          | 29,344   | 21,396     |

Diffusion strength is a gentler lever that keeps error diffusion. On the same raster:
23,140 bytes at full strength, 18,950 at 60%, **15,284 at 40%**, 8,639 at 20%.
Contrast is not a lever (+80 saves 14%), and nor is `windowBits` (10 → 15 saves 1.3%).
The print panel rasterises the alternatives and offers the mildest one that fits,
with the real numbers. `encodeImage.test.ts` pins the ratio and the threshold
crossing.

### 3. Blank rows after the label

`feedAfterDots` appends blank rows to advance to the next label. Predictable, but it
means measuring the stock when the printer has a working gap sensor, so it comes last.

## Geometry

203 dpi = **8 dots/mm** exactly.

**Head width on a P50S is 384 dots = 48 mm.** The `edgeFrame` test pattern inks the
outermost dots: at 384 all four sides print, at 400 an edge is lost.

**The raster is not padded to head width.** The vendor app prints a 40 mm label as
`rowBytes = 40`, 320 dots, and lets the printer position it. So head width is a limit,
not a canvas. `padToHead` survives as a diagnostic for addressing a specific head
column, off by default. Head width cannot be queried, so it is per-printer
configuration.

## Other models — [third-party]

From [tomLadder/thermoprint](https://github.com/tomLadder/thermoprint), whose notes
derive from a decompile of the vendor Android app. We have no hardware but a P50S.

MarkLife printers speak at least two dialects:

| Dialect | Models                   | Raster                                           | Here            |
| ------- | ------------------------ | ------------------------------------------------ | --------------- |
| **x2**  | P50, P50S, M60, X2       | `1F 10`, zlib-compressed, big-endian dims        | implemented     |
| **L11** | P15, P12, P7 and aliases | `1D 76 30`, **uncompressed**, little-endian dims | not implemented |

L11's vocabulary differs throughout, not just in the raster. `src/printer/profiles.ts`
recognises L11 names and refuses them with a reason
([ADR 0003](adr/0003-more-dialects-x2-first.md)). An **M60** profile ships marked
unverified: it claims only that the M60 speaks x2, and its head width and chunk size
are the P50's because nobody has measured one.

thermoprint's x2 notes agree with our capture byte for byte on the GATT profile, the
credits, the raster header and the job framing: two independent routes to the same
bytes. Where it differs, our capture wins, and we keep our own:

- **No wakeup frame.** It sends six zero bytes before `startPrintJob`; the vendor app
  does not, and printing works without them.
- **The 10-byte `setPrintParams`** with density passed straight through, not its
  4-byte form with density remapped.
- **`windowBits: 10`**, pinned by the SDK goldens, not its 14. Whether a P50S accepts
  a wider window is untested.

## When a print goes wrong

- **Slow, faint or cut short:** check the battery first. The head takes its heat from
  it, and the connection panel warns below 20%. `00 00` may mean empty or charging.
- **No `4F 4B`:** the printer may have stopped putting rows on paper while flow
  control stayed clean. Look at the label before trusting or distrusting it.
- **First label after loading a roll is misaligned:** expected. The seek at the end of
  each job registers the _next_ label, and no job has ended yet.
- **A tall label stops mid-label, or consecutive tall prints drift a gap-width each
  time:** the job is over 16 KB and its seek went unread. Check that splitting is on.
- **A line or an overlap at a band boundary:** the 7 mm seam correction does not fit
  this stock. Turn the seam fix off to fall back to skipping rows.
- **Empty device chooser:** the filter must be the name prefix, not the service UUID.
- **A job stalls before printing:** one of `ff01` and `ff03` is not subscribed.
- **A printer is refused at connect:** it speaks a dialect this app does not drive.

## Method

Four lessons this protocol taught more than once:

- **A command inert in one position may act in another**: before or after the raster,
  inside or outside a job. Test both before calling it unimplemented.
- **Credit a movement to a command only when the job contains nothing else that moves
  paper.** A full print moves paper by itself.
- **A capture of the vendor app beats any amount of inference from the SDK.**
- **Third-party findings are leads, not facts**, until they are seen on our own wire.

[`CAPTURING.md`](CAPTURING.md) covers both tools for that: capturing what the vendor
app sends, and probing a single command in a controlled job.
