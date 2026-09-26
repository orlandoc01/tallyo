import type { Asset } from '../../types/graphql'
import { formatCurrency } from '../../utils/currency'
import { SnapshotAssetPicker } from './SnapshotAssetPicker'
import { SnapshotHoldingRow } from './SnapshotHoldingRow'
import { assetToSnapshotLine, linesWithBalance, updateLineCash, updateLineQuantity, updateLineValue, type SnapshotLine } from './accountSnapshotLines'
import type { useSnapshotEditorResources } from './useSnapshotEditorResources'

export function SnapshotLinesFields({ balanceOnly, controlsDisabled, displayBalanceUSD, lines, liabilityBalance, onChangeLines, resources, showAddHolding, showRemoveHolding }: {
  balanceOnly: boolean
  controlsDisabled: boolean
  displayBalanceUSD: number
  liabilityBalance: boolean
  lines: SnapshotLine[]
  onChangeLines: (lines: SnapshotLine[]) => void
  resources: Pick<ReturnType<typeof useSnapshotEditorResources>, 'assets' | 'assetsError' | 'assetsFetching' | 'usdAsset'>
  showAddHolding: boolean
  showRemoveHolding: boolean
}) {
  const selectedAssetIds = new Set(lines.map((line) => line.asset.id))
  const usdAsset: Asset | undefined = resources.usdAsset
  return (
    <>
      {balanceOnly ? null : lines.map((line) => (
        <SnapshotHoldingRow
          disabled={controlsDisabled}
          key={line.asset.id}
          line={line}
          onCashChange={(assetID, value) => onChangeLines(updateLineCash(lines, assetID, value))}
          onQuantityChange={(assetID, value) => onChangeLines(updateLineQuantity(lines, assetID, value))}
          onValueChange={(assetID, value) => onChangeLines(updateLineValue(lines, assetID, value))}
          onRemove={showRemoveHolding ? (assetID) => onChangeLines(lines.filter((current) => current.asset.id !== assetID)) : undefined}
        />
      ))}
      {!balanceOnly && showAddHolding ? (
        <SnapshotAssetPicker
          assets={resources.assets}
          errorMessage={resources.assetsError}
          excludedAssetIds={selectedAssetIds}
          fetching={resources.assetsFetching}
          onSelect={(asset) => {
            if (!lines.some((line) => line.asset.id === asset.id)) onChangeLines([...lines, assetToSnapshotLine(asset)])
          }}
        />
      ) : null}
      {balanceOnly || lines.length === 0 ? (
        <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
          <div className="font-medium text-text-1">Balance</div>
          {balanceOnly && !controlsDisabled ? (
            <input
              aria-label="Snapshot balance"
              className="w-32 rounded-xl border border-border-strong bg-surface text-text-1 dark:bg-bg px-2 py-1.5 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500"
              disabled={lines.length === 0 && !usdAsset}
              onChange={(e) => onChangeLines(linesWithBalance(lines, usdAsset, e.target.value, liabilityBalance))}
              step="any"
              type="number"
              value={liabilityBalance ? lines[0]?.valueText.replace(/^-/, '') ?? String(displayBalanceUSD) : lines[0]?.valueText ?? String(displayBalanceUSD)}
            />
          ) : (
            <div aria-label="Snapshot balance" className="font-semibold tabular-nums text-text-1">{formatCurrency(displayBalanceUSD)}</div>
          )}
        </div>
      ) : null}
    </>
  )
}
