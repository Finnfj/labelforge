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

/**
 * Fault flags from a status reply.
 *
 * A decompile of the vendor Android app documents status notifications as
 * `[0xFF, code]`, which is the mapping used here.
 */
export function decodeFault(bytes: Uint8Array): PrinterFault {
  if (bytes.length < 2) return 'unknown'
  if (bytes[0] !== 0xff) return 'unknown'
  switch (bytes[1]) {
    case 0x00:
      return 'none'
    case 0x01:
      return 'no-paper'
    case 0x02:
      return 'cover-open'
    case 0x03:
      return 'overheat'
    case 0x04:
      return 'low-battery'
    default:
      return 'unknown'
  }
}

/** Acknowledgement bytes the firmware is known to use for "command accepted". */
const ACK_BYTES = new Set([0xaa, 0x4f, 0x4b])

export function isAck(bytes: Uint8Array): boolean {
  return bytes.length > 0 && ACK_BYTES.has(bytes[0])
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ')
}
