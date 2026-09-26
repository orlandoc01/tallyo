import { useId, type ReactNode } from 'react'
import { MobileFilterFooter } from './MobileFilterFooter'
import { MobileSheet } from './MobileFilterDropdown'
import { SheetActionRow } from './SheetRows'

export interface ActionSheetItem {
  label: string
  destructive?: boolean
  disabled?: boolean
  title?: string
  onSelect: () => void
}

// Items never auto-close: callers own the open state (a step change unmounts a
// chooser; two-step confirms stay open), so closing here would race that update.
export function ActionSheet({ hero, items, onClose, title }: {
  hero?: ReactNode
  items: ActionSheetItem[]
  onClose: () => void
  title: string
}) {
  const labelledBy = useId()
  return (
    <MobileSheet
      footer={<MobileFilterFooter primaryLabel="Cancel" primaryVariant="secondary" onPrimary={onClose} />}
      hideClose
      labelledBy={labelledBy}
      onClose={onClose}
      title={title}
    >
      {hero}
      {items.map((item, index) => (
        <SheetActionRow
          destructive={item.destructive}
          disabled={item.disabled}
          // Labels change on two-step confirms; a positional key keeps focus on the same button.
          key={index}
          label={item.label}
          onClick={item.onSelect}
          title={item.title}
        />
      ))}
    </MobileSheet>
  )
}
