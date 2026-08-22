import { TrendingDown, TrendingUp } from 'lucide-react'
import type { NetWorthReport } from '../../types/graphql'
import { formatCurrency, formatPercentChange, formatSignedCurrency } from '../../utils/currency'
import { displayAmount } from './amountDisplay'

// Mobile "Household Wealth" summary card: current net worth, change over the
// selected range, and the assets/liabilities split.
export function NetWorthHero({
  amountsHidden,
  changePct,
  changeUSD,
  report,
}: {
  amountsHidden: boolean
  changePct: number
  changeUSD: number
  report: NetWorthReport
}) {
  const positive = changeUSD >= 0
  const TrendIcon = positive ? TrendingUp : TrendingDown

  return (
    <section className="rounded-[2rem] border border-neutral-200 bg-gradient-to-br from-white to-emerald-50/60 p-5 shadow-sm dark:border-neutral-800 dark:from-neutral-900 dark:to-emerald-950/30 dark:shadow-none lg:hidden lg:p-7">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-brand-600 dark:text-brand-400">Household Wealth</p>
      <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-neutral-950 dark:text-neutral-100 lg:text-5xl">{displayAmount(amountsHidden, formatCurrency(report.currentNetWorthUSD))}</h1>
          <p className="mt-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">{report.asOfDate ? `As of ${report.asOfDate}` : 'No asset snapshot yet'}</p>
          <p className={`mt-2 flex items-center gap-2 text-sm font-semibold ${positive ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}`}>
            <TrendIcon className="h-4 w-4" />
            {displayAmount(amountsHidden, formatSignedCurrency(changeUSD))} · {formatPercentChange(changePct)} over selected range
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl bg-white/70 p-3 dark:bg-neutral-900/50">
            <p className="text-neutral-500 dark:text-neutral-400">Assets</p>
            <p className="font-bold text-neutral-950 dark:text-neutral-100">{displayAmount(amountsHidden, formatCurrency(report.currentAssetsUSD))}</p>
          </div>
          <div className="rounded-2xl bg-white/70 p-3 dark:bg-neutral-900/50">
            <p className="text-neutral-500 dark:text-neutral-400">Liabilities</p>
            <p className="font-bold text-neutral-950 dark:text-neutral-100">{displayAmount(amountsHidden, formatSignedCurrency(-report.currentLiabilitiesUSD))}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
