import type { PrintSettings, PrintSpeed, Stock } from '../../types'
import type { X2FramingSettings } from './commands'
import {
  MAX_DENSITY,
  MIN_DENSITY,
  PaperType,
  Speed,
  type PaperTypeValue,
  type SpeedValue,
} from './constants'

/**
 * The density levels `setPrintParams` takes, and the vendor app's default.
 *
 * 8 is what the captured vendor sequence sends, and what every print sent before
 * density became the dialect's to default.
 */
export const X2_DENSITY = { min: MIN_DENSITY, max: MAX_DENSITY, default: 8 } as const

const PAPER_TYPE: Record<Stock, PaperTypeValue> = {
  gap: PaperType.Gap,
  continuous: PaperType.Continuous,
  'black-mark': PaperType.BlackMark,
}

const SPEED: Record<PrintSpeed, SpeedValue> = {
  low: Speed.Low,
  medium: Speed.Medium,
  high: Speed.High,
}

/** The print settings as the bytes x2's job framing takes. */
export function x2FramingSettings(settings: PrintSettings): X2FramingSettings {
  return {
    paperType: PAPER_TYPE[settings.stock],
    density: settings.density ?? X2_DENSITY.default,
    speed: settings.speed === undefined ? undefined : SPEED[settings.speed],
  }
}
