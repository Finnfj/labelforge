# Dialects own their link and their conversation

A second dialect, DYMO's LetraTag, differs from x2 in everything ADR 0003 left as x2's
in the BLE driver and the transport. It uses a different GATT service, with no credits
channel. It frames its own chunks, with a header write, sequence numbers and a
trailer, and its writes are paced by the printer acknowledging each one. It replies
with result codes rather than "OK". So the dialect interface grows two parts beside the
print plan:

- **The link**: the GATT layout and write mode, how a job's stream is cut into chunks,
  and what paces them, either credits or acknowledged writes.
- **The conversation**: the handshake after connecting, identity and status queries,
  gap calibration where there is a gap sensor, and what a status-channel notification
  means for a print: done, done with a warning, failed with a reason, or nothing.

There is still one BLE driver and one Bluetooth transport, and they keep the
mechanics: writing, waiting for credits or for the printer, aborting, progress and
disconnection. The printer profile names its dialect. The chooser asks for every known
name prefix and every known service, because the browser grants only services named
before it opens. The driver then reads the advertised name, adopts the profile and its
dialect, and only then opens the service that dialect names.

A dialect also says which print settings it takes, density and speed, so the print
panel shows only those without naming any printer.

A dialect not yet confirmed on our own hardware has the profile support level
`experimental`, and the driver refuses it unless experimental support is switched on,
as ADR 0003 requires.

## Considered Options

- **A driver per dialect.** What the LetraTag pull request did. It duplicated the
  connect, state and abort code, and made the app choose a driver by brand before it
  knew the printer. ADR 0003 already ruled out a class for every pairing.
- **The GATT layout on each profile.** Every x2 profile would repeat the same four
  UUIDs. The layout follows the dialect, and a model that ever differs can still
  override it.
- **The link outside the dialect, as a separate registry.** A dialect's framing (the
  LetraTag's header checksum and its sequence index that skips 27) is part of what its
  bytes are, so it sits with the rest of them.

## Consequences

The Diagnostics panel still builds x2 commands itself, and is disabled for any other
dialect. Making it dialect-aware is its own piece of work.
