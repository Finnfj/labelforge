import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * Track an element's content width.
 *
 * A ResizeObserver rather than a window listener, because these panels also
 * change width when the layout reflows around them without the window moving at
 * all. `contentRect` excludes padding, which is what both callers want: they are
 * asking how much room the content has, not how big the box is.
 */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [ref])

  return width
}
