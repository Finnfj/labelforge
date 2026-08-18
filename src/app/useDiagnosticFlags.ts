import { useCallback, useState } from 'react'

/**
 * Controls that are revealed only after you ask for them in Diagnostics.
 *
 * These are not preferences, they are admissions that a control exists for
 * diagnosing the app rather than for printing a label. Both used to sit in the
 * normal flow, where they read as everyday settings: the virtual printer looked
 * like a printer you might want, and the speed selector looked like it did
 * something (a capture of the vendor app shows it sends no speed command at all).
 */
export interface DiagnosticFlags {
  /** Offer the virtual printer in the Output dropdown. */
  virtualPrinter: boolean
  /** Show the speed and test-pattern block in the Print panel. */
  advancedPrint: boolean
}

const STORAGE_KEY = 'labelforge.diagnostics.v1'

const DEFAULTS: DiagnosticFlags = {
  virtualPrinter: false,
  advancedPrint: false,
}

function load(): DiagnosticFlags {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<DiagnosticFlags>
    return {
      virtualPrinter: parsed.virtualPrinter === true,
      advancedPrint: parsed.advancedPrint === true,
    }
  } catch {
    return DEFAULTS
  }
}

export interface DiagnosticFlagsHandle {
  flags: DiagnosticFlags
  setFlag(key: keyof DiagnosticFlags, value: boolean): void
}

export function useDiagnosticFlags(): DiagnosticFlagsHandle {
  const [flags, setFlags] = useState<DiagnosticFlags>(load)

  const setFlag = useCallback((key: keyof DiagnosticFlags, value: boolean) => {
    setFlags((current) => {
      const next = { ...current, [key]: value }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Private-mode storage refusal must not break the page; the flag simply
        // reverts to its default on the next load.
      }
      return next
    })
  }, [])

  return { flags, setFlag }
}
