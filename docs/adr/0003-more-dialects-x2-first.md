# Drive more than one dialect, starting with x2

MarkLife printers speak at least two dialects. LabelForge is meant to drive more than
one, but implements only x2 for now. A printer of a dialect the app cannot drive is
recognised by its advertised name and refused with a reason, never guessed at. That
refusal holds until the dialect is supported, not permanently.

A dialect not confirmed on our own hardware ships only behind an opt-in under
Diagnostics, labelled experimental. Without the opt-in its printers stay refused, so
nobody sends untested bytes to a printer by accident.

## Where the dialect interface sits

Under the drivers, not at `PrinterDriver`. A driver varies where bytes go, a
Bluetooth link or a printer that exists only in memory, and a dialect varies what
they are. Putting dialects at `PrinterDriver` would mean a class for every pairing
of driver and dialect. So each driver is handed a dialect (`src/printer/dialect.ts`),
and the dialect turns a label into a print plan: every band of every copy, each
job's commands and raster in order, what follows it as a write of its own, and
whether to wait for the printer before going on. The drivers decide only where the
writes break: the BLE driver chunks each job as one credited stream (ADR 0002), and
the virtual printer logs each command on its own line.

The document, rendering and the editor were already dialect-neutral; the bitmap
they hand over (`PackedBitmap`) is the only thing a dialect receives from them. Two
adapters sit behind the interface: x2, and a small test dialect that keeps the
drivers honest about knowing no x2 bytes.

The app reaches the dialect through the driver (`PrinterDriver.dialect`), and asks it
two things: the density levels it prints at, and whether a label's job fits its band
budget, which decides whether the print panel says the label goes out in bands and
whether a simpler dither would avoid that. The band budget is the dialect's own, and
sits below the printer's read-ahead; the panel and the print plan judge fit by that
one number. Print settings speak of stock, speed and density in the app's own terms;
the dialect turns them into bytes.

What was left x2's here has since moved behind the dialect, once a second dialect
needed it to: the connect handshake, status and reply decoding, the credit frame
format and pacing, the default chunk size, and the GATT service and characteristics
(ADR 0004). The Diagnostics panel still builds x2 commands and probe jobs itself.
