# Third-party notices and provenance

## Runtime dependencies

| Package                                                   | License    | Used for                                                |
| --------------------------------------------------------- | ---------- | ------------------------------------------------------- |
| [pako](https://github.com/nodeca/pako)                    | MIT        | zlib deflate — the printer's raster payload compression |
| [React](https://react.dev/) / react-router                | MIT        | UI                                                      |
| [zod](https://zod.dev/)                                   | MIT        | document schema validation and migration                |
| [idb-keyval](https://github.com/jakearchibald/idb-keyval) | Apache-2.0 | IndexedDB persistence                                   |
| [fabric](http://fabricjs.com/)                            | MIT        | the editor canvas                                       |
| [bwip-js](https://github.com/metafloor/bwip-js)           | MIT        | barcode and QR rendering                                |

Dev-only: `vite`, `typescript`, `vitest`, `oxlint`, `prettier`, `playwright` (browser
test tier), `@zxing/library` and `jsqr` (decoding rendered barcodes back in tests).

## Protocol provenance

This project talks to MarkLife P50-family label printers over Bluetooth Low Energy.
It contains **no code from MarkLife or any of its SDKs.** The transport, rasterizer,
editor and command encoder are original work.

What we did use is _knowledge of the device's wire protocol_ — the command byte
sequences, the GATT service and characteristic UUIDs, and the layout of the raster
image header. These are interface facts about the hardware, not authored expression,
and they are independently documented in more than one public source.

Two sources deserve credit:

- **MarkLife** (<https://www.marklifeprinter.com>) and **MickeyGR**
  (<https://mickeygr.atokatl.dev>), authors of
  [`marklife-label-printer-web-kit`](https://gitlab.com/marklife/marklife-label-printer-web-kit).
  That SDK is published under a custom, non-open-source licence that forbids
  redistribution, so **it is not a dependency of this project and none of it is
  vendored, bundled or fetched at runtime.** Reading it is how the command set and
  image header layout below were confirmed.
- **[tomLadder/thermoprint](https://github.com/tomLadder/thermoprint)** (MIT), whose
  `REVERSE_ENGINEERING.md` documents the same protocol family from a decompile of the
  vendor's Android app, and independently corroborates the GATT profile.

### Note on the "proprietary" compression

The P50 raster payload was widely believed to use a proprietary compressor that had
never been reverse-engineered (the Android app implements it in native JNI code).

It is **stock zlib deflate**. The SDK's `dada`/`dudu` modules are
[pako](https://github.com/nodeca/pako) with the identifiers renamed — `Dada`→Deflate,
`dudu`→deflate, `duduInit2`→deflateInit2, alongside an intact `ZStream`,
`configuration_table`, `longest_match` and `fill_window`, and the standard zlib
CMF/FLG header construction.

The parameters are `level: -1, windowBits: 10, memLevel: 8, strategy: 0`. Calling
`pako.deflate` with those options reproduces the SDK's output **byte for byte**; this
is pinned by the golden-fixture test in `src/printer/protocol/`, whose expected values
were captured from the original SDK. The `windowBits: 10` in particular is
load-bearing — the default of 15 produces different bytes.

## Symbols

**No third-party icon set is used.** The seventy symbols in `src/render/icons.ts` are
original, drawn as plain SVG primitives in a 24×24 space and covered by this project's
MIT licence like the rest of the source.

The plan had been to inline a curated subset of [Lucide](https://lucide.dev/) (ISC),
and an earlier revision of this file claimed that is what happened. It is not: drawing
them turned out to be the better option and no Lucide path data was ever imported. Two
reasons it was worth the effort — a 203 dpi thermal head turns fine detail into mush,
so these need heavier strokes and fewer features than any screen icon set provides;
and there is no attribution to track.

The rights-and-licences group (copyright, copyleft, Creative Commons, CC BY/SA/NC/ND,
CC0, public domain, ®, ™) is likewise drawn from scratch rather than taken from the
official artwork. Those marks are simple geometry, and the official files carry fine
lettering that closes into a blob well before 10 mm on a thermal head.

Note that drawing a licence mark says nothing about the right to _use_ it: Creative
Commons asks that its marks identify actual licensing, and ® and ™ carry legal meaning
in most jurisdictions. Putting one on a label is the user's call, not this project's.
