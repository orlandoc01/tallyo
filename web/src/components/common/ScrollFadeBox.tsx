import clsx from 'clsx'
import { useCallback, useState, type ReactNode } from 'react'

export function ScrollFadeBox({ children, className }: { children: ReactNode; className?: string }) {
  const [overflowing, setOverflowing] = useState(false)
  const update = (el: HTMLElement) => setOverflowing(el.scrollHeight - el.scrollTop - el.clientHeight > 1)
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    update(el)
    // ponytail: watches the box, not its children; filtering only changes overflow by resizing the box anyway
    const observer = new ResizeObserver(() => update(el))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div className="relative">
      <div className={clsx('overflow-auto', className)} onScroll={(event) => update(event.currentTarget)} ref={ref}>
        {children}
      </div>
      {overflowing ? <div aria-hidden className="scroll-fade pointer-events-none absolute inset-x-px bottom-px h-8 rounded-b-xl" /> : null}
    </div>
  )
}
