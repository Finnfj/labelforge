/**
 * Which printers this app recognises, which dialect each speaks, and what it can
 * do with each.
 *
 * The MarkLife family does not speak one protocol. There are at least two dialects:
 *
 * - **x2**, which is what this app implements — a zlib-compressed `1F 10` raster
 *   inside a `1F C0` job, confirmed on a P50S from an HCI capture of the vendor
 *   app. The M60 and X2 use it too.
 * - **L11**, used by the P15, P12 and P7 — an *uncompressed* `1D 76 30` raster
 *   with little-endian dimensions and a different command vocabulary. Nothing
 *   here can drive one.
 *
 * That second family is the reason this file exists. Our chooser filters already
 * included the catch-all prefixes `Marklife` and `Printer`, so an L11 printer
 * could be selected and then sent commands it has no way to parse — no error,
 * no output, no clue why. Recognising it by name and refusing with a reason is
 * strictly better than that, and it is the part of this file that is certainly
 * correct.
 *
 * See docs/PROTOCOL.md for the evidence behind each entry, and note that only
 * the P50 is confirmed on hardware.
 */
import { DEFAULT_HEAD_WIDTH_DOTS } from '../model/units'
import type { Dialect } from './dialect'
import { x2 } from './dialects/x2'
import { DEFAULT_CHUNK_SIZE } from './dialects/x2/constants'

export type ProfileSupport =
  /** Driven successfully against real hardware. */
  | 'confirmed'
  /** Believed to speak a dialect confirmed on another model, but never run against one. */
  | 'unverified'
  /**
   * Speaks a dialect not yet confirmed on our own hardware. Driven only when the
   * experimental opt-in under Diagnostics is on, and refused otherwise (ADR 0003).
   */
  | 'experimental'
  /** Known to speak a dialect this app does not implement. */
  | 'incompatible'

export interface PrinterProfile {
  id: string
  label: string
  /**
   * Advertised-name prefixes, matched case-insensitively.
   *
   * These come from reverse engineering, not from any specification, so they are
   * a good guess rather than a guarantee — which is why an unmatched name falls
   * back to the P50 profile rather than being refused.
   */
  namePrefixes: readonly string[]
  support: ProfileSupport
  /**
   * What the printer speaks, and so which service is opened once it is
   * recognised. Omitted only for an incompatible model, which is never driven.
   */
  dialect?: Dialect
  /** Omitted where it would be meaningless — an incompatible model is never driven. */
  chunkSize?: number
  headWidthDots?: number
  /** Shown in the UI when this profile is in play. */
  note?: string
}

export const PROFILES: readonly PrinterProfile[] = [
  {
    id: 'p50',
    label: 'MarkLife P50 / P50S',
    // The two catch-alls have always been here, and stay: the prefixes are
    // inferred, so an unexpected P50 variant is likelier than a foreign device.
    namePrefixes: ['P50', 'Marklife', 'Printer'],
    support: 'confirmed',
    dialect: x2,
    chunkSize: DEFAULT_CHUNK_SIZE,
    headWidthDots: DEFAULT_HEAD_WIDTH_DOTS,
  },
  {
    id: 'm60',
    label: 'MarkLife M60 / X2',
    namePrefixes: ['M60', 'X2'],
    support: 'unverified',
    dialect: x2,
    // Both numbers are the P50's, because nothing reports either and nobody has
    // measured an M60. The head width in particular is a guess: it is the one
    // thing the diagnostics ruler strip exists to settle, and it has not been.
    chunkSize: DEFAULT_CHUNK_SIZE,
    headWidthDots: DEFAULT_HEAD_WIDTH_DOTS,
    note:
      'Believed to use the same print protocol as the P50, but this has never been run ' +
      'against one. Head width and chunk size are the P50 numbers, not measured values.',
  },
  {
    id: 'l11',
    label: 'MarkLife P15 / P12 / P7',
    // Prefixes as published by tomLadder/thermoprint, which registers them
    // across its p15 and p12 profiles. Not verified here; the point of the list
    // is to recognise these printers well enough to decline them.
    namePrefixes: [
      'P15R',
      'P15S',
      'P15',
      'P12',
      'P11',
      'P7',
      'P1s',
      'LP90',
      'LP15',
      'LPC74',
      'S15',
      'S12',
      'iSPACE_LP15',
      'OUT_LPC',
      'M1',
    ],
    support: 'incompatible',
    note:
      'These use an uncompressed print protocol that LabelForge does not implement. ' +
      'Connecting would achieve nothing — every command would be ignored.',
  },
]

/** The profile assumed when a printer's advertised name matches nothing. */
export const DEFAULT_PROFILE: PrinterProfile = PROFILES[0]

/** Every prefix worth putting in the device chooser, including refusable ones. */
export const ALL_NAME_PREFIXES: readonly string[] = PROFILES.flatMap((p) => p.namePrefixes)

/**
 * Every service a recognised printer may be opened on.
 *
 * The browser grants access only to services named before its chooser opens, and
 * which one the printer speaks is known only once its advertised name is read, so
 * the chooser asks for all of them.
 */
export const ALL_SERVICES: readonly string[] = [
  ...new Set(PROFILES.flatMap((p) => (p.dialect ? [p.dialect.link.gatt.service] : []))),
]

/**
 * Identify a printer from its advertised name.
 *
 * Longest prefix wins, so `P15…` matches the L11 family rather than the P50's
 * catch-all `Printer`, and `M1…` does not swallow `M60…`. Returns null for a
 * name that matches nothing, which the caller treats as "assume a P50" rather
 * than as an error.
 */
export function matchProfile(advertisedName: string | null | undefined): PrinterProfile | null {
  if (!advertisedName) return null
  const name = advertisedName.toLowerCase()

  let best: PrinterProfile | null = null
  let bestLength = 0
  for (const profile of PROFILES) {
    for (const prefix of profile.namePrefixes) {
      if (prefix.length > bestLength && name.startsWith(prefix.toLowerCase())) {
        best = profile
        bestLength = prefix.length
      }
    }
  }
  return best
}

export function findProfile(id: string): PrinterProfile | undefined {
  return PROFILES.find((p) => p.id === id)
}
