# LabelForge printing

The language of getting a label design onto paper on a Bluetooth thermal label
printer: what goes over the wire, and what the paper does.

## Sending a label

**Job**:
One bracketed unit of work the printer reads and prints, from its start command to
its stop command.
_Avoid_: print, transfer

**Chunk**:
One Bluetooth write carrying part of a job: a slice of its byte stream, or framing
the dialect's link requires around it.
_Avoid_: packet, band

**Credit**:
The printer's permission to send one more chunk. A link paced by acknowledged writes
has none.
_Avoid_: token, ack

**Link**:
How a dialect's printers carry a job over Bluetooth: the service they are reached on,
how a job is cut into chunks, and what paces them.
_Avoid_: transport (the transport is the Bluetooth connection itself), protocol

**Pacing**:
What decides when the next chunk may go: a credit from the printer, or the printer
acknowledging the write before.
_Avoid_: throttling

**Band**:
A horizontal slice of one label's raster, sent as a job of its own.
_Avoid_: part, chunk, split

**Print plan**:
The ordered jobs a dialect produces to put one label on paper, every band of every
copy.
_Avoid_: job list, schedule

**Read-ahead**:
How much of a job the printer takes in before it starts printing. A job larger than
this has its gap seek read too late to register the label.
_Avoid_: buffer size, seek limit

**Band budget**:
The largest job a dialect sends whole. A label whose job is bigger goes out in bands.
Set below the read-ahead, to leave headroom.
_Avoid_: split budget, seek limit, read-ahead (the read-ahead is the printer's)

## Paper motion

**Stock**:
The paper on the roll, by how its labels are marked out: gap labels, continuous, or
black mark.
_Avoid_: paper type, media

**Gap seek**:
The printer advancing paper to the next label gap, found by its own sensor.
_Avoid_: locate, alignment, feed

**Registration**:
Each label starting at its gap. A roll is registered, or has lost its place.
_Avoid_: alignment, calibration

**Retract**:
The printer winding paper back.
_Avoid_: rewind, align start

**Tear-off advance**:
Feeding a finished label out to the tear bar.
_Avoid_: feed out, align end

**Take-up**:
The paper a job advances before it prints its first row.
_Avoid_: lead-in

**Approach distance**:
How much label must still lie ahead of the head for a seek sent on its own to find
that label's gap rather than the next one.
_Avoid_: lead

**Seam**:
The boundary on paper between two bands of one label. Where code design is the topic,
the place a module's interface lives is its **interface**, never a seam.
_Avoid_: gap, join (a gap is the stock's own space between labels)

## Printers

**Dialect**:
A command family shared by a group of printer models, such as MarkLife's x2 and L11,
or DYMO's LetraTag.
_Avoid_: protocol version, generation

**Conversation**:
What a dialect says to a printer outside a print, and what the printer's replies
mean: the greeting after connecting, questions about itself, and its report that a
job is done or failed.
_Avoid_: handshake (only the greeting), protocol

**Evidence tier**:
How a protocol fact was established: read from the vendor SDK, tested on hardware,
captured from the vendor app, or taken from a third party.
