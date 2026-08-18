import { describe, expect, it } from 'vitest'
import { ALL_NAME_PREFIXES, DEFAULT_PROFILE, PROFILES, findProfile, matchProfile } from './profiles'

describe('printer profiles', () => {
  it('defaults to the one model actually confirmed on hardware', () => {
    expect(DEFAULT_PROFILE.id).toBe('p50')
    expect(DEFAULT_PROFILE.support).toBe('confirmed')
  })

  it('is the only confirmed entry', () => {
    // If this ever fails, someone has claimed hardware confirmation. That is a
    // good thing to have to justify deliberately.
    const confirmed = PROFILES.filter((p) => p.support === 'confirmed').map((p) => p.id)
    expect(confirmed).toEqual(['p50'])
  })

  it('gives every driveable profile the numbers a driver needs', () => {
    for (const profile of PROFILES) {
      if (profile.support === 'incompatible') continue
      expect(profile.chunkSize, profile.id).toBeGreaterThan(0)
      expect(profile.headWidthDots, profile.id).toBeGreaterThan(0)
    }
  })

  it('says why an incompatible model is refused', () => {
    // The note becomes the user-facing reason, so an empty one would produce a
    // refusal that explains nothing.
    for (const profile of PROFILES.filter((p) => p.support === 'incompatible')) {
      expect(profile.note?.length, profile.id).toBeGreaterThan(20)
    }
  })

  it('has no prefix claimed by two profiles', () => {
    expect(new Set(ALL_NAME_PREFIXES).size).toBe(ALL_NAME_PREFIXES.length)
  })

  it('matches the observed advertised-name forms', () => {
    expect(matchProfile('P50S-F871-BLE')?.id).toBe('p50')
    expect(matchProfile('P50_2950_BLE')?.id).toBe('p50')
    expect(matchProfile('M60_1234_BLE')?.id).toBe('m60')
    expect(matchProfile('P15R_0001')?.id).toBe('l11')
  })

  it('lets the longest prefix win', () => {
    // `P15…` must not be caught by the P50 profile's catch-all `Printer`, and
    // `M1` must not swallow `M60`. Without longest-wins, registration order
    // silently decides which printer we think we are holding.
    expect(matchProfile('Printer-Something')?.id).toBe('p50')
    expect(matchProfile('P15S-ABCD')?.id).toBe('l11')
    expect(matchProfile('M60-ABCD')?.id).toBe('m60')
    expect(matchProfile('M1-ABCD')?.id).toBe('l11')
  })

  it('ignores case, because an advertised name is not a specification', () => {
    expect(matchProfile('p50s-f871-ble')?.id).toBe('p50')
    expect(matchProfile('m60_x')?.id).toBe('m60')
  })

  it('returns null rather than guessing when nothing matches', () => {
    expect(matchProfile('Some Other Device')).toBeNull()
    expect(matchProfile('')).toBeNull()
    expect(matchProfile(null)).toBeNull()
    expect(matchProfile(undefined)).toBeNull()
  })

  it('finds a profile by id', () => {
    expect(findProfile('m60')?.label).toContain('M60')
    expect(findProfile('nope')).toBeUndefined()
  })
})
