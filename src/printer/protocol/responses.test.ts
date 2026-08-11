import { describe, expect, it } from 'vitest'
import {
  decodeBattery,
  decodeLabelHeight,
  decodeStatusFlags,
  decodeText,
  faultFromFlags,
} from './responses'
import * as cmd from './commands'

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ')

describe('commands recovered from the archived original SDK', () => {
  it('matches the vendor original byte for byte', () => {
    // Transcribed from lib/archive/original_interface_chinese.js. Several differ
    // from the tidied-up facade, which is what made the earlier probes silent.
    expect(hex(cmd.locateLabel())).toBe('1d 0c')
    expect(hex(cmd.learnLabelGap())).toBe('10 ff 03')
    expect(hex(cmd.getLabelHeight())).toBe('10 ff 50 f2')
    expect(hex(cmd.getStatusFlags())).toBe('10 ff 40')
    expect(hex(cmd.getPrinterInfo())).toBe('10 ff 70')
    expect(hex(cmd.getBluetoothName())).toBe('10 ff 30 11')
    expect(hex(cmd.getBluetoothMac())).toBe('10 ff 30 12')
    expect(hex(cmd.getBluetoothVersion())).toBe('10 ff 30 10')
    expect(hex(cmd.feedDotLines(8))).toBe('1b 4a 08')
    expect(hex(cmd.setDensityLegacy(5))).toBe('10 ff 10 00 05')
  })

  it('feeds in whole dot lines and cannot overflow the byte', () => {
    expect(hex(cmd.feedDotLines(0))).toBe('1b 4a 00')
    expect(hex(cmd.feedDotLines(255))).toBe('1b 4a ff')
    expect(hex(cmd.feedDotLines(9999))).toBe('1b 4a ff')
    expect(hex(cmd.feedDotLines(-5))).toBe('1b 4a 00')
  })
})

describe('decodeStatusFlags', () => {
  it('reads zero as healthy', () => {
    const flags = decodeStatusFlags(Uint8Array.of(0x00))!
    expect(flags.outOfPaper).toBe(false)
    expect(flags.coverOpen).toBe(false)
    expect(faultFromFlags(flags)).toBe('none')
  })

  it('decodes the documented bit positions', () => {
    // bit0 printing, bit1 cover, bit2 paper, bit3 battery, bit4 heat
    expect(decodeStatusFlags(Uint8Array.of(0b0000_0001))!.printing).toBe(true)
    expect(decodeStatusFlags(Uint8Array.of(0b0000_0010))!.coverOpen).toBe(true)
    expect(decodeStatusFlags(Uint8Array.of(0b0000_0100))!.outOfPaper).toBe(true)
    expect(decodeStatusFlags(Uint8Array.of(0b0000_1000))!.lowBattery).toBe(true)
    expect(decodeStatusFlags(Uint8Array.of(0b0001_0000))!.overheated).toBe(true)
  })

  it('reports several faults at once, and prioritises paper', () => {
    const flags = decodeStatusFlags(Uint8Array.of(0b0000_1110))!
    expect(flags.coverOpen).toBe(true)
    expect(flags.outOfPaper).toBe(true)
    expect(flags.lowBattery).toBe(true)
    // Out of paper is the one that actually stops a print.
    expect(faultFromFlags(flags)).toBe('no-paper')
  })

  it('keeps the raw byte so an unknown bit is still visible', () => {
    expect(decodeStatusFlags(Uint8Array.of(0b1000_0000))!.raw).toBe(0x80)
  })

  it('is unknown when nothing came back', () => {
    expect(decodeStatusFlags(new Uint8Array())).toBeNull()
    expect(faultFromFlags(null)).toBe('unknown')
  })
})

describe('decodeLabelHeight', () => {
  it('reads a big-endian height from the tail of the reply', () => {
    // 240 dots = 30 mm.
    expect(decodeLabelHeight(Uint8Array.of(0x00, 0xf0))).toBe(240)
    expect(decodeLabelHeight(Uint8Array.of(0x10, 0xff, 0x00, 0xf0))).toBe(240)
  })

  it('rejects implausible values rather than reporting nonsense', () => {
    // A label is not 1 dot tall, nor 10 metres.
    expect(decodeLabelHeight(Uint8Array.of(0x00, 0x01))).toBeNull()
    expect(decodeLabelHeight(Uint8Array.of(0xff, 0xff))).toBeNull()
    expect(decodeLabelHeight(Uint8Array.of(0x05))).toBeNull()
  })
})

describe('confirmed reply formats', () => {
  it('decodes the firmware string a P50S actually returned', () => {
    const reply = Uint8Array.of(0x56, 0x32, 0x2e, 0x30, 0x2e, 0x30, 0x30)
    expect(decodeText(reply)).toBe('V2.0.00')
  })

  it('decodes a NUL-terminated serial', () => {
    const reply = Uint8Array.from([...'502550544127'].map((c) => c.charCodeAt(0)).concat(0x00))
    expect(decodeText(reply)).toBe('502550544127')
  })

  it('decodes the battery percentage a P50S actually returned', () => {
    expect(decodeBattery(Uint8Array.of(0x00, 0x64))).toBe(100)
  })
})
