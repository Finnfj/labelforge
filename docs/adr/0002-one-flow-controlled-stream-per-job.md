# Send each job as one flow-controlled byte stream

A job's preamble, raster and trailer are concatenated into one byte stream and
chunked as a whole, so every byte waits for a credit, as the vendor app's own
traffic shows. Writing the framing commands as separate Bluetooth writes worked on
short labels. On an 80 mm label the credit window was empty when the trailer went
out uncredited, the gap seek in it was lost, and the label printed without
registering.

This holds for every dialect whose link is paced by credits, which x2's is. A link
paced by acknowledged writes, such as the LetraTag's, chunks its job as one stream
too, and every write in it waits for the printer's acknowledgement (ADR 0004).
