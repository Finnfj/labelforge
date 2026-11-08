import { describe, expect, it } from 'vitest'
import { createPackedBitmap } from '../../../model/bitmap'
import { DEFAULT_PRINT_SETTINGS } from '../../types'
import { letratag } from '.'
import { PROBE_WAIT_MS, RESULT_BASE_WAIT_MS } from './constants'

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ')
const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))

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

describe('LetraTag conversation', () => {
  const result = (code: number) => Uint8Array.of(0x1b, 0x52, code)
  const read = letratag.conversation.readReply

  it('reads the result codes as docs/DYMO_PROTOCOL.md tabulates them', () => {
    expect(read(result(0))).toEqual({ kind: 'done' })
    expect(read(result(3))).toMatchObject({ kind: 'done', warning: expect.stringMatching(/low/) })
    for (const code of [2, 4, 5, 6, 7]) expect(read(result(code)).kind).toBe('failed')
    expect(read(result(6))).toMatchObject({ reason: expect.stringMatching(/battery/i) })
  })

  it('keeps waiting on status 1, which can come before the real result', () => {
    expect(read(result(1))).toEqual({ kind: 'other' })
  })

  it('ignores anything that is not an ESC R result', () => {
    expect(read(text('OK'))).toEqual({ kind: 'other' })
  })

  it('takes the model and MAC from the advertised name, and asks the printer nothing', async () => {
    const asked: Uint8Array[] = []
    const identity = await letratag.conversation.identify(async (c) => {
      asked.push(c)
      return null
    }, 'Letratag10b41d81fa5a')
    expect(identity).toEqual({
      model: 'DYMO LetraTag LT-200B',
      firmware: null,
      serial: null,
      mac: '10:B4:1D:81:FA:5A',
    })
    expect(asked).toEqual([])
    expect(letratag.conversation.handshake).toEqual([])
  })

  it('reports its status unknown rather than guessing', async () => {
    expect(await letratag.conversation.status(async () => null)).toEqual({
      batteryPercent: null,
      labelHeightDots: null,
      fault: 'unknown',
    })
  })
})
