import { MoreHorizontal } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { useDismiss } from '../../hooks/useDismiss'
import { useIsMobile } from '../../hooks/useIsMobile'
import { ActionMenuItem } from './ActionMenuItem'
import { ActionSheet, type ActionSheetItem } from './ActionSheet'
import { IconButton } from './Button'

export type RowAction = ActionSheetItem

// Items close the menu themselves (two-step confirms stay open). Items are
// keyed by position so a confirm label change keeps the focused button mounted.
export function RowActionsMenu({ ariaLabel, hero, isOpen, items, onToggle, title }: {
  ariaLabel: string
  hero?: ReactNode
  isOpen: boolean
  items: RowAction[]
  onToggle: () => void
  title: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()
  useDismiss(isOpen && !isMobile, onToggle, [ref])

  return (
    <div className="relative shrink-0" ref={ref}>
      <IconButton ariaLabel={ariaLabel} expanded={isOpen} haspopup="dialog" onClick={onToggle} size="sm">
        <MoreHorizontal className="h-4 w-4" />
      </IconButton>
      {isOpen && isMobile ? <ActionSheet hero={hero} items={items} onClose={onToggle} title={title} /> : null}
      {isOpen && !isMobile ? (
        <div aria-label={ariaLabel} className="absolute right-0 z-30 mt-1 w-48 rounded-lg border border-border-strong bg-raised p-2 shadow-dropdown" role="dialog">
          {items.map((item, index) => (
            <ActionMenuItem className="disabled:cursor-not-allowed disabled:opacity-40" destructive={item.destructive} disabled={item.disabled} key={index} onClick={item.onSelect} title={item.title}>
              {item.label}
            </ActionMenuItem>
          ))}
        </div>
      ) : null}
    </div>
  )
}
