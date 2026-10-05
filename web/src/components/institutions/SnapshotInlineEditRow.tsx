import clsx from 'clsx'
import type { FocusEvent, KeyboardEvent } from 'react'
import { TickerChip } from '../common/Tag'
import { assetInputLabel, isPriced, lineMeta, lineTicker, quantityUnit, type SnapshotLine } from './accountSnapshotLines'

const FIELD_CLASS = 'flex h-9 items-center gap-1.5 rounded-md border border-border-strong bg-bg px-2.5 focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-600/20'
const INPUT_CLASS = 'min-w-0 flex-1 bg-transparent text-right text-[13px] tabular-nums text-text-1 focus:outline-none'

function selectAll(event: FocusEvent<HTMLInputElement>) {
  event.currentTarget.select()
}

export function SnapshotInlineEditRow({ disabled, label, line, onCommit, onQuantityChange, onValueChange, quantityText, valueText }: {
  disabled: boolean
  label: string
  line: SnapshotLine
  onCommit: () => void
  onQuantityChange: (text: string) => void
  onValueChange: (text: string) => void
  quantityText: string
  valueText: string
}) {
  const inputLabel = assetInputLabel(line.asset)
  const priced = isPriced(line)
  function commitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') onCommit()
  }
  return (
    <div className={clsx('flex items-center gap-2.5 bg-raised py-1.5 pl-[34px] pr-4', disabled && 'opacity-60')} data-snapshot-edit-row>
      <TickerChip>{lineTicker(line)}</TickerChip>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-text-1">{label}</span>
        <span className="block text-[11px] text-text-3">{lineMeta(line)}</span>
      </span>
      <div className="flex w-[150px] shrink-0 flex-col gap-1">
        {priced ? (
          <label className={FIELD_CLASS}>
            <input
              aria-label={`Quantity for ${inputLabel}`}
              autoFocus
              className={INPUT_CLASS}
              disabled={disabled}
              enterKeyHint="done"
              inputMode="decimal"
              onChange={(event) => onQuantityChange(event.target.value)}
              onFocus={selectAll}
              onKeyDown={commitOnEnter}
              type="text"
              value={quantityText}
            />
            <span className="shrink-0 text-[11px] text-text-3">{quantityUnit(line.asset)}</span>
          </label>
        ) : null}
        <label className={FIELD_CLASS}>
          <span className="text-xs text-text-3">$</span>
          <input
            aria-label={`Value for ${inputLabel}`}
            autoFocus={!priced}
            className={INPUT_CLASS}
            disabled={disabled}
            enterKeyHint="done"
            inputMode="decimal"
            onChange={(event) => onValueChange(event.target.value)}
            onFocus={selectAll}
            onKeyDown={commitOnEnter}
            type="text"
            value={valueText}
          />
        </label>
      </div>
    </div>
  )
}
