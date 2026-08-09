# LabelForge

A browser-based label designer and printer driver for **MarkLife P50 / P50S** thermal
label printers, built to replace the vendor's phone app.

No install, no server, no account: a static site that talks to the printer directly
over **Web Bluetooth**.

## Status

The design and rasterising half is complete and testable without hardware. The
Bluetooth driver and the on-device diagnostics page are the remaining work.

Working today:

- Label documents in millimetres, with stock presets and gap/continuous paper
- Text, rectangles, ellipses and lines
- Barcodes (Code 128/39, EAN-8/13, ITF-14, GS1-128, Data Matrix) and QR codes,
  rendered at whole-dot module widths with proper quiet zones
- Image upload with per-image threshold, inversion, and a line-art/photo choice
  that decides between hard thresholding and Floyd–Steinberg dithering
- A 36-symbol library drawn for thermal output
- Templates, plus self-contained JSON export/import with images inlined
- A **virtual printer** that runs the real command sequence and the real encoder,
  then shows the exact bitmap the hardware would receive — including a thermal-bleed
  simulation that reveals text which will smear shut before you waste a label

## Requirements

- **Chrome or Edge on Windows/macOS/ChromeOS**, or **Chrome on Android**.
  Safari and Firefox do not implement Web Bluetooth and cannot work.
- HTTPS or `localhost`. GitHub Pages satisfies this.

## Development

```bash
npm install
npm run dev
```

```bash
npm test
```

Tests run in two tiers. Pure logic — geometry, 1-bit packing, compression, the
protocol encoder — runs in Node. Anything touching a canvas runs in real Chromium
via Playwright, because rasterising text or barcodes in jsdom would exercise a
different renderer than the one that ships.

The strongest test in the suite renders each barcode exactly as it would be sent to
the head, then decodes it back with zxing and jsQR. That is the only way to catch a
code that looks right on screen and will not scan on paper.

```bash
npx playwright install chromium   # once, for the browser tier
```

## Documentation

- `docs/PROTOCOL.md` — the wire protocol: GATT profile, command set, raster format
- `docs/THIRD_PARTY.md` — dependencies, provenance and licensing

## Licence

MIT — see `LICENSE`. This project contains no vendor SDK code; see
`docs/THIRD_PARTY.md`.
