import { describe, expect, it } from 'vitest'
import { BUNDLED_FONTS, SYSTEM_FONTS, isGenericFamily } from './fonts'

describe('font catalogue', () => {
  it('has no duplicate families across the groups', () => {
    const families = [...BUNDLED_FONTS, ...SYSTEM_FONTS].map((f) => f.family)
    expect(new Set(families).size).toBe(families.length)
  })

  it('labels every entry', () => {
    for (const font of [...BUNDLED_FONTS, ...SYSTEM_FONTS]) {
      expect(font.label.length).toBeGreaterThan(0)
      expect(font.family.length).toBeGreaterThan(0)
    }
  })

  it('keeps the two groups on the right side of the generic/real divide', () => {
    // The divide is load-bearing: `ensureDocumentFonts` skips generic families
    // because asking whether a CSS keyword is "loaded" is meaningless, and a
    // bundled font landing on the wrong side would never be checked at all.
    for (const font of BUNDLED_FONTS) expect(isGenericFamily(font.family)).toBe(false)
    for (const font of SYSTEM_FONTS) expect(isGenericFamily(font.family)).toBe(true)
  })

  it('recognises generic families whatever the casing or padding', () => {
    expect(isGenericFamily('sans-serif')).toBe(true)
    expect(isGenericFamily('  Serif ')).toBe(true)
    expect(isGenericFamily('MONOSPACE')).toBe(true)
    expect(isGenericFamily('system-ui')).toBe(true)
  })

  it('does not mistake a real family for a generic one', () => {
    expect(isGenericFamily('Fira Sans')).toBe(false)
    expect(isGenericFamily('lf-a1b2c3d4e5f6')).toBe(false)
    // A font actually called "Serif Display" is not the `serif` keyword.
    expect(isGenericFamily('Serif Display')).toBe(false)
  })
})
