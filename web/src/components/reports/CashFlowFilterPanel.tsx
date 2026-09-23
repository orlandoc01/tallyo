import { useAuth } from '../../auth/useAuth'
import { useOwners } from '../../hooks/useEntityQueries'
import { toggleSelectedIds } from '../../utils/selection'
import { FilterDateRangeInputs, FilterDropdown, FilterPresetRow } from '../common/FilterChip'
import { ActiveFilterPill, ActiveFilterRow, FilterPanel } from '../common/FilterPanel'
import { OwnerIdsChip } from '../transactions/TransactionFilterChips'
import { cashFlowPresetHint, cashFlowRangeSummary, selectedCashFlowPreset, type CashFlowDatePreset, type LocalDateRange } from './cashFlowStats'

export function CashFlowFilterPanel({ caretRight, dateFiltered, now, ownerIds, presets, range, onClear, onOwnerChange, onRangeChange, onResetRange }: {
  caretRight?: number
  dateFiltered: boolean
  now: Date
  ownerIds: string[]
  presets: ReadonlyArray<CashFlowDatePreset>
  range: LocalDateRange
  onClear: () => void
  onOwnerChange: (ids: string[]) => void
  onRangeChange: (range: LocalDateRange) => void
  onResetRange: () => void
}) {
  const { hideOwners } = useAuth()
  const { owners } = useOwners()
  const showOwners = !hideOwners && owners.length > 1
  const selectedPreset = selectedCashFlowPreset(presets, range, now)
  const rangeSummary = cashFlowRangeSummary(presets, range, now)
  const ownerName = (id: string) => owners.find((owner) => owner.id === id)?.name
  const activeRow = dateFiltered || ownerIds.length > 0 ? (
    <ActiveFilterRow>
      {dateFiltered ? <ActiveFilterPill kind="Date" onRemove={onResetRange} value={rangeSummary} /> : null}
      {ownerIds.map((id) => <ActiveFilterPill key={id} kind="Owner" onRemove={() => onOwnerChange(toggleSelectedIds(ownerIds, [id]))} value={ownerName(id) ?? id} />)}
    </ActiveFilterRow>
  ) : undefined

  return (
    <FilterPanel activeRow={activeRow} caretRight={caretRight} clearable={dateFiltered || ownerIds.length > 0} onClear={onClear} variant="inset-2">
      <FilterDropdown active={dateFiltered} label="Date range" summary={dateFiltered ? rangeSummary : undefined} width={300}>
        {(close) => (
          <>
            <div aria-label="Date range presets" role="radiogroup">
              {presets.map((preset) => (
                <FilterPresetRow hint={cashFlowPresetHint(preset, now)} key={preset.id} label={preset.label} onSelect={() => { onRangeChange(preset.range(now)); close() }} selected={preset === selectedPreset} />
              ))}
            </div>
            <FilterDateRangeInputs dateFrom={range.dateFrom} dateTo={range.dateTo} onChange={(next) => onRangeChange({ dateFrom: next.dateFrom ?? range.dateFrom, dateTo: next.dateTo ?? range.dateTo })} />
          </>
        )}
      </FilterDropdown>
      {showOwners ? <OwnerIdsChip onChange={onOwnerChange} ownerIds={ownerIds} owners={owners} /> : null}
    </FilterPanel>
  )
}
