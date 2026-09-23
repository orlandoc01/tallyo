import { MoreHorizontal } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { useDismiss } from '../../hooks/useDismiss'
import { IconButton } from './Button'

export function RowActionsMenu({ ariaLabel, isOpen, onToggle, children }: {
  ariaLabel: string
  isOpen: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(isOpen, onToggle, [ref])

  return (
    <div className="relative shrink-0" ref={ref}>
      <IconButton ariaLabel={ariaLabel} expanded={isOpen} haspopup="dialog" onClick={onToggle} size="sm">
        <MoreHorizontal className="h-4 w-4" />
      </IconButton>
      {isOpen ? (
        <div aria-label={ariaLabel} className="absolute right-0 z-30 mt-1 w-48 rounded-lg border border-border-strong bg-raised p-2 shadow-dropdown" role="dialog">
          {children}
        </div>
      ) : null}
    </div>
  )
}
