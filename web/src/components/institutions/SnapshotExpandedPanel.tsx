import clsx from 'clsx'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import type { Account, AccountSnapshot } from '../../types/graphql'
import { formatQuantity } from '../../utils/amount'
import { formatCurrency } from '../../utils/currency'
import { TickerChip } from '../common/Tag'
import {
  assetDisplayLabel, assetInputLabel, assetToSnapshotLine, isCash, isPriced, lineMeta, linesWithBalance, lineTicker, quantityUnit, snapshotToLines,
  updateLineCash, updateLineQuantity, updateLineValue, type SnapshotLine,
} from './accountSnapshotLines'
import { balanceOnlyLineLabel, formatSnapshotDay } from './accountValuation'
import { SnapshotInlineEditRow } from './SnapshotInlineEditRow'
import type { useSnapshotEditorResources } from './useSnapshotEditorResources'

const UNDO_MS = 6000

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
const DOTTED_CLASS = 'border-b border-dotted border-text-muted'

type EditField = 'quantity' | 'value'
type PanelState =
  | { kind: 'view' }
  | { kind: 'editing'; draft: SnapshotLine }
  | { kind: 'saving'; draft: SnapshotLine | null }

function HoldingLine({ label, meta, onEdit, quantityLabel, ticker, underline, valueUSD }: {
  label: string
  meta: string
  onEdit?: () => void
  quantityLabel?: string
  ticker: string
  underline: EditField
  valueUSD: number
}) {
  const editable = onEdit !== undefined
  const className = clsx('flex min-h-12 items-center gap-2.5 pl-[34px] pr-4', editable && 'w-full touch-manipulation text-left active:bg-raised')
  const content = (
    <>
      <TickerChip>{ticker}</TickerChip>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-text-1">{label}</span>
        <span className="block text-[11px] text-text-3">{meta}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[13px] tabular-nums text-text-1">
          <span className={clsx(editable && underline === 'value' && DOTTED_CLASS)}>{formatCurrency(valueUSD)}</span>
        </span>
        {quantityLabel ? (
          <span className="block text-[11px] tabular-nums text-text-3">
            <span className={clsx(editable && underline === 'quantity' && DOTTED_CLASS)}>{quantityLabel}</span>
          </span>
        ) : null}
      </span>
    </>
  )
  return onEdit
    ? <button aria-label={`Edit ${label}`} className={className} onClick={onEdit} type="button">{content}</button>
    : <div className={className}>{content}</div>
}

export function SnapshotExpandedPanel({ account, onSaved, onSaveError, resources, snapshot }: {
  account: Account
  onSaved: (snapshot: AccountSnapshot, account: Account | undefined) => void
  onSaveError: (message: string) => void
  resources: ReturnType<typeof useSnapshotEditorResources>
  snapshot: AccountSnapshot
}) {
  const [state, setState] = useState<PanelState>({ kind: 'view' })
  const [lines, setLines] = useState(() => snapshotToLines(snapshot))
  const [saveError, setSaveError] = useState<string | null>(null)
  const [undo, setUndo] = useState<{ lines: SnapshotLine[]; until: number } | null>(null)
  const linesRef = useRef(lines)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const pendingCountRef = useRef(0)
  const mountedRef = useRef(false)
  const { balanceOnly, canWriteWealth, liabilityBalance, usdAsset } = resources
  const single = balanceOnly || lines.length === 0
  const balanceUSD = lines.length > 0 ? lines.reduce((sum, line) => sum + line.valueUSD, 0) : snapshot.balanceUSD
  const displayBalanceUSD = balanceOnly && liabilityBalance ? Math.abs(balanceUSD) : balanceUSD
  const singleBase = lines[0] ?? (usdAsset ? assetToSnapshotLine(usdAsset) : undefined)
  const singleLine = singleBase && { ...singleBase, quantity: displayBalanceUSD, valueUSD: displayBalanceUSD }
  const draft = state.kind === 'view' ? null : state.draft

  function commitLines(next: SnapshotLine[]) {
    linesRef.current = next
    setLines(next)
  }

  function applyText(line: SnapshotLine, field: EditField, text: string) {
    if (field === 'quantity') return updateLineQuantity([line], line.asset.id, text)[0]
    if (single) return linesWithBalance([line], usdAsset, text, liabilityBalance)[0]
    return (isCash(line.asset) ? updateLineCash : updateLineValue)([line], line.asset.id, text)[0]
  }

  function startEdit(line: SnapshotLine) {
    if (state.kind === 'editing' && state.draft.asset.id !== line.asset.id) commit()
    setState({ kind: 'editing', draft: { ...line, quantityText: String(line.quantity ?? ''), valueText: line.valueUSD.toFixed(2) } })
  }

  function edit(field: EditField, text: string) {
    if (state.kind !== 'editing') return
    setState({ kind: 'editing', draft: applyText(state.draft, field, text) })
  }

  // Lines update optimistically at enqueue time and saves run one at a time, so a
  // later line's payload already carries the earlier line's value; the server's
  // snapshot is reconciled only once the last queued save settles.
  function enqueueSave(pending: SnapshotLine | null, nextLinesOf: (baseline: SnapshotLine[]) => SnapshotLine[]) {
    const baseline = linesRef.current
    const next = nextLinesOf(baseline)
    const undoLines = baseline.length > 0 ? baseline : linesWithBalance([], usdAsset, String(displayBalanceUSD), liabilityBalance)
    commitLines(next)
    setState({ kind: 'saving', draft: pending })
    setSaveError(null)
    pendingCountRef.current += 1
    inFlightRef.current = (inFlightRef.current ?? Promise.resolve()).catch(() => undefined).then(async () => {
      let saved: Awaited<ReturnType<typeof resources.saveLines>> | null = null
      let failure: string | null = null
      try {
        saved = await resources.saveLines(snapshot, next)
        if (saved.error) failure = saved.error
        else {
          if (saved.snapshot) onSaved(saved.snapshot, saved.account)
          setUndo(pending && undoLines.length > 0 ? { lines: undoLines, until: Date.now() + UNDO_MS } : null)
        }
      } catch (error) {
        failure = errorMessage(error)
      } finally {
        pendingCountRef.current -= 1
        const last = pendingCountRef.current === 0
        if (failure) {
          if (last) commitLines(baseline)
          const message = `${pending ? assetInputLabel(pending.asset) : 'snapshot'}: ${failure}`
          if (mountedRef.current) setSaveError(message)
          else onSaveError(message)
        } else if (last && saved?.snapshot) commitLines(snapshotToLines(saved.snapshot))
        const settled: PanelState = failure && pending ? { kind: 'editing', draft: pending } : { kind: 'view' }
        setState((current) => current.kind === 'saving' && current.draft === pending ? settled : current)
      }
    })
  }

  function commit() {
    if (state.kind !== 'editing') return
    const { draft: next } = state
    const committed = single ? singleLine : lines.find((line) => line.asset.id === next.asset.id)
    if (next.quantity === committed?.quantity && next.valueUSD === committed.valueUSD) return setState({ kind: 'view' })
    enqueueSave(next, (baseline) => balanceOnly || baseline.length === 0 ? [next] : baseline.map((line) => line.asset.id === next.asset.id ? next : line))
  }

  const commitOnOutsideTap = useEffectEvent((event: Event) => {
    if (!(event.target instanceof Element && event.target.closest('[data-snapshot-edit-row]'))) commit()
  })

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    if (pendingCountRef.current > 0) return
    const fromSnapshot = snapshotToLines(snapshot)
    linesRef.current = fromSnapshot
    setLines(fromSnapshot)
  }, [snapshot])

  useEffect(() => {
    if (state.kind !== 'editing') return
    document.addEventListener('pointerdown', commitOnOutsideTap, true)
    return () => document.removeEventListener('pointerdown', commitOnOutsideTap, true)
    // commitOnOutsideTap is an effect event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind])

  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), undo.until - Date.now())
    return () => clearTimeout(timer)
  }, [undo])

  function renderLine(line: SnapshotLine, label: string) {
    if (draft?.asset.id === line.asset.id) {
      return (
        <SnapshotInlineEditRow
          disabled={state.kind === 'saving'}
          key={line.asset.id}
          label={label}
          line={draft}
          onCommit={commit}
          onQuantityChange={(text) => edit('quantity', text)}
          onValueChange={(text) => edit('value', text)}
          quantityText={draft.quantityText}
          valueText={draft.valueText}
        />
      )
    }
    const priced = isPriced(line)
    return (
      <HoldingLine
        key={line.asset.id}
        label={label}
        meta={lineMeta(line)}
        onEdit={canWriteWealth ? () => startEdit(line) : undefined}
        quantityLabel={priced ? `${formatQuantity(line.quantity)} ${quantityUnit(line.asset)}` : undefined}
        ticker={lineTicker(line)}
        underline={priced ? 'quantity' : 'value'}
        valueUSD={line.valueUSD}
      />
    )
  }

  return (
    <div className="-mx-4 border-b border-border bg-bg-deep">
      <div className="flex justify-between pb-1 pl-[34px] pr-4 pt-2.5 text-[11px] text-text-3">
        <span>{single ? 'Balance' : 'Holdings'} on {formatSnapshotDay(snapshot.date)}</span>
        {undo && state.kind !== 'editing' ? (
          <span className="flex items-center gap-1.5 font-medium text-accent" role="status">
            <span aria-hidden>✓</span> Saved <span className="text-text-muted">·</span>
            <button className="underline underline-offset-2" disabled={state.kind === 'saving'} onClick={() => enqueueSave(null, () => undo.lines)} type="button">Undo</button>
          </span>
        ) : <span>{single ? 'Value' : 'Qty · Value'}</span>}
      </div>
      {single
        ? singleLine
          ? renderLine(singleLine, balanceOnlyLineLabel(account))
          : <HoldingLine label={balanceOnlyLineLabel(account)} meta="Cash" ticker="$" underline="value" valueUSD={displayBalanceUSD} />
        : lines.map((line) => renderLine(line, assetDisplayLabel(line.asset)))}
      {state.kind === 'editing'
        ? <p className="pb-2.5 pl-[34px] pr-4 pt-1.5 text-[11px] text-text-muted">Tap anywhere else to save. Undo appears afterwards.</p>
        : <div className="pb-1.5" />}
      {saveError ? <p className="px-4 pb-2 text-sm text-negative">Could not save {saveError}</p> : null}
    </div>
  )
}
