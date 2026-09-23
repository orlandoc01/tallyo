import { format, parse } from 'date-fns'
import { formatCurrency } from '../../utils/currency'
import type { BudgetReport, CategoryGroup } from '../../types/graphql'
import { Card } from '../common/FormControls'

const labelCellClass = 'sticky left-0 z-10 w-14 bg-surface-2 px-2 text-center [@media_(orientation:landscape)_and_(min-width:640px)]:w-48 [@media_(orientation:landscape)_and_(min-width:640px)]:px-4 [@media_(orientation:landscape)_and_(min-width:640px)]:text-left'

export function BudgetYearView({ categoryGroups, history, year }: { categoryGroups: CategoryGroup[]; history: BudgetReport[]; year: string }) {
  const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
  const reportsByMonth = new Map(history.filter((report) => report.month.startsWith(`${year}-`)).map((report) => [report.month, report]))

  return (
    <Card as="section">
      <div className="px-4 py-4">
        <h2 className="text-sm font-semibold text-text-1">{year} budget breakdown</h2>
        <p className="mt-1 text-[13px] text-text-muted">Scroll sideways to compare each category across the year.</p>
      </div>
      <div className="overflow-x-auto border-t border-border">
        <table className="min-w-[980px] w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="bg-surface-2 text-xs text-text-muted">
              <th className={`${labelCellClass} py-2 font-normal`}>Category</th>
              {months.map((month) => (
                <th className="min-w-32 px-3 py-2 text-right font-normal" key={month}>{format(parse(month, 'yyyy-MM', new Date()), 'MMM')}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categoryGroups.map((group) => (
              <BudgetYearGroup group={group} key={group.id} months={months} reportsByMonth={reportsByMonth} />
            ))}
            <tr className="font-semibold">
              <td className={`${labelCellClass} border-t border-border py-3 text-text-1`}>Net remaining</td>
              {months.map((month) => {
                const report = reportsByMonth.get(month)
                return (
                  <td className="border-t border-border bg-surface px-3 py-3 text-right tabular-nums text-text-1" key={month}>
                    {report ? formatCurrency(report.remainingBudgeted) : '-'}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function BudgetYearGroup({ group, months, reportsByMonth }: { group: CategoryGroup; months: string[]; reportsByMonth: Map<string, BudgetReport> }) {
  return (
    <>
      <tr>
        <td className={`${labelCellClass} border-t border-border py-1.5 align-middle text-xs font-semibold text-text-muted`}>
          <BudgetYearLabel emoji={group.emoji} name={group.name} />
        </td>
        <td aria-hidden className="border-t border-border bg-surface-2 px-3 py-1.5" colSpan={months.length} />
      </tr>
      {group.categories.map((category) => (
        <tr className="align-top" key={category.id}>
          <td className={`${labelCellClass} border-t border-border py-3 align-middle font-medium text-text-1`}>
            <BudgetYearLabel emoji={category.emoji} name={category.name} />
          </td>
          {months.map((month) => (
            <td className="border-t border-border bg-surface px-3 py-3 text-right tabular-nums text-text-2" key={month}>
              <BudgetYearCell categoryId={category.id} report={reportsByMonth.get(month)} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

function BudgetYearLabel({ emoji, name }: { emoji: string; name: string }) {
  return (
    <span className="relative inline-flex items-center gap-2">
      <button
        aria-label={name}
        className={`group/year-label relative rounded-md px-1 py-0.5 text-base leading-none outline-none focus-visible:ring-2 focus-visible:ring-brand-500/30 [@media_(orientation:landscape)_and_(min-width:640px)]:pointer-events-none`}
        title={name}
        type="button"
      >
        <span aria-hidden>{emoji}</span>
        <span className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border-strong bg-raised px-2 py-1 text-xs font-medium text-text-1 opacity-0 transition group-active/year-label:opacity-100 group-focus-visible/year-label:opacity-100">
          {name}
        </span>
      </button>
      <span className="hidden [@media_(orientation:landscape)_and_(min-width:640px)]:inline">{name}</span>
    </span>
  )
}

function BudgetYearCell({ categoryId, report }: { categoryId: string; report?: BudgetReport }) {
  if (!report) return <span className="text-text-faint">-</span>
  for (const section of report.sections ?? []) {
    const line = section.lines.find((candidate) => candidate.category.id === categoryId)
    if (!line) continue
    return (
      <div className="space-y-0.5">
        <div className="font-semibold text-text-1">{formatCurrency(line.budgeted)}</div>
        <div className="text-xs text-text-muted">Actual {formatCurrency(line.actual)}</div>
      </div>
    )
  }
  return <span className="text-text-faint">-</span>
}
