import { useState } from 'react'
import { CollapsibleFilterSection } from '../common/CollapsibleFilterSection'
import { FilterDateRangeInputs } from '../common/FilterChip'
import { FilterRadioList } from '../common/FilterCheckboxList'
import { MobileFilterDropdown } from '../common/MobileFilterDropdown'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { OwnerFilterSection } from './OwnerFilterDropdown'
import { cashFlowPresetHint, cashFlowRangeSummary, selectedCashFlowPreset, type CashFlowDatePreset, type CashFlowDatePresetId, type LocalDateRange } from './cashFlowStats'

export interface CashFlowPendingFilter extends LocalDateRange { ownerIds: string[] }

export function CashFlowMobileFilters({ defaultRange, now, ownerIds, presets, range, onApply, onClose }: {
  defaultRange: LocalDateRange
  now: Date
  ownerIds: string[]
  presets: ReadonlyArray<CashFlowDatePreset>
  range: LocalDateRange
  onApply: (pending: CashFlowPendingFilter) => void
  onClose: () => void
}) {
  const [pending, setPending] = useState<CashFlowPendingFilter>({ ...range, ownerIds })
  const [dateOpen, setDateOpen] = useState(true)
  const dateFiltered = pending.dateFrom !== defaultRange.dateFrom || pending.dateTo !== defaultRange.dateTo
  const selectedPreset = selectedCashFlowPreset(presets, pending, now)

  function selectPreset(id: CashFlowDatePresetId | 'CUSTOM') {
    const preset = presets.find((option) => option.id === id)
    if (!preset) return
    setPending((current) => ({ ...current, ...preset.range(now) }))
    setDateOpen(false)
  }

  return (
    <MobileFilterDropdown
      footer={<MobileFilterFooter primaryLabel="Apply" onPrimary={() => onApply(pending)} />}
      labelledBy="cash-flow-filters-title"
      onClear={() => setPending({ ...defaultRange, ownerIds: [] })}
      onClose={onClose}
    >
      <CollapsibleFilterSection active={dateFiltered} expanded={dateOpen} label="Date range" summary={dateFiltered ? cashFlowRangeSummary(presets, pending, now) : 'Default'} onToggle={() => setDateOpen((open) => !open)}>
        <FilterRadioList
          options={presets.map((preset) => ({ id: preset.id, label: preset.label, ariaLabel: preset.label, trailing: cashFlowPresetHint(preset, now) }))}
          selectedId={selectedPreset?.id ?? 'CUSTOM'}
          onChange={selectPreset}
        />
        <FilterDateRangeInputs dateFrom={pending.dateFrom} dateTo={pending.dateTo} onChange={(next) => setPending((current) => ({ ...current, dateFrom: next.dateFrom ?? current.dateFrom, dateTo: next.dateTo ?? current.dateTo }))} />
      </CollapsibleFilterSection>
      <OwnerFilterSection onChange={(ids) => setPending((current) => ({ ...current, ownerIds: ids }))} selectedOwners={pending.ownerIds} />
    </MobileFilterDropdown>
  )
}
