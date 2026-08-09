# LabelForge

A browser-based label designer and printer driver for **MarkLife P50 / P50S** thermal
label printers, built to replace the vendor's phone app.

No install, no server, no account: it is a static site that talks to the printer
directly over **Web Bluetooth**.

## Status

Early development. See `docs/PROTOCOL.md` for the reverse-engineered wire protocol and
`docs/THIRD_PARTY.md` for provenance and licensing.

## Requirements

- **Chrome or Edge on Windows/macOS/ChromeOS**, or **Chrome on Android**.
  Safari and Firefox do not implement Web Bluetooth and cannot work.
- HTTPS (or `localhost`). GitHub Pages satisfies this.

## Development

```bash
npm install
npm run dev
```

```bash
npm test
```

The renderer, the protocol encoder and the label model are all testable without a
printer. A **virtual printer** renders exactly the bitmap the real device would
receive, so the whole app can be developed and verified with no hardware attached.

## Licence

MIT — see `LICENSE`. This project contains no vendor SDK code; see
`docs/THIRD_PARTY.md`.
