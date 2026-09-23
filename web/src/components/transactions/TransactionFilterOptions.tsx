import { useState } from 'react'
import type { CategoryGroup, Tag, TransactionSort, TransactionsFilter } from '../../types/graphql'
import { allSelected, nextGroupSelectedIds, toggleSelectedIds } from '../../utils/selection'
import { FilterAmountInputs, FilterDateRangeInputs, FilterGroupRow, FilterOptionRow, FilterPresetPills, FilterPresetRow, FilterRadioRow } from '../common/FilterChip'
import { SearchInput, TextField } from '../common/FormControls'
import { CategoryTag } from '../common/Tag'
import { localDateRangeFromDateTimeRange, localDateRangeToUtcDateTimeRange } from '../../utils/dates'
import { AMOUNT_MODES, AMOUNT_PRESETS, DATE_PRESETS, SORT_OPTIONS, amountMode, datePresetHint, datePresetRange, selectedAmountPreset, selectedDatePreset, sortFromId, sortId, withAmountMode } from './transactionFilterPresets'

interface FilterFieldProps {
  filter: TransactionsFilter
  onChange: (filter: TransactionsFilter) => void
}

export function DateFilterOptions({ filter, now, onChange, onPresetSelect }: FilterFieldProps & { now: Date; onPresetSelect?: () => void }) {
  const selected = selectedDatePreset(filter, now)
  const { dateFrom, dateTo } = localDateRangeFromDateTimeRange(filter.datetimeRange ?? undefined)
  return (
    <>
      <div aria-label="Date range" role="radiogroup">
        {DATE_PRESETS.map((preset) => (
          <FilterPresetRow hint={datePresetHint(preset.id, now)} key={preset.id} label={preset.label} onSelect={() => { onChange({ ...filter, datetimeRange: datePresetRange(preset.id, now) }); onPresetSelect?.() }} selected={preset.id === selected} />
        ))}
      </div>
      <FilterDateRangeInputs dateFrom={dateFrom} dateTo={dateTo} onChange={(next) => onChange({ ...filter, datetimeRange: localDateRangeToUtcDateTimeRange(next.dateFrom, next.dateTo) })} />
    </>
  )
}

export function CategoryFilterOptions({ categoryGroups, filter, onChange }: FilterFieldProps & { categoryGroups: CategoryGroup[] }) {
  const [search, setSearch] = useState('')
  const normalized = search.trim().toLowerCase()
  const selectedIds = filter.categoryIds ?? []
  const allIds = categoryGroups.flatMap((group) => group.categories.map((category) => category.id))
  const everySelected = allSelected(selectedIds, allIds)
  const groups = categoryGroups
    .map((group) => ({ ...group, allIds: group.categories.map((category) => category.id), categories: group.categories.filter((category) => !normalized || category.name.toLowerCase().includes(normalized) || group.name.toLowerCase().includes(normalized)) }))
    .filter((group) => group.categories.length > 0)

  function change(categoryIds: string[]) {
    onChange({ ...filter, categoryIds: categoryIds.length ? categoryIds : undefined })
  }

  return (
    <>
      <SearchInput ariaLabel="Category search" className="mb-1" onChange={setSearch} placeholder="Search" value={search} />
      <div className="max-h-72 overflow-y-auto">
        <FilterOptionRow ariaLabel="Select all categories" label="Select all" onToggle={() => change(nextGroupSelectedIds(selectedIds, allIds, !everySelected))} selected={everySelected} />
        {groups.map((group) => {
          const groupSelected = allSelected(selectedIds, group.allIds)
          return (
            <div key={group.id}>
              <FilterGroupRow ariaLabel={group.name} indeterminate={!groupSelected && group.allIds.some((id) => selectedIds.includes(id))} label={group.name} onToggle={() => change(nextGroupSelectedIds(selectedIds, group.allIds, !groupSelected))} selected={groupSelected} />
              {group.categories.map((category) => (
                <FilterOptionRow ariaLabel={category.name} key={category.id} label={<CategoryTag category={category} />} onToggle={() => change(toggleSelectedIds(selectedIds, [category.id]))} selected={selectedIds.includes(category.id)} />
              ))}
            </div>
          )
        })}
        {groups.length === 0 ? <p className="px-2 py-2 text-[13px] text-text-muted">No categories found.</p> : null}
      </div>
    </>
  )
}

export function TagFilterOptions({ filter, onChange, tags }: FilterFieldProps & { tags: Tag[] }) {
  const [search, setSearch] = useState('')
  const normalized = search.trim().toLowerCase()
  const selectedIds = filter.tagIds ?? []
  const visibleTags = tags.filter((tag) => tag.name.toLowerCase().includes(normalized))
  return (
    <>
      {tags.length > 8 ? <SearchInput ariaLabel="Tag search" className="mb-1" onChange={setSearch} placeholder="Search tags" value={search} /> : null}
      <div className="max-h-72 overflow-y-auto">
        <FilterOptionRow ariaLabel="Untagged" label="Untagged" onToggle={() => onChange({ ...filter, untagged: filter.untagged ? undefined : true, tagIds: undefined })} selected={filter.untagged === true} />
        {visibleTags.map((tag) => (
          <FilterOptionRow
            ariaLabel={tag.name}
            key={tag.id}
            label={tag.name}
            leading={<span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />}
            onToggle={() => { const tagIds = toggleSelectedIds(selectedIds, [tag.id]); onChange({ ...filter, tagIds: tagIds.length ? tagIds : undefined, untagged: undefined }) }}
            selected={selectedIds.includes(tag.id)}
          />
        ))}
        {visibleTags.length === 0 ? <p className="px-2 py-2 text-[13px] text-text-muted">No tags found.</p> : null}
      </div>
    </>
  )
}

export function AmountFilterOptions({ filter, onChange }: FilterFieldProps) {
  return (
    <>
      <FilterAmountInputs exact={filter.exactAmount ?? undefined} max={filter.amountMax ?? undefined} min={filter.amountMin ?? undefined} onChange={(next) => onChange({ ...filter, amountMin: next.min, amountMax: next.max, exactAmount: next.exact })} />
      <FilterPresetPills options={AMOUNT_PRESETS} selectedId={selectedAmountPreset(filter)} onSelect={(id) => onChange(AMOUNT_PRESETS.find((preset) => preset.id === id)!.apply(filter))} />
      <FilterRadioRow ariaLabel="Amount kind" options={AMOUNT_MODES} selectedId={amountMode(filter)} onSelect={(mode) => onChange(withAmountMode(filter, mode))} />
    </>
  )
}

export function SortOptions({ onSortChange, sort }: { onSortChange: (sort: TransactionSort) => void; sort: TransactionSort }) {
  return (
    <FilterRadioRow ariaLabel="Sort" layout="list" options={SORT_OPTIONS} selectedId={sortId(sort)} onSelect={(id) => onSortChange(sortFromId(id))} />
  )
}

export function TextFilterFields({ filter, onChange }: FilterFieldProps) {
  return (
    <div className="space-y-2 px-1">
      <TextField label="Merchant" onChange={(merchantPrefix) => onChange({ ...filter, merchantPrefix: merchantPrefix || undefined })} placeholder="Merchant name" value={filter.merchantPrefix ?? ''} />
      <TextField label="Original" onChange={(originalPrefix) => onChange({ ...filter, originalPrefix: originalPrefix || undefined })} placeholder="Original name" value={filter.originalPrefix ?? ''} />
    </div>
  )
}
