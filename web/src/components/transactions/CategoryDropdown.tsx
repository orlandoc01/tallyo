import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Category } from '../../types/graphql'
import { CategoryPicker } from './CategoryPicker'

export function CategoryDropdown({
  anchorRef,
  categories,
  isOpen,
  onClose,
  onSelect,
}: {
  anchorRef: RefObject<HTMLElement | null>
  categories: Category[]
  isOpen: boolean
  onClose: () => void
  onSelect: (category: Category) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<DropdownPosition | null>(null)

  useLayoutEffect(() => {
    if (!isOpen) return

    function updatePosition() {
      const anchor = anchorRef.current
      if (!anchor) return

      const rect = anchor.getBoundingClientRect()
      const dropdownWidth = 256
      const margin = 8
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      const openAbove = spaceBelow < 320 && spaceAbove > spaceBelow
      const maxHeight = Math.max(160, (openAbove ? spaceAbove : spaceBelow) - margin * 2)

      setPosition({
        left: Math.min(Math.max(margin, rect.left), window.innerWidth - dropdownWidth - margin),
        maxHeight,
        top: openAbove ? undefined : rect.bottom + margin,
        bottom: openAbove ? window.innerHeight - rect.top + margin : undefined,
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)

    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, isOpen])

  useEffect(() => {
    if (!isOpen) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  if (!position) return null

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={(e) => { e.stopPropagation(); onClose() }}
        onTouchEnd={(e) => { e.preventDefault(); e.stopPropagation(); onClose() }}
      />
      <div
        className="fixed z-50 w-64 overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-2 shadow-card"
        onClick={(event) => event.stopPropagation()}
        ref={ref}
        style={position}
      >
        <CategoryPicker
          categories={categories}
          onSelect={(category) => {
            onSelect(category)
            onClose()
          }}
        />
      </div>
    </>,
    document.body,
  )
}

interface DropdownPosition {
  bottom?: number
  left: number
  maxHeight: number
  top?: number
}
