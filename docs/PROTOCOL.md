# MarkLife P50 / P50S wire protocol

Everything here was established by reading the vendor SDK's source and verified
empirically where possible. See `docs/THIRD_PARTY.md` for provenance.

Unverified-on-hardware items are marked **[unconfirmed]** — they come from the SDK or
from community reverse-engineering but have not yet been observed against a real
printer. Update this file as the diagnostics page confirms them.

## Transport

Bluetooth **Low Energy** (GATT). Not Bluetooth Classic / SPP — the device never
appears as a pairable device in the OS Bluetooth settings, which is why the vendor
manual tells users not to pair from system settings.

| Role | UUID |
| --- | --- |
| Primary service | `0000ff00-0000-1000-8000-00805f9b34fb` |
| Notify — printer status | `0000ff01-0000-1000-8000-00805f9b34fb` |
| Write — host to printer | `0000ff02-0000-1000-8000-00805f9b34fb` |
| Notify — flow-control credits | `0000ff03-0000-1000-8000-00805f9b34fb` |

Discovery: filter on the advertised **name prefix** (`P50`), *not* on the service
UUID. These printers do not advertise the 128-bit service UUID, so a service filter
returns an empty device chooser. Advertised names look like `P50_2950_BLE`.

Writes go to `ff02` in chunks of ~90 bytes.

**Flow control — confirmed on a P50S (firmware V2.0.00).** `ff03` frames are
`[type, ...]` and **only type `0x01` carries credits**. The opening frame is
`01 04`, which sets the window to 4; subsequent `01 01` frames each add one, and
one arrives per write. A frame of `02 dc 00` was also observed on this channel
and is *not* a credit grant — its meaning is unknown. Reading byte 1 regardless
of the type, as the vendor SDK does, turns that into a phantom grant of 220 and
silently disables flow control for the rest of the session.

Use ~5 ms between chunks while credits are flowing, falling back to ~30 ms if
`ff03` never fires.

Subscribe to **both** `ff01` and `ff03` before starting a print, or the job stalls.

## Commands

All multi-byte values are big-endian.

### Print control

| Purpose | Bytes |
| --- | --- |
| Start print job | `1F C0 01 00` |
| Stop print job | `1F C0 01 01` |
| Set BT type (send after connecting) | `1F B2 00` |
| Align paper to start | `1F 11 51` |
| Align paper to end (feed out) | `1F 11 50` |
| Adjust position | `1F 11 <mode> <distHi> <distLo>` |
| Locate | `1F 12 <mode> 00` |
| Locate (auto) | `0C` |

`adjustPosition` mode: `0x00` forward in dots, `0x01` forward in mm, `0x10` backward
in dots, `0x11` backward in mm.
`locate` mode: `0x10` none, `0x20` gap (die-cut labels), `0x30` black mark.

### Configuration

| Purpose | Bytes |
| --- | --- |
| Set paper type | `1F 80 01 <type>` — `10` continuous, `20` gap, `30` black mark |
| Get paper type | `1F 80 00` |
| Set density (darkness) | `1F 70 01 <1..15>` |
| Get density | `1F 70 00` |
| Set speed | `1F 60 01 <0 low \| 1 med \| 2 high>` |
| Get speed | `1F 60 00` |

### Maintenance and status

**Several of these are inert on a P50S (firmware V2.0.00).** `1f 40` (self test),
`1f 30 60` (learn paper), `1f 12 20 00` (locate gap) and `1f 11 50` (feed) each
produced no observable effect — the printer accepts the write, grants a credit,
and does nothing. Wrapping them in `1f c0 01 00` … `1f c0 01 01` makes no
difference; that was tried and refuted.

They are kept in the command table because they come from the vendor SDK and may
be implemented on other models in the family, but nothing should depend on them.
**Printing does not need any of them.**

A caution about how this was nearly mis-concluded: `1f 11 50` seemed to "work
inside a print", but printing a raster advances the paper by itself, so the feed
could not be attributed to the command. Only commands whose effect is
distinguishable from the raster print should be treated as confirmed.

Confirmed working, by contrast: `1f c0` (job control), `1f 10` (raster) and the
`10 ff` information queries.

| Purpose | Bytes |
| --- | --- |
| Self test print | `1F 40` |
| Learn paper (calibrate gap sensor) | `1F 30 60` |
| Read sensor | `1F 30 <00 temp \| 01 voltage \| 02 opto>` |
| Printer status | `1F 20 00` |
| Model | `10 FF 20 F0` |
| Firmware version | `10 FF 20 F1` |
| Serial number | `10 FF 20 F2` |
| Battery | `10 FF 50 F1` |
| Bluetooth MAC | `10 FF 30 11` |
| Set auto-shutdown minutes | `10 FF 12 <hi> <lo>` |
| Get auto-shutdown | `10 FF 13` |

Note the two prefixes are not two protocol generations: `1F` is used for print
control and configuration, `10 FF` for device-information queries. There is no
version negotiation anywhere in the command set.

### Dangerous — never expose in normal UI

| Purpose | Bytes |
| --- | --- |
| Reset to factory data | `1F 50 BE` |
| Enter bootloader | `1F A0 BE 66 88` |

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
  strategy: 0 })` — a standard zlib stream, *not* raw deflate.

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

| Query | Reply | Decoded |
| --- | --- | --- |
| firmware `10 FF 20 F1` | `56 32 2e 30 2e 30 30` | ASCII `V2.0.00` |
| serial `10 FF 20 F2` | `35 30 …  00` | ASCII digits, NUL-terminated |
| battery `10 FF 50 F1` | `00 64` | `0x64` = 100 (percent) |
| print complete | `4f 4b` | ASCII `OK` |

**Silent queries.** Model `10 FF 20 F0`, MAC `10 FF 30 11` and status `1F 20 00`
produced no reply at all on this unit — only the usual credit frames. The model
is recoverable from the advertised BLE name (`P50S_nnnn_BLE`) instead; there is
currently no known way to read the MAC or a fault code.

## Print sequence

```
setPaperType(gap|continuous)
startPrintjob
alignPaperStart            (1F 11 51)
<raster image command>     (1F 10 …)
stopPrintjob
alignPaperEnd              (1F 11 50)
```

## Geometry

203 dpi = **8 dots/mm** exactly.

**Head width on a P50S is 384 dots = 48.0 mm**, agreeing with the vendor SDK.
Established with the `edgeFrame` pattern, which inks the outermost dots of the
raster: at 384 all four sides print; at 400 the edge is lost.

This was briefly recorded here as 400 on weaker evidence — a label right-aligned
against 384 landed 16 dots too far left, and 400 − 384 = 16 looked conclusive.
It was not. That inference assumed the printable label was exactly 320 dots wide,
and a horizontal *placement* error cannot distinguish a wider head from paper
sitting further right. Prefer the test that measures the thing directly.

**Unresolved:** with a 40 mm roll and a 384-dot head, a rectangle drawn on the
label bounds still lands left of them, which implies the paper sits further right
than `align: right` puts it — i.e. the printable stock is wider than the die-cut
label, or narrower than 320 dots. This is what the offset is for; it is a
per-stock measurement, not a protocol fact.

None of this is queryable, so it stays per-printer configuration.
