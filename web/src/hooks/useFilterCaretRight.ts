import { useLayoutEffect, useState, type RefObject } from 'react'

// Distance from the panel's right edge to the centre of the anchor button,
// so the caret follows the button wherever the header lays it out.
export function useFilterCaretRight(open: boolean, anchorRef: RefObject<HTMLElement | null>, containerRef: RefObject<HTMLElement | null>) {
  const [caretRight, setCaretRight] = useState<number>()

  useLayoutEffect(() => {
    if (!open) return
    function measure() {
      const anchor = anchorRef.current?.getBoundingClientRect()
      const container = containerRef.current?.getBoundingClientRect()
      if (!anchor || !container) return
      setCaretRight(Math.round(container.right - (anchor.left + anchor.width / 2) - 6))
    }
    measure()
    window.addEventListener('resize', measure)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (anchorRef.current) observer?.observe(anchorRef.current)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [open, anchorRef, containerRef])

  return caretRight
}
