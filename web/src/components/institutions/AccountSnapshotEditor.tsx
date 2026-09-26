import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useQuery } from 'urql'
import { ACCOUNT_SNAPSHOT_QUERY } from '../../graphql/queries'
import type { Account, AccountSnapshot, AccountSnapshotInput } from '../../types/graphql'
import { formatSignedCurrency } from '../../utils/currency'
import { Button } from '../common/Button'
import { SnapshotHistorySection } from './SnapshotHistorySection'
import { SnapshotLinesFields } from './SnapshotLinesFields'
import { useSnapshotEditorResources } from './useSnapshotEditorResources'
import { useSnapshotHistory } from './useSnapshotHistory'
import { snapshotToLines, type SnapshotLine } from './accountSnapshotLines'

interface Props {
  account: Account
  onAccountUpdate: (account: Account) => void
}

type EditorMode = 'view' | 'editing' | 'saving'

export function AccountSnapshotEditor({ account, onAccountUpdate }: Props) {
  const resources = useSnapshotEditorResources(account)
  const { balanceOnly, canManageManualHoldings, canReadAssets, canWriteWealth, liabilityBalance } = resources
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
  const showAddHolding = canManageManualHoldings && canReadAssets && isEditing
  const showRemoveHolding = canManageManualHoldings && isEditing
  const snapshotSectionTitle = account.type === 'INVESTMENT' ? 'Holdings' : 'Balance'
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
    const saved = await resources.saveLines(snapshot, lines)
    if (saved.error) {
      setSaveError(saved.error)
      setMode('editing')
      return
    }
    if (saved.snapshot) {
      setSnapshot(saved.snapshot)
      setSelectedDate(saved.snapshot.date)
      setLines(snapshotToLines(saved.snapshot))
      history.applySavedSnapshot(saved.snapshot)
    }
    onAccountUpdate(saved.account ?? account)
    setDirty(false)
    setMode('view')
  }

  return (
    <section className="mt-4 space-y-4 border-t border-border pt-4" aria-label="Balance snapshot editor">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <input
            aria-label="Snapshot date"
            className="w-36 rounded-xl border border-border-strong bg-surface text-text-1 dark:bg-bg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-raised disabled:text-text-3"
            disabled={isSaving}
            onChange={(e) => handleDateChange(e.target.value)}
            type="date"
            value={selectedDate}
          />
          <div className="flex items-center gap-2">
            <div className="text-right text-sm font-semibold text-text-1">{snapshotNetContribution}</div>
            {canWriteWealth && mode === 'view' ? (
              <button
                className="rounded-xl border border-border px-3 py-2 text-sm font-semibold text-text-2 hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!snapshot || isLoadingSnapshot}
                onClick={() => setMode('editing')}
                type="button"
              >
                Edit
              </button>
            ) : null}
          </div>
        </div>

        {queryInput !== null && result.error ? <p className="text-sm text-negative">Could not load snapshot: {result.error.message}</p> : null}
        {saveError ? <p className="text-sm text-negative">Could not save snapshot: {saveError}</p> : null}
        {isLoadingSnapshot && !snapshot ? <p className="text-sm text-text-3">Loading snapshot...</p> : null}
        {!isLoadingSnapshot && !snapshot ? (
          <div className="rounded-xl border border-dashed border-border bg-surface-2 px-3 py-3 text-sm text-text-3">
            No snapshot for this day.
          </div>
        ) : null}

        {snapshot ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text-2">{snapshotSectionTitle}</h3>
              {snapshot.flagged ? <span className="rounded-full bg-warning/[0.15] px-2 py-0.5 text-xs font-semibold text-warning">Flagged</span> : null}
            </div>
            <SnapshotLinesFields
              balanceOnly={balanceOnly}
              controlsDisabled={controlsDisabled}
              displayBalanceUSD={displayBalanceUSD}
              liabilityBalance={liabilityBalance}
              lines={lines}
              onChangeLines={changeLines}
              resources={resources}
              showAddHolding={showAddHolding}
              showRemoveHolding={showRemoveHolding}
            />
          </div>
        ) : null}

        {mode !== 'view' ? (
          <div className="flex justify-end gap-2 border-t border-border pt-3">
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
