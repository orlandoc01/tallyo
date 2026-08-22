import { useState, type ReactNode } from 'react'
import type { AssetType } from '../../types/graphql'
import { CollapsibleFilterSection } from '../common/CollapsibleFilterSection'
import { FilterCheckboxList } from '../common/FilterCheckboxList'
import { FilterDropdownShell } from '../common/FilterDropdownShell'
import { ToggleSwitch } from '../common/ToggleSwitch'

const assetTypeFilters: Array<{ label: string, value: AssetType | 'ALL' }> = [
  { label: 'All', value: 'ALL' },
  { label: 'Currency', value: 'CURRENCY' },
  { label: 'Security', value: 'SECURITY' },
  { label: 'Crypto', value: 'CRYPTO' },
  { label: 'Real estate', value: 'REAL_ESTATE' },
  { label: 'Other', value: 'OTHER' },
]

export function AssetFiltersDropdown({ assetTypeFilter, includeHistorical, buttonAriaLabel, buttonClassName, buttonContent, onAssetTypeChange, onClear, onIncludeHistoricalChange }: {
  assetTypeFilter: AssetType | 'ALL'
  includeHistorical: boolean
  buttonAriaLabel?: string
  buttonClassName?: string
  buttonContent?: ReactNode
  onAssetTypeChange: (assetType: AssetType | 'ALL') => void
  onClear: () => void
  onIncludeHistoricalChange: (includeHistorical: boolean) => void
}) {
  const [assetTypeOpen, setAssetTypeOpen] = useState(false)
  const activeFilterCount = (assetTypeFilter === 'ALL' ? 0 : 1) + (includeHistorical ? 1 : 0)
  const selectedAssetType = assetTypeFilters.find((filter) => filter.value === assetTypeFilter)?.label ?? 'All'

  return (
    <FilterDropdownShell
      activeFilterCount={activeFilterCount}
      buttonAriaLabel={buttonAriaLabel}
      buttonClassName={buttonClassName}
      buttonContent={buttonContent}
      panelClassName="absolute right-0 z-20 mt-2 w-[min(20rem,calc(100vw-1rem))] rounded-2xl border border-neutral-200 bg-white p-4 shadow-card"
      onClear={onClear}
    >
      <div className="space-y-4">
        <AssetFilterToggle checked={includeHistorical} label="Include historical assets" onChange={onIncludeHistoricalChange} />
        <CollapsibleFilterSection active={assetTypeFilter !== 'ALL'} expanded={assetTypeOpen} label="Asset type" summary={selectedAssetType} onToggle={() => setAssetTypeOpen((current) => !current)}>
          <FilterCheckboxList
            options={assetTypeFilters.map((filter) => ({
              id: filter.value,
              label: filter.label,
              ariaLabel: filter.label,
              description: filter.value === 'ALL' ? 'Show every asset type' : `Only ${filter.label.toLowerCase()} assets`,
            }))}
            selectedIds={[assetTypeFilter]}
            selectionMode="single"
            onChange={(ids) => onAssetTypeChange((ids[0] ?? 'ALL') as AssetType | 'ALL')}
          />
        </CollapsibleFilterSection>
      </div>
    </FilterDropdownShell>
  )
}

function AssetFilterToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 px-3 py-3">
      <span className="text-sm font-medium text-neutral-700">{label}</span>
      <ToggleSwitch checked={checked} label={label} onChange={onChange} />
    </div>
  )
}
