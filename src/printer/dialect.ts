import type { PackedBitmap } from '../model/bitmap'
import type { PrinterStatus, PrintSettings } from './types'

/**
 * The dialect interface: what a printer dialect supplies to the drivers.
 *
 * A dialect is a command family shared by a group of printer models (see
 * GLOSSARY.md). The drivers vary *where* bytes go — a Bluetooth link, or a
 * printer that exists only in memory. A dialect decides *what* the bytes are, and
 * what the printer's replies mean: it turns a label into a print plan, says how
 * its link carries a job, and holds the conversation the printer expects. Neither
 * driver knows a single command of it. Where this line falls, and why, is recorded
 * in ADR 0003 and ADR 0004.
 */
export interface Dialect {
  /**
   * The density levels it prints at, and the one it uses when none is asked for;
   * null for a dialect with no density setting, which the print panel then hides.
   */
  readonly density: DensityRange | null
  /** Whether it takes a print speed at all. Without one, the panel offers none. */
  readonly takesSpeed: boolean
  /** How its printers' Bluetooth link carries a job. */
  readonly link: Link
  /** What it says to a printer outside a print, and what the printer's replies mean. */
  readonly conversation: Conversation
  /**
   * How big this bitmap's job would be, and whether it goes out whole.
   *
   * What the print panel asks before a print, to say whether the label goes out
   * as several bands and whether a simpler picture would avoid that.
   */
  assessJob(bitmap: PackedBitmap): JobAssessment
  /**
   * Everything one print puts on the wire: every band of every copy, in order.
   *
   * Pure and synchronous. A dialect encodes the whole plan up front, so a driver
   * can count bytes for progress before it sends the first one.
   */
  planPrint(bitmap: PackedBitmap, settings: PrintSettings): PrintPlan
}

/**
 * How big a bitmap's job would be, and whether it goes out whole.
 *
 * A job within the dialect's band budget (see GLOSSARY.md) goes out as one; one
 * over it is split into bands, and only then is the budget worth reporting.
 */
export type JobAssessment = {
  /** Bytes of the job that would carry this bitmap. */
  bytes: number
  /**
   * Whether the picture's content changes the size: true for a compressed raster,
   * where a simpler dither makes a smaller job; false where only the dimensions
   * count, and no change to the picture would help.
   */
  compressed: boolean
} & (
  | {
      /** Within the band budget: the label goes out as one job. */
      fits: true
    }
  | {
      /** Over the band budget: the label goes out in bands. */
      fits: false
      /** The largest job the dialect sends whole. */
      bandBudgetBytes: number
    }
)

export interface DensityRange {
  min: number
  max: number
  default: number
}

/**
 * The density level a print goes out at on this dialect.
 *
 * The one asked for, clamped into the dialect's range, since it may have been set
 * on another printer; or the dialect's own default when none was asked for.
 * Undefined for a dialect with no density setting.
 */
export function densityLevel(dialect: Dialect, asked: number | undefined): number | undefined {
  if (!dialect.density) return undefined
  const { min, max } = dialect.density
  return Math.min(max, Math.max(min, asked ?? dialect.density.default))
}

/**
 * How a dialect's printers carry a job over Bluetooth.
 *
 * The BLE driver owns the mechanics — writing, waiting for credits, aborting — and
 * asks the link for the policy: which service to open, how a job's stream is cut
 * into chunks, and what paces them. The virtual printer has no radio, and takes
 * only the chunk size, to pace its log the way a real link would.
 */
export interface Link {
  readonly gatt: GattLayout
  /** Chunk size when the printer's profile names none. */
  readonly chunkSize: number
  /**
   * The chunks that carry one job's stream, in order: what the BLE driver writes.
   *
   * Plain slices where the link adds nothing of its own; with a header, sequence
   * numbers or a trailer where the dialect frames its chunks (see GLOSSARY.md,
   * Chunk).
   */
  chunk(stream: Uint8Array, chunkSize: number): Uint8Array[]
  readonly pacing: Pacing
}

/** Where a dialect's printers talk: the GATT service and its characteristics. */
export interface GattLayout {
  service: string
  write: string
  /** Replies, query answers and end-of-job reports. */
  status: string
  /** Credit grants, for a link paced by credits. */
  credits?: string
  /**
   * `fastest-offered` writes without response when the characteristic allows it;
   * `with-response` always waits for the printer's acknowledgement of each write.
   */
  writeMode: 'fastest-offered' | 'with-response'
}

/** What decides when the next chunk may go. */
export type Pacing = CreditPacing | { kind: 'acknowledged' }

/**
 * Pacing by credits: the printer grants chunks on the credits channel, and the
 * driver sends none without one in hand (ADR 0002).
 */
export interface CreditPacing {
  kind: 'credits'
  /** What a credits-channel notification grants, or null for a frame that grants nothing. */
  readGrant(bytes: Uint8Array): { add: number } | { set: number } | null
  /** Pause after each chunk once the printer has granted credits. */
  delayWithCreditsMs: number
  /** Pause after each chunk while it has granted none, the only pacing then left. */
  delayWithoutCreditsMs: number
}

/**
 * Write a command and return the next status notification, or null if none
 * comes in time: how a conversation asks the printer anything.
 */
export type Ask = (command: Uint8Array) => Promise<Uint8Array | null>

/** What the printer says about itself; null for whatever it does not say. */
export interface Identity {
  model: string | null
  firmware: string | null
  serial: string | null
  mac: string | null
}

/** A status-channel notification, as it bears on a print in flight. */
export type Reply =
  /** The job is done; with a warning to pass on where the printer added one. */
  | { kind: 'done'; warning?: string }
  /** The printer gave up on the job, and says why. */
  | { kind: 'failed'; reason: string }
  /** Anything else: a query's answer, or a notification that means nothing to a print. */
  | { kind: 'other' }

export interface Conversation {
  /** Writes sent once after connecting, before anything is asked. */
  readonly handshake: readonly NamedCommand[]
  identify(ask: Ask, advertisedName: string | null): Promise<Identity>
  status(ask: Ask): Promise<Omit<PrinterStatus, 'online'>>
  readReply(bytes: Uint8Array): Reply
  /**
   * Have the printer find its label gap, then read back the label height. Absent
   * where the dialect has no gap sensor to drive.
   */
  calibrateLabelGap?(ask: Ask, options: GapCalibrationOptions): Promise<GapCalibration>
}

export interface GapCalibrationOptions {
  /** How many times to have the printer find the gap before reading the height. */
  passes?: number
  onPass?: (pass: number, reply: Uint8Array | null) => void
}

export interface GapCalibration {
  /** The label height the printer measured, or null if it did not say. */
  labelHeightDots: number | null
  /** The printer's reply to each pass, null where it stayed silent. */
  passes: Array<Uint8Array | null>
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
 * is the driver's business, not the plan's: the BLE driver joins the parts into
 * one stream and has the dialect's link chunk it, so every byte is paced (ADR
 * 0002), and the virtual driver logs each command on its own line.
 */
export interface PlannedJob {
  /**
   * May be empty, for a planned step that is no job at all but its epilogue alone:
   * a probe, such as the LetraTag's, sent on its own and answered by the printer.
   */
  parts: JobPart[]
  /** Sent after the job's stream has gone, each as a write of its own. */
  epilogue: NamedCommand[]
  /**
   * How long to wait for the printer to report this job done before sending the
   * next one, or null to go straight on.
   *
   * Silence stops the rest of the copy, unless `goOnIfSilent` says otherwise: the
   * next job would go to a printer still moving paper. A driver may wait longer
   * than this, never shorter; the BLE driver has a minimum of its own. A driver
   * with nothing to wait for, such as the virtual printer, ignores it.
   */
  waitMs: number | null
  /**
   * Go on to the next job when the wait ends in silence. For a step that moves no
   * paper, whose answer is worth waiting for but not worth giving up the label over.
   */
  goOnIfSilent?: boolean
}

/** Bytes of a job's stream, which is what a driver's progress counts. */
export function jobStreamBytes(job: PlannedJob): number {
  return job.parts.reduce((n, part) => n + part.bytes.length, 0)
}

/**
 * Bytes of every job's stream in the plan: the total the virtual printer's progress
 * runs to. The BLE driver counts its chunks instead, framing included.
 */
export function planStreamBytes(plan: PrintPlan): number {
  return plan.copies.reduce(
    (n, copy) => n + copy.jobs.reduce((m, job) => m + jobStreamBytes(job), 0),
    0,
  )
}
