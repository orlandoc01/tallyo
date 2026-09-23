import clsx from 'clsx'
import { SlidersHorizontal } from 'lucide-react'
import type { Ref } from 'react'
import { Button } from './Button'

export function FiltersButton({ count = 0, open, onClick, ref }: { count?: number; open: boolean; onClick: () => void; ref?: Ref<HTMLButtonElement> }) {
  return (
    <Button ref={ref} active={open} aria-expanded={open} aria-label={count ? `Filters, ${count} active` : 'Filters'} highlighted={count > 0} onClick={onClick} variant="secondary">
      Filters
      {count ? <FilterCountBadge count={count} /> : null}
      <SlidersHorizontal aria-hidden className="h-3.5 w-3.5" />
    </Button>
  )
}

export function FilterCountBadge({ count, className }: { count: number; className?: string }) {
  return <span aria-hidden className={clsx('inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-semibold text-white', className)}>{count}</span>
}
