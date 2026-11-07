# Capturing and probing the printer

Two ways to settle a protocol question with evidence rather than inference: capture
what the vendor app really sends, or probe one command in a controlled job. The
findings go into [`PROTOCOL.md`](PROTOCOL.md); its "Method" section says why both
matter.

## Capturing the vendor app

**On the phone**

1. Enable **Developer options → Enable Bluetooth HCI snoop log**.
2. Reboot, so the log starts clean and stays short.
3. Turn off other Bluetooth devices first (earbuds, watch, car). The log records _all_
   Bluetooth traffic, so this means less noise and less private data.
4. Open the MarkLife app, connect, and print **the same label three times**, letting
   it feed after each. Three prints tell a one-off apart from something sent per
   print.
5. Note the label size you gave the app, and that it was three prints.

**Getting the log off the phone**

The log lives at `/data/misc/bluetooth/logs/btsnoop_hci.log`, which needs root, so
take it from a bug report:

```bash
adb bugreport snoop.zip
```

Inside the zip, the capture is at `FS/data/misc/bluetooth/logs/btsnoop_hci.log`.
Extract just that file; the rest of the zip is large and unrelated. Without `adb`,
**Developer options → Bug report** produces the same zip.

**Decoding it**

```bash
npm run snoop captures/btsnoop_hci.log
```

`scripts/parse-btsnoop.mjs` parses the btsnoop container, reassembles L2CAP, decodes
ATT, and resolves handles to characteristic UUIDs from the capture's own GATT
discovery. It prints a timeline and the concatenated command stream, with every byte
matched against the known command table. Unrecognised bytes are marked `?`; those are
the interesting ones. Other devices appear as packet counts only, so a capture can be
shared without handing over unrelated traffic. Wireshark (filter `btatt`) works too.

## Probing one command

Most commands on this printer are acknowledged and ignored when sent on their own, and
act only inside a job, on one side of the raster. Diagnostics has an instrument for
that: **feed _N_ mm, then send «hex»** (`probeJob()` in
`src/printer/protocol/probeJob.ts`).

It builds one real job: preamble, a blank raster of the requested height, the bytes
under test, `stopPrintJob`. What it leaves out is the point. It carries no gap seek,
no retract and no tear-off advance, so the paper ends exactly where the probe left it
and any movement belongs to the bytes under test. Feed a few millimetres for a
reference, send the bytes, read off what happened.

- **An empty probe is the control.** It shows what the job alone does, which every
  other reading is measured against.
- **Try both sides of the raster.** A command that does nothing on one side has only
  been ruled out there.
