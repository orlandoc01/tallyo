import { useTheme } from '../../hooks/useTheme'
import type { CashFlowBreakdown } from '../../types/graphql'
import { formatCurrency } from '../../utils/currency'
import { Card } from '../common/FormControls'
import { getCashFlowPalette } from './cashFlowChart'

// Per-category income or expense breakdown for the selected cash-flow period,
// rendered as proportional bars. Rows link into the transactions list.
export function CashFlowCategoryBreakdown({
  title,
  items,
  tone,
  onItemClick,
}: {
  title: string
  items: CashFlowBreakdown[]
  tone: 'green' | 'red'
  onItemClick: (categoryId: string) => void
}) {
  const { isDark } = useTheme()
  const palette = getCashFlowPalette(isDark)
  const fillColor = tone === 'green' ? palette.incomeBreakdownFill : palette.expenseBreakdownFill
  const fillHoverColor = tone === 'green' ? palette.incomeBreakdownHoverFill : palette.expenseBreakdownHoverFill
  const total = items.reduce((sum, item) => sum + Math.abs(item.total), 0)
  const sorted = [...items].sort((a, b) => Math.abs(b.total) - Math.abs(a.total))

  return (
    <Card as="section" overflow="visible">
      <div className="border-b border-neutral-100 p-5"><h2 className="text-xl font-bold">{title}</h2></div>
      <div className="space-y-3 p-5">
        {sorted.map((item) => {
          const percent = total ? (Math.abs(item.total) / total) * 100 : 0
          const barStyle = {
            width: `${Math.max(2, percent)}%`,
            ['--bar-fill' as string]: fillColor,
            ['--bar-hover-fill' as string]: fillHoverColor,
          }
          return (
            <button
              className="group relative w-full overflow-hidden rounded-xl bg-neutral-50 p-3 text-left"
              key={item.category.id}
              onClick={() => onItemClick(item.category.id)}
              type="button"
            >
              <div className="absolute inset-y-0 left-0 [background-color:var(--bar-fill)] group-hover:[background-color:var(--bar-hover-fill)]" style={barStyle} />
              <div className="relative flex justify-between gap-4">
                <span>{item.category.emoji} {item.category.name}</span>
                <span className="font-semibold">{formatCurrency(Math.abs(item.total))} ({percent.toFixed(1)}%)</span>
              </div>
            </button>
          )
        })}
      </div>
    </Card>
  )
}
