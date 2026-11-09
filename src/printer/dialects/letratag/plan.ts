import type { PackedBitmap } from '../../../model/bitmap'
import { dotsToMm } from '../../../model/units'
import { jobStreamBytes, type JobAssessment, type PlannedJob, type PrintPlan } from '../../dialect'
import type { PrintSettings } from '../../types'
import { labelJobParts } from './commands'
import { PRINT_MM_PER_SECOND, PROBE, PROBE_WAIT_MS, RESULT_BASE_WAIT_MS } from './constants'

/**
 * The LetraTag print plan: per copy, the probe, then the label as one job.
 *
 * - **Probe.** The vendor app writes `1B 41 00` on its own before every job and waits
 *   for its reply, so each copy does too. It streams nothing and goes as a write of
 *   its own. Silence there is no reason to give up the label: the probe moves no
 *   paper, and what it asks is unknown. So the label goes regardless, as it did in
 *   the contributor's driver, which printed with it.
 * - **Label.** One job, however long: the LetraTag has no gap to seek, so nothing
 *   is ever banded. Its result is waited for once the label has had time to print.
 *
 * Density, speed and stock are ignored. The dialect has no density or speed
 * setting, and the tape is continuous.
 */
export function planLetraTagPrint(bitmap: PackedBitmap, settings: PrintSettings): PrintPlan {
  const probe: PlannedJob = {
    parts: [],
    epilogue: [{ bytes: PROBE, note: 'probe' }],
    waitMs: PROBE_WAIT_MS,
    goOnIfSilent: true,
  }
  const label = labelJob(bitmap)
  // Twice the time the label takes at its rated speed, on top of the allowance: the
  // contributor's margin, since the rated speed is a "max", not a measured one.
  const printMs = (dotsToMm(bitmap.heightDots) / PRINT_MM_PER_SECOND) * 1000
  const finishWaitMs = RESULT_BASE_WAIT_MS + 2 * printMs
  return {
    copies: Array.from({ length: settings.copies }, () => ({
      jobs: [probe, label],
      finishWaitMs,
    })),
  }
}

/** Every LetraTag label goes out as one job, uncompressed: only its length counts. */
export function assessLetraTagJob(bitmap: PackedBitmap): JobAssessment {
  return { bytes: jobStreamBytes(labelJob(bitmap)), compressed: false, fits: true }
}

/** The label as one job, whose result the copy's finish wait takes. */
function labelJob(bitmap: PackedBitmap): PlannedJob {
  return { parts: labelJobParts(bitmap), epilogue: [], waitMs: null }
}
