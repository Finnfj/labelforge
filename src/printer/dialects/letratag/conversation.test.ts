import { describe, expect, it } from 'vitest'
import { letratag } from '.'

const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))

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
