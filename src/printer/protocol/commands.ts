/**
 * Command builders for the P50 family.
 *
 * Every byte sequence here is documented in docs/PROTOCOL.md. Two prefixes are in
 * play and they are *not* two protocol generations: `1F` covers print control and
 * configuration, `10 FF` covers device-information queries.
 */
import {
  MAX_DENSITY,
  MIN_DENSITY,
  type PaperTypeValue,
  type SpeedValue,
} from './constants'

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

export const locate = (mode: LocateModeValue) => cmd(0x1f, 0x12, mode, 0x00)
export const locateAuto = () => cmd(0x0c)

// --- configuration -------------------------------------------------------

export const setPaperType = (type: PaperTypeValue) => cmd(0x1f, 0x80, 0x01, type)
export const getPaperType = () => cmd(0x1f, 0x80, 0x00)

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
