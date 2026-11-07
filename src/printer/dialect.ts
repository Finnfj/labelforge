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
  /** Short, stable name, for logs and tests. */
  readonly id: string
  /**
   * Everything one print puts on the wire: every band of every copy, in order.
   *
   * Pure and synchronous. A dialect encodes the whole plan up front, so a driver
   * can count bytes for progress before it sends the first one.
   */
  planPrint(bitmap: PackedBitmap, settings: PrintSettings): PrintPlan
}

/** The ordered jobs a dialect produces to put one label on paper. */
export interface PrintPlan {
  jobs: PlannedJob[]
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
  /** Which copy this job belongs to, counting from 1. */
  copy: number
  parts: JobPart[]
  /** Sent after the job's stream has gone, as transfers of their own. */
  epilogue: NamedCommand[]
  /**
   * Whether to wait for the printer to report the job done before going on.
   *
   * Null for a job that is followed without waiting. A driver with nothing to
   * wait for, such as the virtual printer, ignores it.
   */
  wait: JobWait | null
}

export interface JobWait {
  /** How long the printer may take, at least, before its silence means something. */
  timeoutMs: number
  /**
   * What silence means.
   *
   * `stop-copy`: the rest of this copy cannot safely follow, so its remaining jobs
   * are not sent. The copy still ends with the wait of its last job.
   * `warn`: the job may well be fine; say so, and carry on.
   */
  onSilence: 'stop-copy' | 'warn'
}

/** Bytes of a job's stream, which is what a driver's progress counts. */
export function jobStreamBytes(job: PlannedJob): number {
  return job.parts.reduce((n, part) => n + part.bytes.length, 0)
}

/** The plan's jobs grouped by copy, in order. */
export function jobsByCopy(plan: PrintPlan): PlannedJob[][] {
  const copies: PlannedJob[][] = []
  for (const job of plan.jobs) {
    const last = copies.at(-1)
    if (last && last[0].copy === job.copy) last.push(job)
    else copies.push([job])
  }
  return copies
}
