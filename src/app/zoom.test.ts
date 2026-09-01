import { describe, expect, it } from 'vitest'
import { clampEditZoom, MAX_EDIT_ZOOM, MIN_EDIT_ZOOM, wheelZoomFactor } from './zoom'

/**
 * Ctrl+scroll and trackpad-pinch zoom.
 *
 * The DOM half of this — a non-passive listener on the stage that calls
 * preventDefault so the browser zooms the editor instead of the page — is five
 * lines and cannot be meaningfully tested without a trusted input event. The
 * arithmetic is where the mistakes live, and it is all here.
 */

describe('wheelZoomFactor', () => {
  it('zooms in when the wheel goes up and out when it goes down', () => {
    // deltaY is negative scrolling up, which everywhere means zoom in.
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1)
    expect(wheelZoomFactor(100)).toBeLessThan(1)
  })

  it('undoes itself exactly', () => {
    // The reason it is exponential rather than a percentage added and subtracted.
    // Zooming in and back out has to land on the number it started from, or a user
    // rocking the wheel drifts away from where they were.
    for (const delta of [10, 100, 240]) {
      expect(wheelZoomFactor(-delta) * wheelZoomFactor(delta)).toBeCloseTo(1, 12)
    }
  })

  it('scales the same way at any zoom', () => {
    // Also from being exponential: two steps in is the square of one step, whatever
    // the label is currently at. An additive step would crawl at 300% and lurch at
    // 30%.
    expect(wheelZoomFactor(-50) ** 2).toBeCloseTo(wheelZoomFactor(-100), 12)
  })

  it('treats a line the way a browser means it', () => {
    // Firefox reports a mouse notch as three *lines*, Chrome as a hundred pixels.
    // Taken at face value Firefox would zoom by a thirtieth of what Chrome does,
    // and the feature would look broken on one browser only.
    const chromeNotch = wheelZoomFactor(100, 0)
    const firefoxNotch = wheelZoomFactor(3, 1)
    expect(firefoxNotch).toBeLessThan(1)
    // Not identical — three lines is 48 px, not 100 — but the same order, which is
    // what stops one browser feeling broken.
    expect(Math.log(firefoxNotch) / Math.log(chromeNotch)).toBeGreaterThan(0.25)
    expect(Math.log(firefoxNotch) / Math.log(chromeNotch)).toBeLessThan(1)
  })

  it('treats a page as a much bigger step than a line', () => {
    expect(wheelZoomFactor(1, 2)).toBeLessThan(wheelZoomFactor(1, 1))
    expect(wheelZoomFactor(1, 1)).toBeLessThan(wheelZoomFactor(1, 0))
  })

  it('is gentle enough for a trackpad and firm enough for a wheel', () => {
    // A pinch arrives as a burst of small deltas, so each one has to be nearly
    // nothing or the label leaps; a mouse notch arrives alone and has to be worth
    // seeing. Both come out of the same curve, which is the only reason one handler
    // can serve both.
    expect(wheelZoomFactor(-4)).toBeLessThan(1.02)
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1.15)
    expect(wheelZoomFactor(-100)).toBeLessThan(1.4)
  })

  it('never returns something that would wreck the zoom', () => {
    // deltaY comes off a device. NaN from a synthetic or malformed event must not
    // turn the zoom into NaN, which no later clamp could recover from.
    expect(wheelZoomFactor(NaN)).toBe(1)
    expect(wheelZoomFactor(Infinity)).toBe(1)
    expect(wheelZoomFactor(0)).toBe(1)
  })
})

describe('clampEditZoom', () => {
  it('keeps the zoom inside what the editor can show', () => {
    expect(clampEditZoom(1000)).toBe(MAX_EDIT_ZOOM)
    expect(clampEditZoom(0.0001)).toBe(MIN_EDIT_ZOOM)
    expect(clampEditZoom(1.37)).toBe(1.37)
  })

  it('survives a value that is not a number', () => {
    // The bound that matters: a single NaN would otherwise stick, because every
    // later multiplication of it is NaN too and the editor would never recover.
    expect(clampEditZoom(NaN)).toBe(1)
  })

  it('bottoms out somewhere still usable', () => {
    // Below about a quarter there is nothing left to grab with a pointer.
    expect(MIN_EDIT_ZOOM).toBeGreaterThanOrEqual(0.2)
    expect(MAX_EDIT_ZOOM).toBeGreaterThan(1)
  })
})
