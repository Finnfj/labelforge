import type { PrinterFault } from '../types'

/**
 * Interpretation of what the printer sends back.
 *
 * **These formats are inferred, not documented.** The command bytes came from
 * reading the vendor SDK, but that SDK only builds requests — it never parses
 * replies, so nothing here has been checked against real hardware.
 *
 * Everything is therefore written to degrade rather than fail: a reply that does
 * not match expectations yields `null` and the raw bytes are kept for the
 * diagnostics log. The diagnostics page is what will turn these guesses into
 * facts, and until it has run against a real P50 the values should be treated as
 * provisional.
 */

/** ASCII-ish text, ignoring framing and padding bytes. */
export function decodeText(bytes: Uint8Array): string | null {
  const printable: number[] = []
  for (const byte of bytes) {
    // Keep the printable ASCII range; skip framing, NULs and high bytes.
    if (byte >= 0x20 && byte <= 0x7e) printable.push(byte)
  }
  const text = String.fromCharCode(...printable).trim()
  return text.length > 0 ? text : null
}

/**
 * Battery level.
 *
 * Reported as a percentage in the vendor app's UI, but the command is named
 * `getPrinterBatteryVol`, so a millivolt reading is equally plausible. Values
 * over 100 are treated as millivolts and converted against a nominal
 * single-cell li-ion range; anything else is taken as a percentage.
 */
export function decodeBattery(bytes: Uint8Array): number | null {
  if (bytes.length === 0) return null
  const last = bytes[bytes.length - 1]
  if (last <= 100) return last

  const millivolts = bytes.length >= 2 ? (bytes[bytes.length - 2] << 8) | last : last * 16
  if (millivolts < 2500 || millivolts > 4500) return null
  const percent = ((millivolts - 3000) / (4200 - 3000)) * 100
  return Math.max(0, Math.min(100, Math.round(percent)))
}

export interface StatusFlags {
  printing: boolean
  coverOpen: boolean
  outOfPaper: boolean
  lowBattery: boolean
  overheated: boolean
  /** The raw byte, so an unrecognised bit is still visible in diagnostics. */
  raw: number
}

/**
 * Decode the status reply to `10 FF 40`.
 *
 * The archived original SDK documents this as a **bit field**, not an enum:
 * zero means healthy, and bits 0–4 are printing, cover open, out of paper, low
 * battery and head overheating respectively.
 *
 * An earlier version of this file guessed at `[0xFF, code]` from a third-party
 * decompile, and paired it with the tidied facade's `1F 20 00` — a command that
 * does not exist in the vendor SDK at all and is silent on real hardware. Both
 * were wrong.
 */
export function decodeStatusFlags(bytes: Uint8Array): StatusFlags | null {
  if (bytes.length === 0) return null
  // Replies observed so far put the payload last; take the final byte.
  const raw = bytes[bytes.length - 1]
  return {
    printing: (raw & 0b0000_0001) !== 0,
    coverOpen: (raw & 0b0000_0010) !== 0,
    outOfPaper: (raw & 0b0000_0100) !== 0,
    lowBattery: (raw & 0b0000_1000) !== 0,
    overheated: (raw & 0b0001_0000) !== 0,
    raw,
  }
}

/** The single most important fault, for a one-line summary. */
export function faultFromFlags(flags: StatusFlags | null): PrinterFault {
  if (!flags) return 'unknown'
  if (flags.outOfPaper) return 'no-paper'
  if (flags.coverOpen) return 'cover-open'
  if (flags.overheated) return 'overheat'
  if (flags.lowBattery) return 'low-battery'
  return 'none'
}

/** Label height in dots from a `10 FF 50 F2` reply, big-endian. */
export function decodeLabelHeight(bytes: Uint8Array): number | null {
  if (bytes.length < 2) return null
  const tail = bytes.subarray(bytes.length - 2)
  const height = (tail[0] << 8) | tail[1]
  // A plausible label is between 2 mm and 400 mm at 8 dots/mm.
  return height >= 16 && height <= 3200 ? height : null
}

/** Acknowledgement bytes the firmware is known to use for "command accepted". */
const ACK_BYTES = new Set([0xaa, 0x4f, 0x4b])

export function isAck(bytes: Uint8Array): boolean {
  return bytes.length > 0 && ACK_BYTES.has(bytes[0])
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ')
}
