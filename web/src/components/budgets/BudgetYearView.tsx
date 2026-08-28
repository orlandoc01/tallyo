import { format, parse } from 'date-fns'
import { formatCurrency } from '../../utils/currency'
import type { BudgetReport, CategoryGroup } from '../../types/graphql'
import { Card } from '../common/FormControls'

export function BudgetYearView({ categoryGroups, history, year }: { categoryGroups: CategoryGroup[]; history: BudgetReport[]; year: string }) {
  const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
  const reportsByMonth = new Map(history.filter((report) => report.month.startsWith(`${year}-`)).map((report) => [report.month, report]))

  return (
    <Card as="section" className="dark:border-neutral-800 dark:bg-neutral-900" compact>
      <div className="border-b border-neutral-100 px-4 py-4 dark:border-neutral-800">
        <h2 className="text-lg font-semibold text-neutral-950 dark:text-neutral-50">{year} budget breakdown</h2>
        <p className="mt-1 text-sm text-neutral-500">Scroll sideways to compare each category across the year.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr className="bg-neutral-50 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:bg-neutral-950/50">
              <th className="sticky left-0 z-10 w-14 bg-neutral-50 px-2 py-3 text-center dark:bg-neutral-950/50 [@media_(orientation:landscape)_and_(min-width:640px)]:w-48 [@media_(orientation:landscape)_and_(min-width:640px)]:px-4 [@media_(orientation:landscape)_and_(min-width:640px)]:text-left">Category</th>
              {months.map((month) => (
                <th className="min-w-32 px-3 py-3 text-right" key={month}>{format(parse(month, 'yyyy-MM', new Date()), 'MMM')}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {categoryGroups.map((group) => (
              <BudgetYearGroup group={group} key={group.id} months={months} reportsByMonth={reportsByMonth} />
            ))}
            <tr className="bg-neutral-50/80 font-semibold dark:bg-neutral-950/40">
              <td className="sticky left-0 z-10 bg-neutral-50 px-4 py-3 text-neutral-900 dark:bg-neutral-950/50 dark:text-neutral-100">Net remaining</td>
              {months.map((month) => {
                const report = reportsByMonth.get(month)
                return (
                  <td className="bg-white px-3 py-3 text-right tabular-nums dark:bg-neutral-900" key={month}>
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
      <tr className="bg-neutral-50/70 dark:bg-neutral-950/30">
        <td className="sticky left-0 z-10 w-14 bg-neutral-50 px-2 py-1 text-center align-middle text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:bg-neutral-950/50 [@media_(orientation:landscape)_and_(min-width:640px)]:w-48 [@media_(orientation:landscape)_and_(min-width:640px)]:px-4 [@media_(orientation:landscape)_and_(min-width:640px)]:text-left">
          <BudgetYearLabel emoji={group.emoji} name={group.name} />
        </td>
        <td aria-hidden className="bg-white px-3 py-1 dark:bg-neutral-900" colSpan={months.length} />
      </tr>
      {group.categories.map((category) => (
        <tr className="align-top" key={category.id}>
          <td className="sticky left-0 z-10 w-14 bg-neutral-50 px-2 py-3 text-center align-middle font-medium text-neutral-900 dark:bg-neutral-950/50 dark:text-neutral-100 [@media_(orientation:landscape)_and_(min-width:640px)]:w-48 [@media_(orientation:landscape)_and_(min-width:640px)]:px-4 [@media_(orientation:landscape)_and_(min-width:640px)]:text-left">
            <BudgetYearLabel emoji={category.emoji} name={category.name} />
          </td>
          {months.map((month) => (
            <td className="bg-white px-3 py-3 text-right tabular-nums text-neutral-700 dark:bg-neutral-900 dark:text-neutral-200" key={month}>
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
        className="group/year-label relative rounded-xl px-1 py-0.5 text-base leading-none outline-none focus-visible:ring-2 focus-visible:ring-brand-500 [@media_(orientation:landscape)_and_(min-width:640px)]:pointer-events-none"
        title={name}
        type="button"
      >
        <span aria-hidden>{emoji}</span>
        <span className="pointer-events-none absolute left-full top-1/2 z-20 ml-2 -translate-y-1/2 whitespace-nowrap rounded-xl bg-neutral-950 px-2 py-1 text-xs font-semibold normal-case tracking-normal text-white opacity-0 shadow-lg transition group-active/year-label:opacity-100 group-focus-visible/year-label:opacity-100 dark:bg-neutral-100 dark:text-neutral-950">
          {name}
        </span>
      </button>
      <span className="hidden [@media_(orientation:landscape)_and_(min-width:640px)]:inline">{name}</span>
    </span>
  )
}

function BudgetYearCell({ categoryId, report }: { categoryId: string; report?: BudgetReport }) {
  if (!report) return <span className="text-neutral-400">-</span>
  for (const section of report.sections ?? []) {
    const line = section.lines.find((candidate) => candidate.category.id === categoryId)
    if (!line) continue
    return (
      <div className="space-y-0.5">
        <div className="font-semibold text-neutral-950 dark:text-neutral-50">{formatCurrency(line.budgeted)}</div>
        <div className="text-xs text-neutral-500">Actual {formatCurrency(line.actual)}</div>
      </div>
    )
  }
  return <span className="text-neutral-400">-</span>
}
