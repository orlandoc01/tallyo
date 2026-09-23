import clsx from 'clsx'
import type { CashFlowBreakdown } from '../../types/graphql'
import { CASH_FLOW_EXPENSE_BAR_FILL, CASH_FLOW_INCOME_BAR_FILL } from '../../utils/colors'
import { formatCurrency, formatSignedCurrency } from '../../utils/currency'
import { ClickableRow } from '../common/ClickableRow'
import { DottedBar } from '../common/DottedBar'
import { Card } from '../common/FormControls'

const TONE = {
  income: { color: CASH_FLOW_INCOME_BAR_FILL, totalClass: 'text-positive' },
  expenses: { color: CASH_FLOW_EXPENSE_BAR_FILL, totalClass: 'text-negative' },
} as const

const ROW_CLASS = 'grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-t border-border px-4 py-2.5 text-left text-[13px] text-text-1 transition-colors duration-150 lg:h-10 lg:grid-cols-[minmax(0,1fr)_minmax(120px,1.2fr)_90px] lg:gap-3 lg:border-b lg:border-t-0 lg:px-0 lg:py-0'

export function CashFlowBreakdownCard({ items, title, tone, total, onItemClick }: {
  items: CashFlowBreakdown[]
  title: string
  tone: keyof typeof TONE
  total: number
  onItemClick: (categoryId: string) => void
}) {
  const { color, totalClass } = TONE[tone]
  const sorted = [...items].sort((a, b) => Math.abs(b.total) - Math.abs(a.total))

  return (
    <Card as="section" className="pb-1 pt-4 lg:px-6 lg:pb-2 lg:pt-5">
      <div className="flex items-baseline justify-between gap-3 px-4 lg:px-0">
        <h2 className="text-[15px] font-semibold text-text-1 lg:text-base">{title}</h2>
        <span className={clsx('text-sm font-medium', totalClass)}>{formatCurrency(total)}</span>
      </div>
      <div className="flex justify-between px-4 pb-2 pt-3.5 text-xs text-text-muted lg:hidden">
        <span>Category</span>
        <span>Weight · Amount</span>
      </div>
      <div className="hidden grid-cols-[minmax(0,1fr)_minmax(120px,1.2fr)_90px] gap-3 border-b border-border pb-2 pt-4 text-xs text-text-muted lg:grid">
        <span>Category</span>
        <span>Weight</span>
        <span className="text-right">Amount</span>
      </div>
      {sorted.map((item) => (
        <ClickableRow ariaLabel={`View ${item.category.name} transactions`} className={clsx(ROW_CLASS, 'hover:bg-raised')} key={item.category.id} onClick={() => onItemClick(item.category.id)}>
          <span className="min-w-0 truncate lg:order-1">{item.category.emoji} {item.category.name}</span>
          <span className="order-2 text-right tabular-nums lg:order-3">{formatSignedCurrency(item.total)}</span>
          <span className="order-3 col-span-2 flex items-center gap-2 lg:order-2 lg:col-span-1">
            <DottedBar color={color} percent={item.percentOfTotal} />
            <span className="min-w-[40px] text-right text-[11px] text-text-muted lg:text-xs">{item.percentOfTotal.toFixed(1)}%</span>
          </span>
        </ClickableRow>
      ))}
      {sorted.length === 0 ? <p className="px-4 py-3 text-[13px] text-text-muted lg:px-0">Nothing in this period.</p> : null}
    </Card>
  )
}
