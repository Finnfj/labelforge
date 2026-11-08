import { describe, expect, it } from 'vitest'
import { x2Conversation } from './conversation'
import { x2Link } from './link'

const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))

describe('x2 conversation', () => {
  it('reads "OK" on the status channel as the job done, and anything else as no news', () => {
    expect(x2Conversation.readReply(text('OK'))).toEqual({ kind: 'done' })
    expect(x2Conversation.readReply(text('V2.10'))).toEqual({ kind: 'other' })
  })

  it('takes the model from the advertised name when the printer will not say it', async () => {
    // A real P50S answers firmware and serial but stays silent on model.
    const identity = await x2Conversation.identify(async () => null, 'P50S-F871-BLE')
    expect(identity).toEqual({ model: 'P50S', firmware: null, serial: null, mac: null })
  })
})

describe('x2 link', () => {
  it('cuts a job stream into plain slices of the chunk size, adding nothing', () => {
    const stream = Uint8Array.from({ length: 200 }, (_, i) => i)
    const chunks = x2Link.chunk(stream, 90)
    expect(chunks.map((c) => c.length)).toEqual([90, 90, 20])
    expect(chunks.flatMap((c) => [...c])).toEqual([...stream])
  })

  it('reads only `01` frames on the credits channel as grants, and `01 04` as the window', () => {
    // A real P50S sends `02 dc 00` here alongside its grants.
    const { pacing } = x2Link
    if (pacing.kind !== 'credits') throw new Error('x2 is paced by credits')
    expect(pacing.readGrant(Uint8Array.of(0x02, 0xdc, 0x00))).toBeNull()
    expect(pacing.readGrant(Uint8Array.of(0x01, 0x04))).toEqual({ set: 4 })
    expect(pacing.readGrant(Uint8Array.of(0x01, 0x02))).toEqual({ add: 2 })
  })
})
