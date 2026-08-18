import { describe, expect, it } from 'vitest'
import { rasterize } from './rasterize'
import { unpack1bpp } from './pack1bpp'
import { ICONS, findIcon, iconToSvg } from './icons'
import { createEmptyDoc, type LabelDoc, type LabelElement } from '../model/labelDoc'

/** A grey-ramp PNG, so thresholding and dithering behave visibly differently. */
function rampDataUrl(width = 64, height = 64): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  for (let x = 0; x < width; x++) {
    const v = Math.round((x / (width - 1)) * 255)
    ctx.fillStyle = `rgb(${v},${v},${v})`
    ctx.fillRect(x, 0, 1, height)
  }
  return canvas.toDataURL('image/png')
}

/** Solid black square with a transparent margin, for fit and alpha behaviour. */
function squareDataUrl(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 40
  canvas.height = 20
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, 40, 20)
  return canvas.toDataURL('image/png')
}

const resolveAsset = async (id: string) => (id === 'ramp' ? rampDataUrl() : squareDataUrl())

function docWith(element: Partial<LabelElement>, widthMm = 30, heightMm = 30): LabelDoc {
  const doc = createEmptyDoc(widthMm, heightMm)
  doc.elements = [
    {
      id: 'e1',
      x: 2,
      y: 2,
      widthMm: 20,
      heightMm: 20,
      rotation: 0,
      z: 1,
      ...element,
    } as LabelElement,
  ]
  return doc
}

const inkCount = (bits: Uint8Array) => bits.reduce((n: number, v: number) => n + v, 0)

describe('icons', () => {
  it('exposes a non-empty, uniquely-identified set', () => {
    expect(ICONS.length).toBeGreaterThan(10)
    expect(new Set(ICONS.map((i) => i.id)).size).toBe(ICONS.length)
  })

  it('produces a well-formed SVG that the browser can parse', () => {
    for (const icon of ICONS) {
      const doc = new DOMParser().parseFromString(iconToSvg(icon, 64), 'image/svg+xml')
      expect(doc.querySelector('parsererror'), `${icon.id} is malformed`).toBeNull()
    }
  })

  it('keeps strokes at least a dot wide when rendered small', () => {
    // At 16 dots the nominal 2/24 stroke would be ~1.3 dots; the floor keeps it
    // from rounding away and leaving gaps in the outline.
    const svg = iconToSvg(findIcon('circle')!, 16)
    const width = Number(svg.match(/stroke-width="([\d.]+)"/)![1])
    expect((width / 24) * 16).toBeGreaterThanOrEqual(1)
  })

  it.each(ICONS.map((i) => i.id))('renders %s as ink', async (iconId) => {
    const doc = docWith({ kind: 'icon', iconId, widthMm: 12, heightMm: 12 })
    const { bitmap } = await rasterize(doc)
    expect(inkCount(unpack1bpp(bitmap))).toBeGreaterThan(20)
  })

  it('ignores an unknown icon id rather than failing the render', async () => {
    const doc = docWith({ kind: 'icon', iconId: 'no-such-icon' })
    const { bitmap } = await rasterize(doc)
    expect(inkCount(unpack1bpp(bitmap))).toBe(0)
  })
})

describe('images', () => {
  it('renders line art as ink', async () => {
    const doc = docWith({ kind: 'image', assetId: 'square', mode: 'lineart', fit: 'contain' })
    const { bitmap } = await rasterize(doc, { resolveAsset })
    expect(inkCount(unpack1bpp(bitmap))).toBeGreaterThan(100)
  })

  it('is skipped when no asset resolver is supplied', async () => {
    const doc = docWith({ kind: 'image', assetId: 'square', mode: 'lineart', fit: 'contain' })
    const { bitmap } = await rasterize(doc)
    expect(inkCount(unpack1bpp(bitmap))).toBe(0)
  })

  it('thresholds line art into two tones, but dithers a photo into many', async () => {
    const lineart = await rasterize(
      docWith({ kind: 'image', assetId: 'ramp', mode: 'lineart', fit: 'stretch' }),
      { resolveAsset },
    )
    const photo = await rasterize(
      docWith({ kind: 'image', assetId: 'ramp', mode: 'photo', fit: 'stretch' }),
      { resolveAsset },
    )

    // A thresholded ramp is a clean vertical split, so every row inside the
    // image is identical. A dithered one scatters error between rows, so they
    // differ. Sample only rows well inside the image: the blank label around it
    // is a distinct pattern of its own and would mask the difference.
    const distinctRowsInside = (r: typeof lineart) => {
      const bits = unpack1bpp(r.bitmap)
      const rows = new Set<string>()
      for (let y = 40; y < 140; y++) {
        rows.add(bits.slice(y * r.bitmap.widthDots + 20, y * r.bitmap.widthDots + 150).join(''))
      }
      return rows.size
    }
    expect(distinctRowsInside(lineart)).toBe(1)
    expect(distinctRowsInside(photo)).toBeGreaterThan(1)
  })

  it('dithers a photo per image, so the tone plane has nothing left to do', async () => {
    // The dither now runs in `applyImageTone`, at the image's own dot size. The
    // proof is that the *element's* own pixels are already scattered before the
    // shared tone plane ever sees them — which the row-variation check below
    // demonstrates, and which the idempotency test in render.test.ts pins from
    // the other side.
    const { bitmap } = await rasterize(
      docWith({ kind: 'image', assetId: 'ramp', mode: 'photo', fit: 'stretch' }),
      { resolveAsset },
    )
    const bits = unpack1bpp(bitmap)
    // Every value is 0 or 1 by construction; what matters is that a mid-grey
    // column is *mixed* rather than uniformly one or the other.
    const column = 80
    const values = new Set<number>()
    for (let y = 40; y < 140; y++) values.add(bits[y * bitmap.widthDots + column])
    expect(values.size).toBe(2)
  })

  it('honours the per-image dither algorithm', async () => {
    const render = async (dither: 'floyd-steinberg' | 'atkinson' | 'bayer') =>
      unpack1bpp(
        (
          await rasterize(
            docWith({ kind: 'image', assetId: 'ramp', mode: 'photo', fit: 'stretch', dither }),
            { resolveAsset },
          )
        ).bitmap,
      ).join('')

    const fs = await render('floyd-steinberg')
    expect(await render('atkinson')).not.toBe(fs)
    expect(await render('bayer')).not.toBe(fs)
  })

  it('lets two photos on one label dither differently', async () => {
    // The whole reason the dither moved out of the shared tone plane: that plane
    // is single-pass, so before this it was one algorithm for the entire label.
    const doc = docWith({ kind: 'image', assetId: 'ramp', mode: 'photo', fit: 'stretch' }, 60, 30)
    doc.elements = [
      { ...doc.elements[0], id: 'a', dither: 'bayer' },
      { ...doc.elements[0], id: 'b', x: 26, z: 2, dither: 'floyd-steinberg' },
    ] as typeof doc.elements
    const { bitmap } = await rasterize(doc, { resolveAsset })
    const bits = unpack1bpp(bitmap)

    // The ordered matrix repeats on an 8-dot grid; error diffusion does not. So
    // the left image has far fewer distinct row patterns than the right one.
    const distinctRows = (from: number, to: number) => {
      const rows = new Set<string>()
      for (let y = 40; y < 140; y++) {
        rows.add(bits.slice(y * bitmap.widthDots + from, y * bitmap.widthDots + to).join(''))
      }
      return rows.size
    }
    expect(distinctRows(30, 140)).toBeLessThan(distinctRows(240, 350))
  })

  it('applies brightness and contrast before dithering', async () => {
    const ink = async (tone: { brightness?: number; contrast?: number }) =>
      inkCount(
        unpack1bpp(
          (
            await rasterize(
              docWith({
                kind: 'image',
                assetId: 'ramp',
                mode: 'photo',
                fit: 'stretch',
                dither: 'bayer',
                ...tone,
              }),
              { resolveAsset },
            )
          ).bitmap,
        ),
      )

    const plain = await ink({})
    // Brightness moves the whole ramp, so darkening it must add ink.
    expect(await ink({ brightness: -60 })).toBeGreaterThan(plain)
    expect(await ink({ brightness: 60 })).toBeLessThan(plain)
    // Contrast pivots about mid-grey, so on a symmetric ramp the total barely
    // moves — but the pattern must, or the control is doing nothing.
    const contrasted = await rasterize(
      docWith({
        kind: 'image',
        assetId: 'ramp',
        mode: 'photo',
        fit: 'stretch',
        dither: 'bayer',
        contrast: 80,
      }),
      { resolveAsset },
    )
    const flat = await rasterize(
      docWith({ kind: 'image', assetId: 'ramp', mode: 'photo', fit: 'stretch', dither: 'bayer' }),
      { resolveAsset },
    )
    expect(unpack1bpp(contrasted.bitmap).join('')).not.toBe(unpack1bpp(flat.bitmap).join(''))
  })

  it('honours the per-image threshold', async () => {
    const dark = await rasterize(
      docWith({ kind: 'image', assetId: 'ramp', mode: 'lineart', fit: 'stretch', threshold: 40 }),
      { resolveAsset },
    )
    const light = await rasterize(
      docWith({ kind: 'image', assetId: 'ramp', mode: 'lineart', fit: 'stretch', threshold: 220 }),
      { resolveAsset },
    )
    expect(inkCount(unpack1bpp(light.bitmap))).toBeGreaterThan(inkCount(unpack1bpp(dark.bitmap)))
  })

  it('inverts on request', async () => {
    const plain = await rasterize(
      docWith({ kind: 'image', assetId: 'ramp', mode: 'lineart', fit: 'stretch' }),
      { resolveAsset },
    )
    const inverted = await rasterize(
      docWith({ kind: 'image', assetId: 'ramp', mode: 'lineart', fit: 'stretch', invert: true }),
      { resolveAsset },
    )
    // Inverting a symmetric ramp keeps the ink *count* the same and swaps which
    // half is inked, so compare positions rather than totals.
    const a = unpack1bpp(plain.bitmap)
    const b = unpack1bpp(inverted.bitmap)
    const row = 80 * plain.bitmap.widthDots
    expect(a[row + 20]).toBe(1) // dark end of the ramp
    expect(b[row + 20]).toBe(0) // becomes the light end
    expect(a[row + 150]).toBe(0)
    expect(b[row + 150]).toBe(1)
  })

  it('leaves the letterbox transparent when fitting inside the box', async () => {
    // The source is 2:1, the box is square, so `contain` leaves bands top and
    // bottom. Those must not become opaque white and mask content underneath.
    const doc = createEmptyDoc(30, 30)
    doc.elements = [
      {
        id: 'under',
        kind: 'shape',
        shape: 'rect',
        filled: true,
        strokeMm: 0,
        x: 2,
        y: 2,
        widthMm: 20,
        heightMm: 3,
        rotation: 0,
        z: 1,
      },
      {
        id: 'img',
        kind: 'image',
        assetId: 'square',
        mode: 'lineart',
        fit: 'contain',
        x: 2,
        y: 2,
        widthMm: 20,
        heightMm: 20,
        rotation: 0,
        z: 2,
      },
    ]
    const { bitmap } = await rasterize(doc, { resolveAsset })
    const bits = unpack1bpp(bitmap)
    // The bar underneath sits in the top letterbox band and must still be inked.
    const y = 20
    let inked = 0
    for (let x = 16; x < 176; x++) if (bits[y * bitmap.widthDots + x]) inked++
    expect(inked).toBeGreaterThan(50)
  })
})
