# LabelForge printing

The language of getting a label design onto paper on a MarkLife thermal printer:
what goes over the wire, and what the paper does.

## Sending a label

**Job**:
One bracketed unit of work the printer reads and prints, from its start command to
its stop command.
_Avoid_: print, transfer

**Chunk**:
One Bluetooth write, a slice of a job's byte stream.
_Avoid_: packet, band

**Credit**:
The printer's permission to send one more chunk.
_Avoid_: token, ack

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
A command family shared by a group of printer models, such as x2 or L11.
_Avoid_: protocol version, generation

**Evidence tier**:
How a protocol fact was established: read from the vendor SDK, tested on hardware,
captured from the vendor app, or taken from a third party.
