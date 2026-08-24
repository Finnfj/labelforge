/**
 * Command builders for the P50 family.
 *
 * Every byte sequence here is documented in docs/PROTOCOL.md. Two prefixes are in
 * play and they are *not* two protocol generations: `1F` covers print control and
 * configuration, `10 FF` covers device-information queries.
 */
import { createPackedBitmap } from '../../model/bitmap'
import {
  MAX_DENSITY,
  MIN_DENSITY,
  SEEK_SAFE_JOB_BYTES,
  type PaperTypeValue,
  type SpeedValue,
} from './constants'
import { encodeImage } from './encodeImage'

const cmd = (...bytes: number[]) => Uint8Array.from(bytes)

// --- print control -------------------------------------------------------

export const startPrintJob = () => cmd(0x1f, 0xc0, 0x01, 0x00)
export const stopPrintJob = () => cmd(0x1f, 0xc0, 0x01, 0x01)

/** Send after connecting. */
export const setBluetoothType = () => cmd(0x1f, 0xb2, 0x00)

export const alignPaperStart = () => cmd(0x1f, 0x11, 0x51)
export const alignPaperEnd = () => cmd(0x1f, 0x11, 0x50)

export const AdjustMode = {
  ForwardDots: 0x00,
  ForwardMm: 0x01,
  BackwardDots: 0x10,
  BackwardMm: 0x11,
} as const
export type AdjustModeValue = (typeof AdjustMode)[keyof typeof AdjustMode]

export function adjustPosition(mode: AdjustModeValue, distance: number): Uint8Array {
  const d = Math.max(0, Math.min(0xffff, Math.round(distance)))
  return cmd(0x1f, 0x11, mode, (d >> 8) & 0xff, d & 0xff)
}

export const LocateMode = { None: 0x10, Gap: 0x20, BlackMark: 0x30 } as const
export type LocateModeValue = (typeof LocateMode)[keyof typeof LocateMode]

/**
 * Seek the next label boundary with the optical sensor.
 *
 * **This is the gap-alignment command, and where it sits in the stream is the
 * whole trick.** An HCI capture of the vendor app shows it issued *after* the
 * raster payload and *before* `stopPrintJob` — not standalone, which is how it
 * was tested unsuccessfully for a long time. See docs/PROTOCOL.md.
 */
export const locate = (mode: LocateModeValue) => cmd(0x1f, 0x12, mode, 0x00)
export const locateAuto = () => cmd(0x0c)

// --- configuration -------------------------------------------------------

/** Paper type, mode 1. The SDK's form; the vendor app sends {@link setPaperTypeSilent}. */
export const setPaperType = (type: PaperTypeValue) => cmd(0x1f, 0x80, 0x01, type)
export const getPaperType = () => cmd(0x1f, 0x80, 0x00)

/**
 * Paper type, mode 2 — what the vendor app actually sends, once per copy.
 *
 * The archived SDK documents mode `0x02` as "set paper type, no reply", and the
 * capture confirms the app uses this form and never mode `0x01`.
 */
export const setPaperTypeSilent = (type: PaperTypeValue) => cmd(0x1f, 0x80, 0x02, type)

/**
 * Print parameters, mode 2 — the vendor app's only density-ish write.
 *
 * Observed verbatim as `1F 70 02 0A 00 00 00 00 00 00`. `1F 70` is the density
 * family in both SDK dialects, so the first parameter is taken to be density
 * (`0x0A` = 10 of 15). **The six trailing bytes are unidentified** and are sent as
 * the observed zeros; speed may well live in one of them, since the app never
 * sends `1F 60` at all.
 */
export function setPrintParams(density: number): Uint8Array {
  const safe = Math.max(MIN_DENSITY, Math.min(MAX_DENSITY, Math.round(density)))
  return cmd(0x1f, 0x70, 0x02, safe, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00)
}

/** Darkness, 1–15. Values outside the range are clamped rather than rejected. */
export function setDensity(level: number): Uint8Array {
  const safe = Math.max(MIN_DENSITY, Math.min(MAX_DENSITY, Math.round(level)))
  return cmd(0x1f, 0x70, 0x01, safe)
}
export const getDensity = () => cmd(0x1f, 0x70, 0x00)

export const setSpeed = (level: SpeedValue) => cmd(0x1f, 0x60, 0x01, level)
export const getSpeed = () => cmd(0x1f, 0x60, 0x00)

// --- maintenance and status ---------------------------------------------

export const selfCheck = () => cmd(0x1f, 0x40)
export const learnPaper = () => cmd(0x1f, 0x30, 0x60)

export const Sensor = { Temperature: 0x00, Voltage: 0x01, Opto: 0x02 } as const
export type SensorValue = (typeof Sensor)[keyof typeof Sensor]
export const getSensor = (sensor: SensorValue) => cmd(0x1f, 0x30, sensor)

export const printerStatus = () => cmd(0x1f, 0x20, 0x00)
export const getPrinterModel = () => cmd(0x10, 0xff, 0x20, 0xf0)
export const getPrinterVersion = () => cmd(0x10, 0xff, 0x20, 0xf1)
export const getPrinterSerial = () => cmd(0x10, 0xff, 0x20, 0xf2)
export const getPrinterBattery = () => cmd(0x10, 0xff, 0x50, 0xf1)
export const getPrinterMac = () => cmd(0x10, 0xff, 0x30, 0x11)

export function setShutdownMinutes(minutes: number): Uint8Array {
  const m = Math.max(0, Math.min(0xffff, Math.round(minutes)))
  return cmd(0x10, 0xff, 0x12, (m >> 8) & 0xff, m & 0xff)
}
export const getShutdownMinutes = () => cmd(0x10, 0xff, 0x13)

// ==========================================================================
// Commands recovered from the vendor SDK's *archived original*
// (lib/archive/original_interface_chinese.js), which the published, tidied-up
// facade either omits or contradicts.
//
// This matters because the tidied version turned out to be unreliable. Its
// `1F`-prefixed getters — `1F 80 00`, `1F 70 00`, `1F 60 00`, `1F 20 00`,
// `1F 30 xx` — do not exist anywhere in the original, and every one of them is
// silent on a real P50S. The `10 FF` family below is the one the vendor actually
// uses, and the members of it we have tried do answer.
//
// Byte sequences here are transcribed from the original's DataView writes.
// ==========================================================================

/**
 * Locate the next label (ESC/POS `GS FF`, a form feed).
 *
 * This is the gap-alignment primitive. The original SDK's own guidance is to
 * issue it about three times, waiting for an `OK` after each, before trusting
 * {@link getLabelHeight} — otherwise the height comes back inaccurate.
 *
 * Not to be confused with the tidied facade's `printerLocationAuto`, which
 * claims a bare `0C`; the original sends `1D 0C`.
 */
export const locateLabel = () => cmd(0x1d, 0x0c)

/** Feed n dot lines (ESC/POS `ESC J`). 8 lines is 1 mm at 203 dpi. */
export function feedDotLines(lines: number): Uint8Array {
  return cmd(0x1b, 0x4a, Math.max(0, Math.min(255, Math.round(lines))))
}

/** Ask the printer to learn the label gap. */
export const learnLabelGap = () => cmd(0x10, 0xff, 0x03)

/**
 * Measured label height. Only meaningful after locating a few labels first.
 *
 * Same `10 FF 50` family as the battery query, which does answer on a P50S.
 */
export const getLabelHeight = () => cmd(0x10, 0xff, 0x50, 0xf2)

/** Printer status as a bit field. See {@link decodeStatusFlags}. */
export const getStatusFlags = () => cmd(0x10, 0xff, 0x40)

/** Undocumented aggregate information query. */
export const getPrinterInfo = () => cmd(0x10, 0xff, 0x70)

/** Bluetooth advertised name. The tidied facade uses this for the MAC by mistake. */
export const getBluetoothName = () => cmd(0x10, 0xff, 0x30, 0x11)

/** Bluetooth MAC — `30 12`, not the `30 11` the tidied facade sends. */
export const getBluetoothMac = () => cmd(0x10, 0xff, 0x30, 0x12)

/** Bluetooth module firmware version. */
export const getBluetoothVersion = () => cmd(0x10, 0xff, 0x30, 0x10)

/**
 * Density in the legacy dialect.
 *
 * The original writes `10 FF 10 00 <level>`; the tidied facade sends
 * `1F 70 01 <level>` instead. Which the P50S honours is unknown — nothing reads
 * density back — so both are offered in diagnostics rather than guessed at.
 */
export function setDensityLegacy(level: number): Uint8Array {
  const safe = Math.max(MIN_DENSITY, Math.min(MAX_DENSITY, Math.round(level)))
  return cmd(0x10, 0xff, 0x10, 0x00, safe)
}

/** A command paired with the name the byte log should show for it. */
export interface FramedCommand {
  bytes: Uint8Array
  note: string
}

/**
 * Everything that wraps the raster payload, once per copy.
 *
 * The capture is emphatic about the shape of this, and the shape turned out to
 * matter. `preamble`, the raster and `trailer` are **one contiguous byte
 * stream** — the vendor app chunks it at the MTU without regard for where a
 * command begins or ends, so `1F 12 20 00` and `1F C0 01 01` arrive glued to the
 * tail of the last raster chunk. Only `epilogue` is a transfer of its own.
 *
 * Split three ways rather than two because that distinction is now load-bearing
 * rather than cosmetic; see {@link printJobStream}.
 */
export interface PrintJobFraming {
  /** Before the raster, in the same stream. */
  preamble: FramedCommand[]
  /** After the raster, in the same stream. */
  trailer: FramedCommand[]
  /** Its own transfer, after the job stream has gone. */
  epilogue: FramedCommand[]
}

/**
 * The vendor app's exact per-copy print sequence, from an HCI capture.
 *
 * This replaces what used to be a list of speculative candidates guessed at after
 * the SDK was exhausted. The capture answered the question the guesses existed to
 * answer: the gap seek is {@link locate}, issued between the raster and
 * {@link stopPrintJob}.
 *
 * **Executable, not descriptive.** This used to be an array of strings under a
 * comment claiming it kept the driver and the docs from drifting apart. It could
 * not — nothing imported it — and they drifted. Both drivers now build their job
 * from this function, so the claim is true by construction and a change lands in
 * both at once.
 *
 * Configuration is re-sent per copy, inside the job, exactly as the capture
 * shows. One thing the vendor app notably never sends is any feed command at
 * all; {@link setSpeed} is discussed below.
 */
export function printJobFraming(settings: {
  paperType: PaperTypeValue
  density: number
  speed?: SpeedValue
  seekGap?: boolean
  /**
   * Retract from the tear-off position before printing.
   *
   * On for a label, which is what the capture shows and what undoes the advance
   * the job before it made. Off for a continuation: when one label is split
   * across several jobs, only the first has a tear-off advance behind it to
   * undo, and retracting again mid-label would tear the image.
   */
  alignStart?: boolean
}): PrintJobFraming {
  return {
    preamble: [
      { bytes: setPaperTypeSilent(settings.paperType), note: 'setPaperTypeSilent' },
      { bytes: setPrintParams(settings.density), note: 'setPrintParams' },
      // Only when explicitly asked for. The vendor app sends no speed command at
      // all, and this one comes from the tidied SDK facade — the same source as a
      // family of getters that turned out not to exist. Omitted, the preamble is
      // the captured one exactly; speed most likely hides in one of
      // setPrintParams' six unidentified bytes anyway.
      ...(settings.speed === undefined
        ? []
        : [{ bytes: setSpeed(settings.speed), note: 'setSpeed' }]),
      { bytes: startPrintJob(), note: 'startPrintJob' },
      ...(settings.alignStart === false
        ? []
        : [{ bytes: alignPaperStart(), note: 'alignPaperStart' }]),
    ],
    trailer: [
      // The alignment fix, and the reason labels register at all: seek the next
      // label boundary with the optical sensor once the raster is in. It must
      // come after the payload and before stopPrintJob — issued standalone it
      // does nothing, which is why it looked inert for so long.
      ...(settings.seekGap === false
        ? []
        : [{ bytes: locate(locateModeFor(settings.paperType)), note: 'locate' }]),
      { bytes: stopPrintJob(), note: 'stopPrintJob' },
    ],
    epilogue: [{ bytes: alignPaperEnd(), note: 'alignPaperEnd' }],
  }
}

/**
 * How to seek a label boundary on a given stock.
 *
 * The two enumerations agree value for value — `0x10`/`0x20`/`0x30` mean
 * continuous, gap and black mark in both — which is plainly deliberate, so this
 * is a rename rather than a lookup. It exists because the trailer used to hard-code
 * gap mode: on continuous stock the job said "continuous" in the preamble and then
 * asked for a gap seek anyway, and there is no gap on continuous stock to find.
 */
export function locateModeFor(paperType: PaperTypeValue): LocateModeValue {
  return paperType as unknown as LocateModeValue
}

/**
 * Flatten a job into the single byte stream the printer actually parses.
 *
 * The printer reads a byte stream off a UART; transfer boundaries mean nothing to
 * it, and are not free either. Everything written outside the credited chunk loop
 * is written blind — `writeValueWithoutResponse` has no delivery guarantee, and
 * the credit window exists precisely because this firmware drops what it has no
 * room for. Sending the trailer as its own transfers put the gap seek, the one
 * command whose whole job is to happen last, at the exact moment the printer's
 * buffer was fullest.
 *
 * So the driver chunks *this* rather than just the raster, and every byte of a
 * job goes out under flow control. It is also what the capture shows the vendor
 * app doing, which is the better reason.
 */
export function printJobStream(framing: PrintJobFraming, image: Uint8Array): Uint8Array {
  const parts = [
    ...framing.preamble.map((c) => c.bytes),
    image,
    ...framing.trailer.map((c) => c.bytes),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/**
 * Rows of blank raster in the follow-up seek job.
 *
 * Enough to be a raster and little enough not to matter. 8 dots is 1 mm, and if
 * the seek fires that millimetre is absorbed into the travel to the gap; if it
 * does not, 1 mm is a smaller error than the whole gap the label is already
 * missing. One row would be less still, but nothing says a one-row raster is
 * valid and there is no way to ask.
 */
export const SEEK_JOB_ROWS = 8

/*
 * A rewind used to sit here, and it is worth saying why it does not.
 *
 * The reasoning was that `1F 11 51` undoes the tear-off advance exactly, landing a
 * registered roll on the gap, so winding back 5 mm before the seek would put the
 * paper on the label side of the boundary. It was sent as `1F 11 10 00 28`, the
 * printer honoured it — the paper visibly pulled back — and a whole blank label
 * came out anyway.
 *
 * Five millimetres was the wrong size of correction: the excursion it was trying to
 * undo is the tear-off round trip, which is about twenty. The follow-up now avoids
 * making that excursion at all rather than trying to walk it back — see
 * {@link followUpSeekJob}.
 *
 * It also established something that turned out to be wrong, and the error is
 * worth leaving written down because two later attempts were built on it: the paper
 * did pull back, and that was read as `adjustPosition` working. It was not. That
 * job also carried `alignPaperStart`, which retracts about twenty millimetres and
 * is a known paper-mover. `1F 11 10` has since been sent at forty dots in a band
 * with nothing else that moves paper, was acknowledged, and did nothing.
 *
 * So `adjustPosition` is inert like every other dedicated motion command on this
 * firmware, and the note above that claimed otherwise is retracted. Printing rows
 * and the gap seek remain the only two things that move paper.
 */

/**
 * Whether a raster this big will have its own gap seek read in time.
 *
 * Takes the encoded `1F 10` command's length rather than the whole job's, because
 * that is what a caller has before it has built any framing — the print panel
 * warns from the same number the drivers decide on, and 29 bytes of framing is
 * nothing against a 16 KB threshold. One basis everywhere beats a more precise
 * one that two callers compute differently.
 */
export function needsFollowUpSeek(encodedImageBytes: number): boolean {
  return encodedImageBytes > SEEK_SAFE_JOB_BYTES
}

/**
 * A complete job whose only purpose is to carry a gap seek that gets read.
 *
 * Ordinary in every respect — same framing, same order, same everything — except
 * that the raster is a millimetre of blank instead of a label. Being ordinary is
 * the point: the shape below `SEEK_SAFE_JOB_BYTES` is the shape that is confirmed
 * to register a label, so the fix is to send one of those rather than to invent
 * something.
 *
 * Blank rows compress to nothing, so this is a couple of dozen bytes on the wire
 * however wide the stock is.
 *
 * **`alignPaperStart` is left out, and the label job's `alignPaperEnd` with it.**
 * Those two are the tear-off round trip — forward about twenty millimetres at the
 * end of a job, back again at the start of the next — and having them between the
 * label and its seek walks the paper out past the boundary and back before the seek
 * runs. A small label's in-job seek registers correctly precisely because nothing
 * moves the paper between the raster and the seek; this makes the follow-up the
 * same shape. One label is one print, so the tear advance happens once, at the end
 * of the whole thing, which the driver arranges by handing the label job an empty
 * epilogue.
 */
export function followUpSeekJob(framing: PrintJobFraming, widthDots: number): Uint8Array {
  return printJobStream(
    { ...framing, preamble: framing.preamble.filter((c) => c.note !== 'alignPaperStart') },
    encodeImage(createPackedBitmap(widthDots, SEEK_JOB_ROWS)),
  )
}

/**
 * Destructive commands. Deliberately grouped and named so they cannot be reached
 * by accident — these must never be wired to ordinary UI, only to the diagnostics
 * raw-hex box where the user types the bytes themselves.
 */
export const DANGEROUS = {
  /** Wipes the printer's stored settings. */
  resetFactoryData: () => cmd(0x1f, 0x50, 0xbe),
  /** Drops the printer into its bootloader. Recovery may require vendor tooling. */
  enterBootloader: () => cmd(0x1f, 0xa0, 0xbe, 0x66, 0x88),
} as const
