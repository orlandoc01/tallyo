import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useMutation, useQuery } from 'urql'
import { CHANGE_ACCOUNT_SNAPSHOT_MUTATION } from '../../graphql/mutations'
import { ACCOUNT_SNAPSHOT_QUERY, ASSETS_QUERY } from '../../graphql/queries'
import { usePermissions } from '../../hooks/usePermissions'
import type { Account, AccountSnapshot, AccountSnapshotInput, AssetList, AssetsInput } from '../../types/graphql'
import { formatCurrency, formatSignedCurrency } from '../../utils/currency'
import { Button } from '../common/Button'
import { SnapshotAssetPicker } from './SnapshotAssetPicker'
import { SnapshotHistorySection } from './SnapshotHistorySection'
import { SnapshotHoldingRow } from './SnapshotHoldingRow'
import { useSnapshotHistory } from './useSnapshotHistory'
import { assetToSnapshotLine, linesWithBalance, snapshotToLines, updateLineCash, updateLineQuantity, updateLineValue, USD_ASSET_ID, type SnapshotLine } from './accountSnapshotLines'

interface Props {
  account: Account
  onAccountUpdate: (account: Account) => void
}

type EditorMode = 'view' | 'editing' | 'saving'

export function AccountSnapshotEditor({ account, onAccountUpdate }: Props) {
  const { canRead, canWrite } = usePermissions()
  const canReadAssets = canRead('assets')
  const canWriteWealth = canWrite('wealth')
  const liabilityBalance = account.type === 'CREDIT' || account.type === 'LOAN'
  const balanceOnly = account.manual && (account.type === 'CREDIT' || account.type === 'LOAN' || account.type === 'DEPOSITORY')
  const [mode, setMode] = useState<EditorMode>('view')
  const [dirty, setDirty] = useState(false)
  const [selectedDate, setSelectedDate] = useState(account.latestSnapshot?.date ?? '')
  const [snapshot, setSnapshot] = useState<AccountSnapshot | null>(account.latestSnapshot ?? null)
  const [lines, setLines] = useState<SnapshotLine[]>(() => account.latestSnapshot ? snapshotToLines(account.latestSnapshot) : [])
  const [queryInput, setQueryInput] = useState<AccountSnapshotInput | null>(() => account.latestSnapshot ? null : { accountId: account.id })
  const [saveError, setSaveError] = useState<string | null>(null)
  const [result] = useQuery<{ accountSnapshot: AccountSnapshot | null }, { input: AccountSnapshotInput }>({
    query: ACCOUNT_SNAPSHOT_QUERY,
    variables: { input: queryInput ?? { accountId: account.id } },
    pause: queryInput === null,
  })
  const [assetsResult] = useQuery<{ assets: AssetList }, { input: AssetsInput }>({
    query: ASSETS_QUERY,
    variables: { input: { includeHistorical: true } },
    pause: !account.manual || !canReadAssets || !canWriteWealth,
  })
  const [, changeSnapshot] = useMutation(CHANGE_ACCOUNT_SNAPSHOT_MUTATION)
  const history = useSnapshotHistory(account, (snapshots) => {
    showKnownSnapshot(snapshots[0]?.date ?? '', snapshots[0] ?? null)
  })

  useEffect(() => {
    if (queryInput === null) return
    if (result.fetching || result.error || !result.data) return
    const nextSnapshot = result.data.accountSnapshot ?? null
    setSnapshot(nextSnapshot)
    if (nextSnapshot) {
      setSelectedDate(nextSnapshot.date)
      setLines(snapshotToLines(nextSnapshot))
    } else {
      setLines([])
    }
    setDirty(false)
  }, [queryInput, result.data, result.error, result.fetching])

  const isSaving = mode === 'saving'
  const isEditing = mode === 'editing'
  const controlsDisabled = !isEditing || isSaving
  const isLoadingSnapshot = queryInput !== null && result.fetching
  const linesBalanceUSD = lines.reduce((sum, line) => sum + line.valueUSD, 0)
  const balanceUSD = lines.length > 0 ? linesBalanceUSD : snapshot?.balanceUSD ?? 0
  const displayBalanceUSD = balanceOnly && liabilityBalance ? Math.abs(balanceUSD) : balanceUSD
  const snapshotHadHoldings = (snapshot?.holdings?.length ?? 0) > 0
  const saveDisabled = isSaving || !dirty || !snapshot || (lines.length === 0 && !snapshotHadHoldings)
  const canManageManualHoldings = account.manual && canWriteWealth
  const showAddHolding = canManageManualHoldings && canReadAssets && isEditing
  const showRemoveHolding = canManageManualHoldings && isEditing
  const selectedAssetIds = new Set(lines.map((line) => line.asset.id))
  const snapshotSectionTitle = account.type === 'INVESTMENT' ? 'Holdings' : 'Balance'
  const usdAsset = assetsResult.data?.assets.items.find((asset) =>
    asset.id === USD_ASSET_ID || (asset.assetType === 'CURRENCY' && asset.identifier === 'USD'))
  const snapshotNetContribution = snapshot ? formatSignedCurrency(snapshot.netContributionUSD) : '-'

  function handleDateChange(date: string) {
    const latestSnapshot = account.latestSnapshot ?? null
    setSelectedDate(date)
    setSaveError(null)
    setDirty(false)
    setMode('view')
    if (!date) {
      setSnapshot(null)
      setLines([])
      setQueryInput(null)
      return
    }
    if (latestSnapshot?.date === date) {
      setSnapshot(latestSnapshot)
      setLines(snapshotToLines(latestSnapshot))
      setQueryInput(null)
      return
    }
    setSnapshot(null)
    setLines([])
    setQueryInput({ accountId: account.id, date })
  }

  function handleHistoryChange(date: string) {
    if (Object.prototype.hasOwnProperty.call(history.snapshotsByDate, date)) {
      showKnownSnapshot(date, history.snapshotsByDate[date])
      return
    }
    handleDateChange(date)
  }

  function showKnownSnapshot(date: string, nextSnapshot: AccountSnapshot | null) {
    setSelectedDate(date)
    setSaveError(null)
    setDirty(false)
    setMode('view')
    setSnapshot(nextSnapshot)
    setLines(nextSnapshot ? snapshotToLines(nextSnapshot) : [])
    setQueryInput(null)
  }

  function changeLines(nextLines: SnapshotLine[]) {
    setLines(nextLines)
    setDirty(true)
  }

  async function handleSave() {
    if (!snapshot || saveDisabled) return
    setMode('saving')
    setSaveError(null)
    const mutationResult = await changeSnapshot({
      input: {
        snapshotId: snapshot.id,
        holdings: lines.map((line) => ({
          assetId: line.asset.id,
          quantity: line.quantity,
          valueUSD: line.valueUSD,
        })),
      },
    })
    if (mutationResult.error) {
      setSaveError(mutationResult.error.message)
      setMode('editing')
      return
    }
    const updated = mutationResult.data?.changeAccountSnapshot as { snapshot?: AccountSnapshot; account?: Account } | undefined
    if (updated?.snapshot) {
      const updatedSnapshot = updated.snapshot
      setSnapshot(updatedSnapshot)
      setSelectedDate(updatedSnapshot.date)
      setLines(snapshotToLines(updatedSnapshot))
      history.applySavedSnapshot(updatedSnapshot)
    }
    onAccountUpdate(updated?.account ?? account)
    setDirty(false)
    setMode('view')
  }

  return (
    <section className="mt-4 space-y-4 border-t border-neutral-100 pt-4" aria-label="Balance snapshot editor">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <input
            aria-label="Snapshot date"
            className="w-36 rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-neutral-50 disabled:text-neutral-500"
            disabled={isSaving}
            onChange={(e) => handleDateChange(e.target.value)}
            type="date"
            value={selectedDate}
          />
          <div className="flex items-center gap-2">
            <div className="text-right text-sm font-semibold text-neutral-900">{snapshotNetContribution}</div>
            {canWriteWealth && mode === 'view' ? (
              <button
                className="rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!snapshot || isLoadingSnapshot}
                onClick={() => setMode('editing')}
                type="button"
              >
                Edit
              </button>
            ) : null}
          </div>
        </div>

        {queryInput !== null && result.error ? <p className="text-sm text-red-600">Could not load snapshot: {result.error.message}</p> : null}
        {saveError ? <p className="text-sm text-red-600">Could not save snapshot: {saveError}</p> : null}
        {isLoadingSnapshot && !snapshot ? <p className="text-sm text-neutral-500">Loading snapshot...</p> : null}
        {!isLoadingSnapshot && !snapshot ? (
          <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-500">
            No snapshot for this day.
          </div>
        ) : null}

        {snapshot ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-700">{snapshotSectionTitle}</h3>
              {snapshot.flagged ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300">Flagged</span> : null}
            </div>
            {balanceOnly ? null : lines.map((line) => (
              <SnapshotHoldingRow
                disabled={controlsDisabled}
                key={line.asset.id}
                line={line}
                onCashChange={(assetID, value) => changeLines(updateLineCash(lines, assetID, value))}
                onQuantityChange={(assetID, value) => changeLines(updateLineQuantity(lines, assetID, value))}
                onValueChange={(assetID, value) => changeLines(updateLineValue(lines, assetID, value))}
                onRemove={showRemoveHolding ? (assetID) => changeLines(lines.filter((current) => current.asset.id !== assetID)) : undefined}
              />
            ))}
            {!balanceOnly && showAddHolding ? (
              <SnapshotAssetPicker
                assets={assetsResult.data?.assets.items ?? []}
                errorMessage={assetsResult.error?.message ?? null}
                excludedAssetIds={selectedAssetIds}
                fetching={assetsResult.fetching}
                onSelect={(asset) => {
                  if (!lines.some((line) => line.asset.id === asset.id)) changeLines([...lines, assetToSnapshotLine(asset)])
                }}
              />
            ) : null}
            {balanceOnly || lines.length === 0 ? (
              <div className="flex items-center justify-between rounded-xl border border-neutral-100 px-3 py-2 text-sm">
                <div className="font-medium text-neutral-900">Balance</div>
                {balanceOnly && !controlsDisabled ? (
                  <input
                    aria-label="Snapshot balance"
                    className="w-32 rounded-lg border border-neutral-200 px-2 py-1.5 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-500"
                    disabled={lines.length === 0 && !usdAsset}
                    onChange={(e) => changeLines(linesWithBalance(lines, usdAsset, e.target.value, liabilityBalance))}
                    step="any"
                    type="number"
                    value={liabilityBalance ? lines[0]?.valueText.replace(/^-/, '') ?? String(displayBalanceUSD) : lines[0]?.valueText ?? String(displayBalanceUSD)}
                  />
                ) : (
                  <div aria-label="Snapshot balance" className="font-semibold tabular-nums text-neutral-800">{formatCurrency(displayBalanceUSD)}</div>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {mode !== 'view' ? (
          <div className="flex justify-end gap-2 border-t border-neutral-100 pt-3">
            <Button
              disabled={isSaving}
              onClick={() => {
                setMode('view')
                setDirty(false)
                if (snapshot) {
                  setLines(snapshotToLines(snapshot))
                }
              }}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button className="gap-2" disabled={saveDisabled} onClick={handleSave} type="button">
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        ) : null}
      </div>

      <SnapshotHistorySection history={history} onSelectDate={handleHistoryChange} selectedDate={selectedDate} />
    </section>
  )
}
