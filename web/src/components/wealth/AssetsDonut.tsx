import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Tooltip } from 'recharts'
import { DonutChart } from '../common/DonutChart'
import { AssetBreakdownViewToggle } from './AssetBreakdownViewToggle'
import { displayAmount } from './amountDisplay'
import { useBreakdownSelection } from './useBreakdownSelection'
import { formatCurrency, formatCurrencyCompact, formatSignedCurrency } from '../../utils/currency'
import { accountBalanceUSD } from '../../utils/accounts'
import type { AssetClassifier, ClassifierBreakdown, LiabilityBreakdown } from '../../types/graphql'

const colors = ['#059669', '#2563eb', '#7c3aed', '#f59e0b', '#06b6d4', '#dc2626']

interface AssetsDonutProps {
  breakdown: ClassifierBreakdown[]
  liabilityBreakdown: LiabilityBreakdown[]
  selectedClassifier?: AssetClassifier | null
  totalAssets: number
  totalLiabilities: number
  view: 'ASSETS' | 'LIABILITIES'
  onSelectClassifier?: (classifier: AssetClassifier | null) => void
  selectedLiabilityCategory?: string | null
  onSelectLiabilityCategory?: (category: string | null) => void
  onViewChange?: (view: 'ASSETS' | 'LIABILITIES') => void
  amountsHidden?: boolean
  expandableLegend?: boolean
  canReadHoldings?: boolean
}

export function AssetsDonut({ breakdown, liabilityBreakdown, selectedClassifier, totalAssets, totalLiabilities, view, onSelectClassifier, selectedLiabilityCategory, onSelectLiabilityCategory, onViewChange, amountsHidden = false, expandableLegend = false, canReadHoldings = true }: AssetsDonutProps) {
  const showLiabilities = view === 'LIABILITIES'
  const { handleClassifierClick, handleLiabilityClick, open, toggleOpen } = useBreakdownSelection({
    onSelectClassifier,
    onSelectLiabilityCategory,
    selectedClassifier,
    selectedLiabilityCategory,
  })

  return (
    <section className="rounded-3xl border border-neutral-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-neutral-500">Break Down</h2>
        <AssetBreakdownViewToggle onViewChange={onViewChange} view={view} />
      </div>
      {showLiabilities ? (
        <>
          <BreakdownDonut
            amountsHidden={amountsHidden}
            centerLabel="Liabilities"
            onSliceClick={onSelectLiabilityCategory ? (key) => handleLiabilityClick(key) : undefined}
            slices={liabilityBreakdown.map((entry, index) => ({
              key: entry.category,
              label: entry.label,
              value: entry.valueUSD,
              color: colors[index % colors.length],
              selected: selectedLiabilityCategory === entry.category,
            }))}
            total={totalLiabilities}
          />
          <div className="mt-4 grid gap-2 text-sm">
            {liabilityBreakdown.map((item, index) => (
              <BreakdownLegendRow
                color={colors[index % colors.length]}
                expandable={expandableLegend && item.accounts.length > 0}
                key={item.category}
                label={item.label}
                onClick={() => handleLiabilityClick(item.category)}
                onToggleExpand={() => toggleOpen(item.category)}
                open={open[item.category] ?? false}
                percent={item.percentOfLiabilities}
                selected={selectedLiabilityCategory === item.category}
              >
                {item.accounts.map((account) => (
                  <div className="flex min-w-0 items-start justify-between gap-3" key={account.id}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100" title={account.name}>{account.name}</p>
                      <p className="truncate text-xs text-neutral-500 dark:text-neutral-400" title={account.owner.name}>{account.owner.name}</p>
                    </div>
                    <p className="max-w-[45%] shrink-0 truncate text-sm font-semibold text-neutral-950 dark:text-neutral-50">{displayAmount(amountsHidden, formatSignedCurrency(-(accountBalanceUSD(account) ?? 0)))}</p>
                  </div>
                ))}
              </BreakdownLegendRow>
            ))}
          </div>
        </>
      ) : (
        <>
          <BreakdownDonut
            amountsHidden={amountsHidden}
            centerLabel="Assets"
            onSliceClick={onSelectClassifier ? (key) => {
              const item = breakdown.find((entry) => entry.classifier === key)
              if (item) handleClassifierClick(item.classifier)
            } : undefined}
            slices={breakdown.map((entry, index) => ({
              key: entry.classifier,
              label: entry.label,
              value: entry.valueUSD,
              color: colors[index % colors.length],
              selected: selectedClassifier === entry.classifier,
            }))}
            total={totalAssets}
          />
          <div className="mt-4 grid gap-2 text-sm">
            {breakdown.map((item, index) => (
              <BreakdownLegendRow
                color={colors[index % colors.length]}
                expandable={expandableLegend && canReadHoldings}
                key={item.classifier}
                label={item.label}
                onClick={() => handleClassifierClick(item.classifier)}
                onToggleExpand={() => toggleOpen(item.classifier)}
                open={open[item.classifier] ?? false}
                percent={item.percentOfAssets}
                selected={selectedClassifier === item.classifier}
              >
                {item.holdings.map((holding) => {
                  const assetLabel = holding.asset.identifier
                  const assetTitle = holding.asset.name ?? holding.asset.identifier
                  const accountNames = (holding.holdings ?? []).map((row) => row.account.name).join(', ')
                  return (
                    <div className="flex min-w-0 items-start justify-between gap-3" key={holding.asset.id}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-100" title={assetTitle}>{assetLabel}</p>
                        <p className="whitespace-normal break-words text-xs text-neutral-500 dark:text-neutral-400" title={accountNames || undefined}>{accountNames}</p>
                      </div>
                      <p className="max-w-[45%] shrink-0 truncate text-sm font-semibold text-neutral-950 dark:text-neutral-50">{displayAmount(amountsHidden, formatCurrency(holding.valueUSD))}</p>
                    </div>
                  )
                })}
              </BreakdownLegendRow>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

function BreakdownDonut({
  amountsHidden,
  centerLabel,
  onSliceClick,
  slices,
  total,
}: {
  amountsHidden: boolean
  centerLabel: string
  onSliceClick?: (key: string) => void
  slices: Array<{ key: string; label: string; value: number; color: string; selected: boolean }>
  total: number
}) {
  return (
    <div className="relative mt-4 h-64">
      <DonutChart
        innerRadius="68%"
        onSliceClick={onSliceClick ? (slice) => onSliceClick(slice.key) : undefined}
        outerRadius="92%"
        paddingAngle={3}
        slices={slices}
      >
        <Tooltip formatter={(value, name) => [displayAmount(amountsHidden, formatCurrency(Number(value))), String(name)]} />
      </DonutChart>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs uppercase tracking-[0.18em] text-neutral-400">{centerLabel}</span>
        <span className="text-2xl font-bold text-neutral-950">{displayAmount(amountsHidden, formatCurrencyCompact(total))}</span>
      </div>
    </div>
  )
}

function BreakdownLegendRow({
  children,
  color,
  expandable,
  label,
  onClick,
  onToggleExpand,
  open,
  percent,
  selected,
}: {
  children: ReactNode
  color: string
  expandable: boolean
  label: string
  onClick: () => void
  onToggleExpand: () => void
  open: boolean
  percent: number
  selected: boolean
}) {
  return (
    <div className={`min-w-0 rounded-2xl ${selected ? 'bg-neutral-100 dark:bg-neutral-800' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800/70'}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        <button className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left transition" onClick={onClick} type="button">
          <span className="flex min-w-0 items-center gap-2 font-medium text-neutral-700">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            <span className="truncate">{label}</span>
          </span>
          <span className="shrink-0 text-neutral-500">{percent.toFixed(1)}%</span>
        </button>
        {expandable ? (
          <button
            aria-label={`${open ? 'Collapse' : 'Expand'} ${label}`}
            className="rounded-lg p-1 text-neutral-400 transition hover:bg-white dark:hover:bg-neutral-700"
            onClick={onToggleExpand}
            type="button"
          >
            <ChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} />
          </button>
        ) : null}
      </div>
      {expandable && open ? (
        <div className="min-w-0 space-y-3 border-t border-neutral-200 px-3 pb-3 pt-3 dark:border-neutral-700">
          {children}
        </div>
      ) : null}
    </div>
  )
}
