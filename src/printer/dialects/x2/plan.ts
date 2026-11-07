import type { PackedBitmap } from '../../../model/bitmap'
import type { JobPart, NamedCommand, PlannedJob, PrintPlan } from '../../dialect'
import type { PrintSettings } from '../../types'
import { printJobFraming } from './commands'
import { printDurationMs } from './constants'
import { encodeImage } from './encodeImage'
import { planBands } from './splitJob'

/**
 * The x2 print plan: one label, every band of every copy.
 *
 * One label is one print, however many jobs it takes. A label too large for the
 * printer to read whole before it starts is split into bands (ADR 0001), each a
 * job of its own. Per band:
 *
 * - **Retract.** When the paper seam is being closed — the default — every band
 *   retracts: the first to undo the tear-off advance behind it, the rest to undo
 *   the take-up their own job start costs. The planner leads those bands with the
 *   blank rows the retract overshoots by. Left open, only the first band retracts
 *   and the planner gives up the take-up's rows instead. The three decisions —
 *   rows skipped, blank rows led with, retract sent — are made here together, so
 *   they cannot disagree.
 * - **Gap seek** only in the last band; two would cost a blank label.
 * - **Tear-off advance** once, after the last band, as a write of its own.
 * - **Wait.** The printer takes no job while it is working on one, so each band
 *   waits for the one before it; silence there stops the rest of the copy. The
 *   last band waits for the whole label to print, and silence only warns.
 *
 * Configuration rides along in every job of every copy, inside the job, exactly
 * as the vendor app sends it.
 */
export function planX2Print(bitmap: PackedBitmap, settings: PrintSettings): PrintPlan {
  const closeSeam = settings.closeSplitSeam !== false
  const bands = settings.splitForSeek === false ? [bitmap] : planBands(bitmap, { closeSeam })
  const rasters = bands.length === 1 ? [encodeImage(bitmap)] : bands.map(encodeImage)
  const { epilogue } = printJobFraming(settings)
  const labelMs = printDurationMs(bitmap.heightDots)

  const jobs: PlannedJob[] = []
  for (let copy = 1; copy <= settings.copies; copy++) {
    bands.forEach((band, i) => {
      const last = i === bands.length - 1
      const framing = printJobFraming({
        ...settings,
        alignStart: i === 0 || closeSeam,
        // Overrides `settings.seekGap`, so a print asked for without a seek still
        // seeks in its last band. That is what both drivers did before this plan
        // existed, and the plan was introduced without changing a byte on the wire.
        seekGap: last,
      })
      jobs.push({
        copy,
        parts: [
          ...framing.preamble.map(command),
          { kind: 'raster', bytes: rasters[i] },
          ...framing.trailer.map(command),
        ],
        epilogue: last ? epilogue : [],
        wait: last
          ? { timeoutMs: labelMs, onSilence: 'warn' }
          : { timeoutMs: printDurationMs(band.heightDots), onSilence: 'stop-copy' },
      })
    })
  }
  return { jobs }
}

function command(c: NamedCommand): JobPart {
  return { kind: 'command', bytes: c.bytes, note: c.note }
}
