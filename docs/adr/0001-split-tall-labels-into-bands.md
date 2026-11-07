# Register tall labels by splitting them into bands

A job registers its label only if the printer has read all of it before it starts
printing, and a P50S starts once about 18 KB is in its buffer. So a label whose job
would be larger is split into bands, each a job under the limit. The bands are sent
one at a time, each waiting for the printer's acknowledgement, and only the last one
carries the gap seek. It is the only route that registers a tall label with the
picture exactly as designed.

## Considered Options

- **Bands sent back to back.** The printer accepts no job while it is working on
  one, so only the first band printed.
- **A follow-up job carrying only a gap seek.** A seek sent on its own needs about
  24 mm of approach, and a retract winds back under 20, so every attempt cost a
  blank label.
- **A coarser dither to shrink the job.** Brings most photographs under the limit,
  not all of them. Offered as an alternative in the print panel, not relied on.
- **Feeding a measured number of blank rows.** Predictable, but it means measuring
  the stock when the printer has a gap sensor that works. Kept as a fallback.
