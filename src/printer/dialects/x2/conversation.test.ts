import { describe, expect, it } from 'vitest'
import { x2Conversation } from './conversation'
import { x2Link } from './link'

const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ')

describe('x2 conversation', () => {
  it('opens with setBluetoothType, as the vendor app does straight after connecting', () => {
    expect(x2Conversation.handshake.map((c) => hex(c.bytes))).toEqual(['1f b2 00'])
  })

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

describe('x2 gap calibration', () => {
  /** Records what was asked, and answers like a P50S: OK to a locate, 240 dots to the height. */
  function printer(options: { silent?: boolean } = {}) {
    const asked: string[] = []
    const ask = async (command: Uint8Array) => {
      const key = hex(command)
      asked.push(key)
      if (options.silent) return null
      if (key === '1d 0c') return text('OK')
      if (key === '10 ff 50 f2') return Uint8Array.of(0x00, 0xf0)
      return null
    }
    return { asked, ask }
  }

  it('locates three times before asking for the height, as the vendor SDK requires', async () => {
    // The vendor's own comment: ask for the height before locating a few labels
    // and the value comes back inaccurate.
    const { asked, ask } = printer()
    const passes: number[] = []
    const result = await x2Conversation.calibrateLabelGap!(ask, {
      onPass: (pass) => passes.push(pass),
    })
    expect(asked).toEqual(['1d 0c', '1d 0c', '1d 0c', '10 ff 50 f2'])
    expect(passes).toEqual([1, 2, 3])
    expect(result.labelHeightDots).toBe(240)
  })

  it('reports no height rather than a wrong one when the printer stays silent', async () => {
    const result = await x2Conversation.calibrateLabelGap!(printer({ silent: true }).ask, {
      passes: 2,
    })
    expect(result).toEqual({ labelHeightDots: null, passes: [null, null] })
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
