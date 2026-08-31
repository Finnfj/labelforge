import { describe, expect, it } from 'vitest'
import { PaperType, Speed } from './constants'
import { printJobFraming, printJobStream } from './commands'

const hex = (b: Uint8Array) => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join(' ')

/** A stand-in raster payload, recognisable in a hex dump. */
const A = Uint8Array.of(0xaa, 0xbb)

const framingHex = (settings: Parameters<typeof printJobFraming>[0]) => {
  const f = printJobFraming(settings)
  return {
    stream: hex(printJobStream(f, Uint8Array.of(0xaa, 0xbb))),
    epilogue: f.epilogue.map((c) => hex(c.bytes)),
  }
}

/**
 * The captured vendor job, transcribed from `captures/btsnoop_hci.log`.
 *
 * Its six 217-byte writes concatenate to exactly these bytes around a 1273-byte
 * raster command, and all three captured copies are identical. Nothing about the
 * bytes below is inferred, which is what makes them worth pinning: everything
 * this app knows about registering a label rests on reproducing them.
 *
 * Density there was 10. It is the only value in the preamble that varies with a
 * user setting, so the test asks for 10 and the rest must match verbatim.
 */
const CAPTURED_PREAMBLE = '1f 80 02 20 1f 70 02 0a 00 00 00 00 00 00 1f c0 01 00 1f 11 51'
const CAPTURED_TRAILER = '1f 12 20 00 1f c0 01 01'
const CAPTURED_EPILOGUE = '1f 11 50'

describe('printJobFraming', () => {
  it('reproduces the captured vendor job byte for byte', () => {
    const { stream, epilogue } = framingHex({
      paperType: PaperType.Gap,
      density: 10,
    })
    expect(stream).toBe(`${CAPTURED_PREAMBLE} aa bb ${CAPTURED_TRAILER}`)
    expect(epilogue).toEqual([CAPTURED_EPILOGUE])
  })

  it('says nothing about speed unless asked', () => {
    // `1F 60` is the one command we ever sent that the capture does not contain,
    // and it came from the part of the SDK whose other commands do not exist. It
    // stays reachable, but a default print must not carry it.
    expect(framingHex({ paperType: PaperType.Gap, density: 10 }).stream).not.toContain('1f 60')
    expect(
      framingHex({ paperType: PaperType.Gap, density: 10, speed: Speed.High }).stream,
    ).toContain('1f 60 01 02')
  })

  it('leaves the seek out when the job is only moving paper', () => {
    // The diagnostics feed prints blank rows to advance a measured distance. With
    // the seek in the trailer it fed the requested 2 mm and then went to the gap,
    // which is not a feed — and makes stepping the paper to find the gap
    // impossible, which is the tool's only purpose.
    const trailer = printJobFraming({
      paperType: PaperType.Gap,
      density: 8,
      seekGap: false,
    }).trailer.map((c) => hex(c.bytes))
    expect(trailer).toEqual(['1f c0 01 01'])
  })

  it('seeks the boundary the loaded stock actually has', () => {
    // Gap mode used to be hard-coded here, which told a printer set to continuous
    // to go and find a gap.
    const trailer = (paperType: Parameters<typeof printJobFraming>[0]['paperType']) =>
      printJobFraming({ paperType, density: 8 }).trailer.map((c) => hex(c.bytes))
    expect(trailer(PaperType.Gap)).toEqual(['1f 12 20 00', '1f c0 01 01'])
    expect(trailer(PaperType.Continuous)).toEqual(['1f 12 10 00', '1f c0 01 01'])
    expect(trailer(PaperType.BlackMark)).toEqual(['1f 12 30 00', '1f c0 01 01'])
  })
})

describe('band framing', () => {
  it('retracts for the first band of a label and not the rest', () => {
    // One label is one print, however many jobs it takes. Retracting again
    // mid-label would pull the paper back to the tear-off position and tear the
    // image; only the first band has an advance behind it to undo.
    const first = hex(printJobStream(printJobFraming({ paperType: PaperType.Gap, density: 8 }), A))
    expect(first).toContain('1f 11 51')

    const later = hex(
      printJobStream(
        printJobFraming({ paperType: PaperType.Gap, density: 8, alignStart: false }),
        A,
      ),
    )
    expect(later).not.toContain('1f 11 51')
    // And no `adjustPosition` in its place: winding back the seam was tried that way
    // at eight dots and at forty and ignored both times, and it is inert in all four
    // of its modes on both sides of the raster. `alignPaperStart` is the only command
    // that moves paper backwards, which is why closing the seam means turning that
    // one back on — see PrintSettings.closeSplitSeam.
    expect(later).not.toContain('1f 11 10')
  })
})

describe('printJobStream', () => {
  it('leaves no seam for a chunker to fall into', () => {
    // The point of the function: commands and raster are one stream, so a driver
    // chunking it cannot write anything outside its flow-control loop. If this
    // ever returns the pieces separately again, the gap seek goes out uncredited.
    const framing = printJobFraming({ paperType: PaperType.Gap, density: 8 })
    const image = Uint8Array.from({ length: 500 }, (_, i) => i & 0xff)
    const stream = printJobStream(framing, image)

    const framingBytes = [...framing.preamble, ...framing.trailer].reduce(
      (n, c) => n + c.bytes.length,
      0,
    )
    expect(stream.length).toBe(framingBytes + image.length)
    // The epilogue is the one thing deliberately left out — the capture sends it
    // as its own transfer.
    expect(hex(stream)).not.toContain(CAPTURED_EPILOGUE)
  })
})
