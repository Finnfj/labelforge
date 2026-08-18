# Third-party notices and provenance

## Runtime dependencies

| Package                                                                   | License    | Used for                                                |
| ------------------------------------------------------------------------- | ---------- | ------------------------------------------------------- |
| [pako](https://github.com/nodeca/pako)                                    | MIT        | zlib deflate — the printer's raster payload compression |
| [React](https://react.dev/) / react-router                                | MIT        | UI                                                      |
| [zod](https://zod.dev/)                                                   | MIT        | document schema validation and migration                |
| [idb-keyval](https://github.com/jakearchibald/idb-keyval)                 | Apache-2.0 | IndexedDB persistence                                   |
| [fabric](http://fabricjs.com/)                                            | MIT        | the editor canvas                                       |
| [bwip-js](https://github.com/metafloor/bwip-js)                           | MIT        | barcode and QR rendering                                |
| [@fontsource/fira-sans](https://fontsource.org/fonts/fira-sans)           | OFL-1.1    | bundled label font                                      |
| [@fontsource/archivo-narrow](https://fontsource.org/fonts/archivo-narrow) | OFL-1.1    | bundled label font                                      |
| [@fontsource/jetbrains-mono](https://fontsource.org/fonts/jetbrains-mono) | OFL-1.1    | bundled label font                                      |

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

### Another app for the same printers

[tomLadder/thermoprint](https://github.com/tomLadder/thermoprint) is an independent
browser app for MarkLife printers. **No code from it is used here.** What was taken is
factual: which models exist, which advertised-name prefixes they use, and that the
family splits into two protocol dialects — recorded in `docs/PROTOCOL.md` under a
tier-4 heading and in `src/printer/profiles.ts`.

Two reasons no code, in descending order of how much they matter.

The first is that there is no licence to rely on. The README carries an MIT badge and
`packages/core/package.json` says `"license": "MIT"`, but the repository contains **no
LICENSE file** — the README's own link to one is a 404, and the GitHub API reports
`"license": null`. The author's intent is clear enough, but the grant itself is absent,
and "probably fine" is not the standard this file holds anything else to.

The second is provenance. Their `REVERSE_ENGINEERING.md` states it derives from a JADX
decompile of the vendor Android app (`com.feioou.deliprint.yxq` v3.6.0). Facts sourced
that way are second-hand for us — a stranger's reading of a decompile we have not
repeated — which is exactly why they get their own, weaker evidence tier rather than
being folded in with things we confirmed on hardware.

Worth stating plainly because it cuts the other way too: their reconstruction of the
compressed dialect and ours agree byte for byte, reached by different routes. That is
corroboration, and it is recorded as such.

## Fonts

Three typefaces ship with the app: **Fira Sans**, **Archivo Narrow** and **JetBrains
Mono**, all under the **SIL Open Font License 1.1**. The full notices are in
[`public/fonts/OFL.txt`](../public/fonts/OFL.txt), which is served alongside the font
files rather than only living in this repository — the OFL asks that the licence
travel with the font software, and a doc in a git tree does not travel with a
`.woff2` on a CDN. The app footer links to it, so it is reachable and not merely
present.

To be precise about the obligation: OFL 1.1 requires each copy of the font software
to carry the copyright notice and the licence, and accepts a stand-alone text file as
one of the ways to do that. It has **no display requirement** — unlike CC BY, it does
not ask for visible attribution inside the product. Shipping `OFL.txt` beside the
files is therefore sufficient on its own; the footer link exists because SIL
recommends a findable mention, and because a licence nobody can locate is a poor kind
of compliance.

**The OFL does not reach this project's code.** SIL's own FAQ is explicit that only
portions based on the font software fall under the OFL, and that bundling with
software under other licensing is intended and allowed. LabelForge stays MIT.

They are shipped **unmodified**, which is a deliberate choice rather than laziness.
The OFL treats subsetting and format conversion as producing a Modified Version, and
a Modified Version may not keep a font's Reserved Font Name. Serving the exact files
`@fontsource` publishes means that question never has to be answered: no subsetting
here, no conversion here, no renaming obligation. The Latin-only, 400-and-700 subsets
were already made and published upstream.

Only regular and bold are bundled. Italic is not, because nothing in the UI can set
it — the field exists on `TextElement` and reaches Fabric, but no control writes it,
so the files would be bytes for an unreachable state. Bold _is_ bundled rather than
left to the browser's synthetic emboldening, which thickens stems by an amount nobody
chose; at 203 dpi that is a visible difference rather than a subtle one.

### Fonts the user adds

Users can add their own font files. **"Added", not "uploaded"** — the wording in the
UI is deliberate, because there is nothing here to upload to. The file is read in the
browser, registered with the browser's own font set, and kept in IndexedDB on that
device; this app has no server and never sends a font anywhere. For local use that is
the user's own font on the user's own machine, and their licence to it is theirs to
hold.

Exporting is where this project takes a position. Putting font bytes into a file you
hand to someone else is redistribution, and most commercial font licences forbid it
outright. So unlike images — which are always inlined, on the grounds that a label
silently losing its logo is worse than a larger file — **font bytes are not embedded
by default.** An export carries the font's name and size so the receiving machine can
say exactly what is missing, and embedding the bytes is a checkbox the exporter has to
tick, next to a line saying what ticking it means. The app should not make an
unlicensed redistribution the path of least resistance.

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
