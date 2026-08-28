import clsx from 'clsx'
import { SlidersHorizontal, X } from 'lucide-react'
import { useLayoutEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { mobileHeaderActionClass } from './mobileHeaderActionClass'

const DEFAULT_MOBILE_HEADER_BOTTOM = 48
const MOBILE_HEADER_SELECTOR = '[data-mobile-header]'

interface MobileFilterButtonProps {
  active?: boolean
  ariaLabel?: string
  highlighted?: boolean
  onClick: () => void
}

export function MobileFilterButton({ active = false, ariaLabel = 'Open filters', highlighted = false, onClick }: MobileFilterButtonProps) {
  return (
    <button
      aria-expanded={active}
      aria-label={ariaLabel}
      className={mobileHeaderActionClass('touch-manipulation rounded-xl p-2.5', active || highlighted)}
      onClick={onClick}
      type="button"
    >
      <SlidersHorizontal className="h-5 w-5" />
    </button>
  )
}

interface MobileFilterDropdownProps {
  bodyClassName?: string
  children: ReactNode
  footer?: ReactNode
  labelledBy: string
  onClose: () => void
  title?: string
}

export function MobileFilterDropdown({ bodyClassName, children, footer, labelledBy, onClose, title = 'Filters' }: MobileFilterDropdownProps) {
  const headerBottom = useMobileHeaderBottom()
  const dialog = (
    <div
      aria-labelledby={labelledBy}
      aria-modal="true"
      className="fixed inset-x-0 bottom-0 z-50 lg:hidden"
      onClick={onClose}
      role="dialog"
      style={{ top: headerBottom }}
    >
      <div
        className="absolute right-0 top-0 flex max-h-full min-h-0 w-[min(20rem,100vw)] flex-col overflow-hidden rounded-b-3xl border-x border-b border-neutral-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 p-4">
          <h2 className="text-lg font-bold" id={labelledBy}>{title}</h2>
          <button
            aria-label="Close filters"
            className="touch-manipulation rounded-full p-1 text-neutral-600 [@media(hover:hover)]:hover:bg-neutral-100 [@media(hover:hover)]:hover:text-neutral-950"
            onClick={onClose}
            type="button"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className={clsx('min-h-0 flex-1 overflow-y-auto p-4', bodyClassName)}>
          {children}
        </div>
        {footer}
      </div>
    </div>
  )

  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body)
}

function useMobileHeaderBottom() {
  const [headerBottom, setHeaderBottom] = useState(DEFAULT_MOBILE_HEADER_BOTTOM)

  useLayoutEffect(() => {
    const header = document.querySelector<HTMLElement>(MOBILE_HEADER_SELECTOR)
    if (!header) return
    const mobileHeader = header

    function updateHeaderBottom() {
      const bottom = Math.ceil(mobileHeader.getBoundingClientRect().bottom)
      if (bottom > 0) setHeaderBottom(bottom)
    }

    updateHeaderBottom()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateHeaderBottom)
    resizeObserver?.observe(mobileHeader)
    window.addEventListener('resize', updateHeaderBottom)
    window.visualViewport?.addEventListener('resize', updateHeaderBottom)
    window.visualViewport?.addEventListener('scroll', updateHeaderBottom)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', updateHeaderBottom)
      window.visualViewport?.removeEventListener('resize', updateHeaderBottom)
      window.visualViewport?.removeEventListener('scroll', updateHeaderBottom)
    }
  }, [])

  return headerBottom
}
