import clsx from 'clsx'
import { MoreHorizontal } from 'lucide-react'
import type { ReactNode } from 'react'

const alignmentClass = {
  end: {
    panel: 'right-0 w-44',
    wrapper: 'relative',
  },
  'responsive-end': {
    panel: 'left-0 w-48 md:left-auto md:right-0',
    wrapper: 'relative justify-self-start md:justify-self-end',
  },
}

export function RowActionsMenu({ ariaLabel, isOpen, onToggle, align = 'end', children }: {
  ariaLabel: string
  isOpen: boolean
  onToggle: () => void
  align?: keyof typeof alignmentClass
  children: ReactNode
}) {
  return (
    <div className={alignmentClass[align].wrapper}>
      <button
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className="rounded-full border border-neutral-200 p-2 text-neutral-600 hover:bg-neutral-50"
        onClick={onToggle}
        type="button"
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {isOpen ? (
        <div className={clsx('absolute z-10 mt-2 overflow-hidden rounded-2xl border border-neutral-200 bg-white py-1 text-sm shadow-xl', alignmentClass[align].panel)}>
          {children}
        </div>
      ) : null}
    </div>
  )
}
