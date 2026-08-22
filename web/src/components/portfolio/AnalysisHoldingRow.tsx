import clsx from 'clsx'
import { OneLevelGroupRow } from '../common/OneLevelGroup'
import { displayAmount } from '../wealth/amountDisplay'
import type { AnalysisHolding, Asset } from '../../types/graphql'
import { formatCurrency } from '../../utils/currency'

export function AnalysisHoldingRow({ holding, amountsHidden, onEditAsset, rowClassName }: { holding: AnalysisHolding; amountsHidden: boolean; onEditAsset?: (asset: Asset) => void; rowClassName?: string }) {
  const className = clsx('flex min-w-0 items-start justify-between gap-4', rowClassName)
  const content = (
    <>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{holding.asset.name ?? holding.asset.identifier}</p>
        {holding.asset.name ? <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{holding.asset.identifier}</p> : null}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold text-neutral-950 dark:text-neutral-50">{displayAmount(amountsHidden, formatCurrency(holding.valueUSD))}</p>
        <p className="text-xs text-neutral-500 dark:text-neutral-400">{holding.percent.toFixed(1)}%</p>
      </div>
    </>
  )

  if (!onEditAsset) {
    return <OneLevelGroupRow className={className}>{content}</OneLevelGroupRow>
  }

  return (
    <OneLevelGroupRow
      ariaLabel={`Edit ${holding.asset.name ?? holding.asset.identifier}`}
      className={className}
      onClick={() => onEditAsset(holding.asset)}
    >
      {content}
    </OneLevelGroupRow>
  )
}
