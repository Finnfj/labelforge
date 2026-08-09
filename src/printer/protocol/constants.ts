/** BLE GATT profile of the P50 family. See docs/PROTOCOL.md. */
export const SERVICE_UUID = '0000ff00-0000-1000-8000-00805f9b34fb'
export const CHAR_NOTIFY_STATUS = '0000ff01-0000-1000-8000-00805f9b34fb'
export const CHAR_WRITE = '0000ff02-0000-1000-8000-00805f9b34fb'
export const CHAR_NOTIFY_CREDITS = '0000ff03-0000-1000-8000-00805f9b34fb'

/**
 * Advertised name prefixes to offer in the device chooser.
 *
 * Filtering must be by name, not by service UUID: these printers do not put the
 * 128-bit service UUID in their advertisement, so a service filter yields an
 * empty chooser and looks like the printer is missing.
 */
export const NAME_PREFIXES = ['P50', 'Marklife', 'Printer'] as const

/** Bytes per BLE write. The vendor SDK uses 90; a decompile of the Android app suggests 95. */
export const DEFAULT_CHUNK_SIZE = 90

/** Inter-chunk delay when credit notifications are arriving, and when they are not. */
export const DELAY_WITH_CREDITS_MS = 5
export const DELAY_WITHOUT_CREDITS_MS = 30

export const PaperType = {
  Continuous: 0x10,
  Gap: 0x20,
  BlackMark: 0x30,
} as const
export type PaperTypeValue = (typeof PaperType)[keyof typeof PaperType]

export const Speed = { Low: 0, Medium: 1, High: 2 } as const
export type SpeedValue = (typeof Speed)[keyof typeof Speed]

export const MIN_DENSITY = 1
export const MAX_DENSITY = 15
