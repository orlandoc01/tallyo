import clsx from 'clsx'
import { SlidersHorizontal, X } from 'lucide-react'
import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { FilterCountBadge } from './FiltersButton'
import { mobileHeaderActionClass } from './mobileHeaderActionClass'

interface MobileFilterButtonProps {
  active?: boolean
  ariaLabel?: string
  count?: number
  highlighted?: boolean
  onClick: () => void
}

export function MobileFilterButton({ active = false, ariaLabel = 'Open filters', count = 0, highlighted = false, onClick }: MobileFilterButtonProps) {
  return (
    <button
      aria-expanded={active}
      aria-label={count > 0 ? `${ariaLabel}, ${count} active` : ariaLabel}
      className={mobileHeaderActionClass('relative w-9 touch-manipulation', active || highlighted || count > 0)}
      onClick={onClick}
      type="button"
    >
      <SlidersHorizontal className="h-4 w-4" />
      {count > 0 ? <FilterCountBadge className="absolute -right-1.5 -top-1.5" count={count} /> : null}
    </button>
  )
}

interface MobileSheetProps {
  action?: ReactNode
  bodyClassName?: string
  children: ReactNode
  footer?: ReactNode
  hideClose?: boolean
  labelledBy: string
  maxHeight?: '78%' | '84%'
  onClear?: () => void
  onClose: () => void
  title?: string
}

const DISMISS_DRAG_PX = 64

function useSwipeDown(onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null)
  const startY = useRef<number | null>(null)

  function offset(event: ReactPointerEvent<HTMLDivElement>) {
    return startY.current === null ? null : Math.max(0, event.clientY - startY.current)
  }

  function settle(dy: number | null) {
    startY.current = null
    if (dy !== null && dy > DISMISS_DRAG_PX) onClose()
    else if (panelRef.current) panelRef.current.style.transform = ''
  }

  const gripHandlers = {
    onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
      if ((event.target as Element).closest('button')) return
      event.currentTarget.setPointerCapture?.(event.pointerId)
      startY.current = event.clientY
    },
    onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
      const dy = offset(event)
      if (dy !== null && panelRef.current) panelRef.current.style.transform = `translateY(${dy}px)`
    },
    onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
      settle(offset(event))
    },
    onPointerCancel() {
      settle(null)
    },
  }

  return { panelRef, gripHandlers }
}

export function MobileSheet({ action, bodyClassName, children, footer, hideClose = false, labelledBy, maxHeight = '78%', onClear, onClose, title = 'Filters' }: MobileSheetProps) {
  const titleAction = action ?? (onClear ? <Button className="touch-manipulation" onClick={onClear} size="sm" variant="ghost">Clear filters</Button> : null)
  const { panelRef, gripHandlers } = useSwipeDown(onClose)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])
  const dialog = (
    <div
      aria-labelledby={labelledBy}
      aria-modal="true"
      className="fixed inset-0 z-40 bg-overlay lg:hidden"
      onClick={onClose}
      role="dialog"
    >
      <div
        className={clsx('fixed inset-x-0 bottom-0 flex flex-col rounded-t-2xl border-t border-border-strong bg-surface shadow-sheet', maxHeight === '84%' ? 'max-h-[84%]' : 'max-h-[78%]')}
        onClick={(event) => event.stopPropagation()}
        ref={panelRef}
      >
        <div className="flex shrink-0 flex-col touch-none" {...gripHandlers}>
          <span aria-hidden className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-sm bg-border-emph" />
          <div className="flex shrink-0 items-center justify-between px-4 pb-2.5 pt-2">
            <h2 className="text-base font-semibold text-text-1" id={labelledBy}>{title}</h2>
            <span className="flex items-center gap-1">
              {titleAction}
              {hideClose ? null : (
                <button
                  aria-label="Close filters"
                  className="touch-manipulation rounded-md p-1 text-text-muted [@media(hover:hover)]:hover:bg-raised [@media(hover:hover)]:hover:text-text-1"
                  onClick={onClose}
                  type="button"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
            </span>
          </div>
        </div>
        <div className={clsx('min-h-0 flex-1 overflow-y-auto px-4', bodyClassName)}>
          {children}
        </div>
        {footer}
      </div>
    </div>
  )

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}

export const MobileFilterDropdown = MobileSheet
