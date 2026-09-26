import { useState } from 'react'
import type { Account, AccountSnapshot } from '../../types/graphql'
import { formatQuantity } from '../../utils/amount'
import { formatCurrency } from '../../utils/currency'
import { Button } from '../common/Button'
import { TickerChip } from '../common/Tag'
import { assetDisplayLabel, isCash, snapshotToLines, type SnapshotLine } from './accountSnapshotLines'
import { balanceOnlyLineLabel, formatSnapshotDay } from './accountValuation'
import { SnapshotLinesFields } from './SnapshotLinesFields'
import type { useSnapshotEditorResources } from './useSnapshotEditorResources'

type PanelMode = 'view' | 'editing' | 'saving'

function share(valueUSD: number, balanceUSD: number) {
  return balanceUSD === 0 ? '—' : `${((valueUSD / balanceUSD) * 100).toFixed(1)}%`
}

function HoldingLine({ label, meta, share: shareLabel, ticker, valueUSD }: { label: string; meta: string; share: string; ticker: string; valueUSD: number }) {
  return (
    <div className="flex min-h-11 items-center gap-2.5 pl-[34px] pr-4">
      <TickerChip>{ticker}</TickerChip>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-text-1">{label}</span>
        <span className="block text-[11px] text-text-3">{meta}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[13px] tabular-nums text-text-1">{formatCurrency(valueUSD)}</span>
        <span className="block text-[11px] tabular-nums text-text-3">{shareLabel}</span>
      </span>
    </div>
  )
}

function lineMeta(line: SnapshotLine) {
  if (isCash(line.asset)) return 'Cash'
  if (line.quantity == null) return 'Value only'
  return `${formatQuantity(line.quantity)} ${line.asset.assetType === 'SECURITY' ? 'shares' : 'units'}`
}

export function SnapshotExpandedPanel({ account, onSaved, resources, snapshot }: {
  account: Account
  onSaved: (snapshot: AccountSnapshot, account: Account | undefined) => void
  resources: ReturnType<typeof useSnapshotEditorResources>
  snapshot: AccountSnapshot
}) {
  const [mode, setMode] = useState<PanelMode>('view')
  const [lines, setLines] = useState(() => snapshotToLines(snapshot))
  const [dirty, setDirty] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { balanceOnly, canManageManualHoldings, canReadAssets, liabilityBalance } = resources
  const isEditing = mode === 'editing'
  const isSaving = mode === 'saving'
  const balanceUSD = lines.length > 0 ? lines.reduce((sum, line) => sum + line.valueUSD, 0) : snapshot.balanceUSD
  const displayBalanceUSD = balanceOnly && liabilityBalance ? Math.abs(balanceUSD) : balanceUSD
  const saveDisabled = isSaving || !dirty || (lines.length === 0 && (snapshot.holdings?.length ?? 0) === 0)

  function cancel() {
    setMode('view')
    setDirty(false)
    setLines(snapshotToLines(snapshot))
  }

  async function save() {
    setMode('saving')
    setSaveError(null)
    const saved = await resources.saveLines(snapshot, lines)
    if (saved.error) {
      setSaveError(saved.error)
      setMode('editing')
      return
    }
    if (saved.snapshot) {
      setLines(snapshotToLines(saved.snapshot))
      onSaved(saved.snapshot, saved.account)
    }
    setDirty(false)
    setMode('view')
  }

  return (
    <div className="-mx-4 border-b border-border bg-bg-deep">
      <div className="flex justify-between pb-1 pl-[34px] pr-4 pt-2.5 text-[11px] text-text-3">
        <span>Holdings on {formatSnapshotDay(snapshot.date)}</span>
        <span>Qty · Value</span>
      </div>
      {mode === 'view' ? (
        balanceOnly || lines.length === 0
          ? <HoldingLine label={balanceOnlyLineLabel(account)} meta="Cash" share="100%" ticker="$" valueUSD={displayBalanceUSD} />
          : lines.map((line) => (
            <HoldingLine
              key={line.asset.id}
              label={assetDisplayLabel(line.asset)}
              meta={lineMeta(line)}
              share={share(line.valueUSD, balanceUSD)}
              ticker={isCash(line.asset) ? '$' : line.asset.identifier}
              valueUSD={line.valueUSD}
            />
          ))
      ) : (
        <div className="space-y-2 px-4 pb-2">
          <SnapshotLinesFields
            balanceOnly={balanceOnly}
            controlsDisabled={!isEditing || isSaving}
            displayBalanceUSD={displayBalanceUSD}
            liabilityBalance={liabilityBalance}
            lines={lines}
            onChangeLines={(next) => { setLines(next); setDirty(true) }}
            resources={resources}
            showAddHolding={canManageManualHoldings && canReadAssets}
            showRemoveHolding={canManageManualHoldings}
          />
          {saveError ? <p className="text-sm text-negative">Could not save snapshot: {saveError}</p> : null}
        </div>
      )}
      {canManageManualHoldings ? (
        <div className="flex justify-end gap-2 px-4 pb-3 pt-1">
          {mode === 'view' ? <Button onClick={() => setMode('editing')} size="sm" variant="ghost">Edit</Button> : (
            <>
              <Button disabled={isSaving} onClick={cancel} size="sm" variant="secondary">Cancel</Button>
              <Button disabled={saveDisabled} onClick={() => { void save() }} size="sm">{isSaving ? 'Saving...' : 'Save'}</Button>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}
