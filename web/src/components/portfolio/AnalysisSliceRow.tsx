import clsx from 'clsx'
import { OneLevelGroup } from '../common/OneLevelGroup'
import { displayAmount } from '../wealth/amountDisplay'
import type { AnalysisSlice, Asset } from '../../types/graphql'
import { formatCurrency } from '../../utils/currency'
import { AnalysisHoldingRow } from './AnalysisHoldingRow'

interface AnalysisSliceRowProps {
  active: boolean
  color: string
  expanded: boolean
  amountsHidden: boolean
  slice: AnalysisSlice
  onFocusChange: (label: string | null) => void
  onEditAsset?: (asset: Asset) => void
  onToggle: () => void
}

export function AnalysisSliceRow({ active, color, expanded, amountsHidden, slice, onFocusChange, onEditAsset, onToggle }: AnalysisSliceRowProps) {
  const unclassified = slice.label === 'Unclassified'
  const childRowClassName = unclassified ? '!bg-slate-50/80 dark:!bg-slate-900/40' : undefined

  return (
    <OneLevelGroup
      className={clsx(
        'min-w-0 rounded-2xl',
        unclassified && 'border-dashed border-slate-300 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/40',
      )}
      expanded={expanded}
      expandButtonLabel={`${expanded ? 'Collapse' : 'Expand'} ${slice.label} holdings`}
      header={(
        <>
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-neutral-950 dark:text-neutral-100">{slice.label}</span>
            {unclassified ? <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">Analysis data not yet available for these holdings.</span> : null}
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-lg font-bold text-neutral-950 dark:text-neutral-50">{slice.percent.toFixed(1)}%</span>
            <span className="block text-xs font-medium text-neutral-500 dark:text-neutral-400">{displayAmount(amountsHidden, formatCurrency(slice.valueUSD))}</span>
          </span>
        </>
      )}
      headerClassName="px-2 py-1.5"
      headerActive={active}
      headerClickToggles
      headerPressed={active}
      onMouseEnter={() => onFocusChange(slice.label)}
      onMouseLeave={() => onFocusChange(expanded ? slice.label : null)}
      onToggle={onToggle}
    >
      {slice.holdings.map((holding) => (
        <AnalysisHoldingRow amountsHidden={amountsHidden} holding={holding} key={holding.asset.id} rowClassName={childRowClassName} onEditAsset={onEditAsset} />
      ))}
    </OneLevelGroup>
  )
}
