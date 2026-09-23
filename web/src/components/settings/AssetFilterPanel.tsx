import { useState } from 'react'
import { CollapsibleFilterSection } from '../common/CollapsibleFilterSection'
import { FilterDropdown, FilterOptionRow, FilterPresetRow } from '../common/FilterChip'
import { FilterRadioList } from '../common/FilterCheckboxList'
import { FilterPanel } from '../common/FilterPanel'
import { MobileFilterDropdown } from '../common/MobileFilterDropdown'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { ToggleSwitch } from '../common/ToggleSwitch'
import { ASSET_TYPE_OPTIONS, assetTypeLabel, countActiveAssetFilters, type AssetFilterValues, type AssetTypeFilter } from './assetFilters'

interface AssetFilterProps {
  filters: AssetFilterValues
  onChange: (filters: AssetFilterValues) => void
  onClear: () => void
}

export function AssetFilterPanel({ caretRight, filters, onChange, onClear }: AssetFilterProps & { caretRight?: number }) {
  const typeActive = filters.assetType !== 'ALL'
  return (
    <FilterPanel caretRight={caretRight} clearable={countActiveAssetFilters(filters) > 0} onClear={onClear}>
      <FilterDropdown active={typeActive} label="Asset type" summary={typeActive ? assetTypeLabel(filters.assetType) : undefined} width={200}>
        {(close) => (
          <div aria-label="Asset type" role="radiogroup">
            {ASSET_TYPE_OPTIONS.map((option) => (
              <FilterPresetRow key={option.value} label={option.label} onSelect={() => { onChange({ ...filters, assetType: option.value }); close() }} selected={option.value === filters.assetType} />
            ))}
          </div>
        )}
      </FilterDropdown>
      <FilterDropdown active={filters.includeHistorical} label="Historical" summary={filters.includeHistorical ? 'Included' : undefined} width={240}>
        <FilterOptionRow ariaLabel="Include historical assets" label="Include historical assets" onToggle={() => onChange({ ...filters, includeHistorical: !filters.includeHistorical })} selected={filters.includeHistorical} />
      </FilterDropdown>
    </FilterPanel>
  )
}

export function AssetMobileFilters({ filters, onChange, onClear, onClose }: AssetFilterProps & { onClose: () => void }) {
  const [typeOpen, setTypeOpen] = useState(false)
  return (
    <MobileFilterDropdown footer={<MobileFilterFooter onPrimary={onClose} />} labelledBy="asset-filters-title" onClear={onClear} onClose={onClose}>
      <label className="flex min-h-[52px] items-center justify-between gap-3 border-t border-border text-sm font-medium text-text-1">
        Include historical assets
        <ToggleSwitch checked={filters.includeHistorical} label="Include historical assets" onChange={(includeHistorical) => onChange({ ...filters, includeHistorical })} size="lg" />
      </label>
      <CollapsibleFilterSection active={filters.assetType !== 'ALL'} expanded={typeOpen} label="Asset type" summary={assetTypeLabel(filters.assetType)} onToggle={() => setTypeOpen((current) => !current)}>
        <FilterRadioList<AssetTypeFilter>
          options={ASSET_TYPE_OPTIONS.map((option) => ({ id: option.value, label: option.label, ariaLabel: option.label }))}
          selectedId={filters.assetType}
          onChange={(assetType) => { onChange({ ...filters, assetType }); setTypeOpen(false) }}
        />
      </CollapsibleFilterSection>
    </MobileFilterDropdown>
  )
}
