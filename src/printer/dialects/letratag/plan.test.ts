import { describe, expect, it } from 'vitest'
import { createPackedBitmap } from '../../../model/bitmap'
import { DEFAULT_PRINT_SETTINGS } from '../../types'
import { letratag } from '.'
import { PROBE_WAIT_MS, RESULT_BASE_WAIT_MS } from './constants'

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ')

describe('LetraTag print plan', () => {
  const bitmap = createPackedBitmap(30, 80)

  it('probes before every copy, then sends the label as one job', () => {
    const plan = letratag.planPrint(bitmap, { ...DEFAULT_PRINT_SETTINGS, copies: 2 })
    expect(plan.copies).toHaveLength(2)
    for (const copy of plan.copies) {
      const [probe, label] = copy.jobs
      expect(copy.jobs).toHaveLength(2)
      expect(probe.parts).toEqual([])
      expect(probe.epilogue.map((c) => hex(c.bytes))).toEqual(['1b 41 00'])
      expect(probe.waitMs).toBe(PROBE_WAIT_MS)
      // The probe moves no paper: silence there does not cost the label.
      expect(probe.goOnIfSilent).toBe(true)
      expect(label.waitMs).toBeNull()
    }
  })

  it('writes the directive stream the vendor app sends', () => {
    const [, label] = letratag.planPrint(bitmap, DEFAULT_PRINT_SETTINGS).copies[0].jobs
    const commands = label.parts.flatMap((p) => (p.kind === 'command' ? [hex(p.bytes)] : []))
    // 80 rows, stretched to 160 columns: width a0 00 00 00, height 32.
    expect(commands).toEqual([
      '1b 73 9a 02 00 00',
      '1b 23 01',
      '1b 44 81 02 a0 00 00 00 20 00 00 00',
      '1b 45',
      '1b 41',
      '1b 51',
    ])
  })

  it('waits longer for a longer label to finish', () => {
    const short = letratag.planPrint(createPackedBitmap(30, 80), DEFAULT_PRINT_SETTINGS)
    const long = letratag.planPrint(createPackedBitmap(30, 800), DEFAULT_PRINT_SETTINGS)
    expect(short.copies[0].finishWaitMs).toBeGreaterThan(RESULT_BASE_WAIT_MS)
    expect(long.copies[0].finishWaitMs).toBeGreaterThan(short.copies[0].finishWaitMs!)
  })

  it('never splits a label, and says its size does not depend on the picture', () => {
    expect(letratag.assessJob(createPackedBitmap(30, 4000))).toMatchObject({
      fits: true,
      compressed: false,
    })
  })
})
