import type { PackedBitmap } from '../model/bitmap'
import type { PrintSettings } from './types'

/**
 * The dialect interface: what a printer dialect supplies to the drivers.
 *
 * A dialect is a command family shared by a group of printer models (see
 * GLOSSARY.md). The drivers vary *where* bytes go — a Bluetooth link, or a
 * printer that exists only in memory. A dialect decides *what* the bytes are: it
 * turns a label into a print plan, and neither driver knows a single command of
 * it. Where this line falls, and why, is recorded in ADR 0003.
 */
export interface Dialect {
  /**
   * Everything one print puts on the wire: every band of every copy, in order.
   *
   * Pure and synchronous. A dialect encodes the whole plan up front, so a driver
   * can count bytes for progress before it sends the first one.
   */
  planPrint(bitmap: PackedBitmap, settings: PrintSettings): PrintPlan
}

/** The ordered jobs a dialect produces to put one label on paper, copy by copy. */
export interface PrintPlan {
  copies: PlannedCopy[]
}

/** One copy of the label: its jobs in order, and how it ends. */
export interface PlannedCopy {
  jobs: PlannedJob[]
  /**
   * How long to wait, after the copy's last job, for the printer to report the
   * label finished, or null to go straight on.
   *
   * Every copy ends with this wait, a copy cut short by a silent job included, so
   * the printer has stopped moving paper before anything else is sent. Silence
   * here is reported rather than acted on: the label may well be fine.
   */
  finishWaitMs: number | null
}

/** A command with the name the diagnostics log shows for it. */
export interface NamedCommand {
  bytes: Uint8Array
  note: string
}

/** One piece of a job, in the order the printer reads it. */
export type JobPart = ({ kind: 'command' } & NamedCommand) | { kind: 'raster'; bytes: Uint8Array }

/**
 * One job of the plan.
 *
 * `parts` is what the printer parses as the job itself. Where the writes break
 * is the driver's business, not the dialect's: the BLE driver joins the parts
 * into one stream and chunks it, so every byte waits for a credit (ADR 0002),
 * and the virtual driver logs each command on its own line.
 */
export interface PlannedJob {
  parts: JobPart[]
  /** Sent after the job's stream has gone, each as a write of its own. */
  epilogue: NamedCommand[]
  /**
   * How long to wait for the printer to report this job done before sending the
   * next one, or null to go straight on.
   *
   * Silence stops the rest of the copy: the next job would go to a printer still
   * moving paper. A driver may wait longer than this, never shorter; the BLE
   * driver has a minimum of its own. A driver with nothing to wait for, such as
   * the virtual printer, ignores it.
   */
  waitMs: number | null
}

/** Bytes of a job's stream, which is what a driver's progress counts. */
export function jobStreamBytes(job: PlannedJob): number {
  return job.parts.reduce((n, part) => n + part.bytes.length, 0)
}

/** Bytes of every job's stream in the plan: the total a driver's progress runs to. */
export function planStreamBytes(plan: PrintPlan): number {
  return plan.copies.reduce(
    (n, copy) => n + copy.jobs.reduce((m, job) => m + jobStreamBytes(job), 0),
    0,
  )
}
