import clsx from 'clsx'
import type { Category } from '../../types/graphql'
import { chartOpacityForFocus, spendingChartFillColor } from '../../utils/chartStyles'
import { formatSignedCurrency } from '../../utils/currency'

interface CategoryBarItem {
  category: Pick<Category, 'emoji' | 'id' | 'name'>
  total: number
}

export function CategoryBar({
  dimmed = false,
  focused = false,
  item,
  maxAbsTotal,
  onClick,
}: {
  dimmed?: boolean
  focused?: boolean
  item: CategoryBarItem
  maxAbsTotal: number
  onClick?: () => void
}) {
  const percent = maxAbsTotal > 0 ? Math.max(3, (Math.abs(item.total) / maxAbsTotal) * 100) : 0
  const fillOpacity = chartOpacityForFocus(focused)
  const formattedTotal = formatSignedCurrency(item.total)
  const rowClass = 'grid grid-cols-1 items-center gap-3 text-sm sm:grid-cols-[minmax(6rem,12rem)_1fr_5rem]'
  const content = (
    <>
      <div className="relative min-w-0 sm:contents">
        <div className={clsx('absolute inset-y-0 left-3 right-3 z-10 flex min-w-0 items-center justify-between gap-3 sm:static sm:block', focused ? 'text-neutral-900 dark:text-neutral-100' : dimmed ? 'text-neutral-400' : 'text-neutral-600')}>
          <span className="truncate">{item.category.emoji} {item.category.name}</span>
          <span className={clsx('shrink-0 font-medium tabular-nums sm:hidden', dimmed ? 'text-neutral-400' : 'text-neutral-700')}>{formattedTotal}</span>
        </div>
        <div className={clsx('relative h-9 rounded-xl sm:h-7', dimmed ? 'bg-neutral-50' : 'bg-neutral-100')}>
          <div
            className={`cat-bar-fill absolute top-0 h-full rounded-xl ${item.total < 0 ? 'right-0' : 'left-0'}`}
            style={{ backgroundColor: spendingChartFillColor(item.category.id, dimmed), opacity: fillOpacity, width: `${percent}%` }}
          />
        </div>
      </div>
      <div className={clsx('hidden text-right font-medium tabular-nums sm:block', dimmed ? 'text-neutral-400' : 'text-neutral-700')}>{formattedTotal}</div>
    </>
  )

  if (!onClick) {
    return <div className={rowClass}>{content}</div>
  }

  return (
    <button
      aria-pressed={focused}
      className={clsx(
        rowClass,
        'w-full rounded-xl px-2 py-1 text-left transition focus:outline-none focus:ring-2 focus:ring-brand-400',
        focused ? 'bg-brand-50' : 'hover:bg-neutral-50',
      )}
      onClick={onClick}
      type="button"
    >
      {content}
    </button>
  )
}
