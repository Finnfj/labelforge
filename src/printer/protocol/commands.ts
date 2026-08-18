/**
 * Command builders for the P50 family.
 *
 * Every byte sequence here is documented in docs/PROTOCOL.md. Two prefixes are in
 * play and they are *not* two protocol generations: `1F` covers print control and
 * configuration, `10 FF` covers device-information queries.
 */
import { MAX_DENSITY, MIN_DENSITY, type PaperTypeValue, type SpeedValue } from './constants'

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
 * `preamble` goes before the payload and `trailer` after it; the payload itself
 * is {@link encodeImage}'s output, chunked by whichever driver is sending it.
 *
 * Split this way because that is the one thing the two sides genuinely differ
 * on — the real driver has to interleave credit acquisition and progress with
 * the chunks, the virtual one paces them and records them. Everything either
 * side of the payload is identical, so it lives here.
 */
export interface PrintJobFraming {
  preamble: FramedCommand[]
  trailer: FramedCommand[]
}

/**
 * The vendor app's exact per-copy print sequence, from an HCI capture.
 *
 * This replaces what used to be a list of speculative candidates guessed at after
 * the SDK was exhausted. The capture answered the question the guesses existed to
 * answer: the gap seek is {@link locate} with {@link LocateMode.Gap}, issued
 * between the raster and {@link stopPrintJob}.
 *
 * **Executable, not descriptive.** This used to be an array of strings under a
 * comment claiming it kept the driver and the docs from drifting apart. It could
 * not — nothing imported it — and they drifted: the virtual printer was still
 * sending the superseded paper-type mode and the short density command, and was
 * missing the gap seek entirely, while advertising itself as byte-for-byte what
 * a real P50 would receive. Both drivers now build their job from this function,
 * so the claim is true by construction and a change lands in both at once.
 *
 * Configuration is re-sent per copy, inside the job, exactly as the capture
 * shows. One thing the vendor app notably never sends is any feed command at
 * all; {@link setSpeed} is discussed below.
 */
export function printJobFraming(settings: {
  paperType: PaperTypeValue
  density: number
  speed: SpeedValue
}): PrintJobFraming {
  return {
    preamble: [
      { bytes: setPaperTypeSilent(settings.paperType), note: 'setPaperTypeSilent' },
      { bytes: setPrintParams(settings.density), note: 'setPrintParams' },
      // The vendor app never sends this one. Kept because it is a user-facing
      // setting and has been harmless in practice, but if speed hides in one of
      // setPrintParams' six unidentified bytes, this is the thing to drop first.
      { bytes: setSpeed(settings.speed), note: 'setSpeed' },
      { bytes: startPrintJob(), note: 'startPrintJob' },
      { bytes: alignPaperStart(), note: 'alignPaperStart' },
    ],
    trailer: [
      // The alignment fix, and the reason labels no longer drift: seek the next
      // gap with the optical sensor once the raster is in. It must come after
      // the payload and before stopPrintJob — issued standalone it does
      // nothing, which is why it looked inert for so long.
      { bytes: locate(LocateMode.Gap), note: 'locate(Gap)' },
      { bytes: stopPrintJob(), note: 'stopPrintJob' },
      { bytes: alignPaperEnd(), note: 'alignPaperEnd' },
    ],
  }
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
