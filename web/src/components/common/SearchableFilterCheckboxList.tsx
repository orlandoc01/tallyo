import { useState, type ReactNode } from 'react'
import { FilterCheckboxList, GroupedFilterCheckboxList, type FilterCheckboxGroup } from './FilterCheckboxList'
import { TextField } from './FormControls'

interface SearchableGroupedFilterCheckboxListProps {
  groups: FilterCheckboxGroup[]
  selectedIds: string[]
  searchLabel: string
  searchPlaceholder: string
  selectAllAriaLabel: string
  emptyMessage: string
  onChange: (selectedIds: string[]) => void
  className?: string
  optionsClassName?: string
  groupSelection?: 'toggle' | 'heading'
  summary?: string
}

export function SearchableGroupedFilterCheckboxList({
  groups,
  selectedIds,
  searchLabel,
  searchPlaceholder,
  selectAllAriaLabel,
  emptyMessage,
  onChange,
  className = 'space-y-4',
  optionsClassName = 'space-y-3',
  groupSelection = 'toggle',
  summary,
}: SearchableGroupedFilterCheckboxListProps) {
  const [search, setSearch] = useState('')
  const groupsWithAllOptionIds = groups.map((group) => ({
    ...group,
    allOptionIds: group.options.map((option) => option.id),
  }))
  const visibleGroups = filterGroupsBySearch(groupsWithAllOptionIds, search)
  const allOptionIds = groupsWithAllOptionIds.flatMap((group) => group.allOptionIds)
  const allSelected = allOptionIds.length > 0 && allOptionIds.every((optionId) => selectedIds.includes(optionId))

  function toggleAll(checked: boolean) {
    const next = new Set(selectedIds)
    for (const optionId of allOptionIds) {
      if (checked) next.add(optionId)
      else next.delete(optionId)
    }
    onChange([...next])
  }

  return (
    <div className={className}>
      <TextField hideLabel label={searchLabel} onChange={setSearch} placeholder={searchPlaceholder} type="search" value={search} />
      {summary ? <div className="text-xs text-neutral-500">{summary}</div> : null}
      <div className={optionsClassName}>
        <FilterCheckboxList
          options={[{ id: 'select-all', label: 'Select all', ariaLabel: selectAllAriaLabel }]}
          selectedIds={allSelected ? ['select-all'] : []}
          onChange={(ids) => toggleAll(ids.includes('select-all'))}
        />
        {groupSelection === 'toggle' ? (
          <GroupedFilterCheckboxList groups={visibleGroups} selectedIds={selectedIds} onChange={onChange} />
        ) : (
          <FilterCheckboxGroups groups={visibleGroups} selectedIds={selectedIds} onChange={onChange} />
        )}
        {visibleGroups.length === 0 ? <div className="text-sm text-neutral-500">{emptyMessage}</div> : null}
      </div>
    </div>
  )
}

function FilterCheckboxGroups({ groups, selectedIds, onChange }: { groups: FilterCheckboxGroup[]; selectedIds: string[]; onChange: (selectedIds: string[]) => void }) {
  return (
    <>
      {groups.map((group) => (
        <div className="mb-3 last:mb-0" key={group.id}>
          <div className="mb-1 text-xs font-semibold text-neutral-500 dark:text-neutral-400">{group.label}</div>
          <FilterCheckboxList options={group.options} selectedIds={selectedIds} onChange={onChange} />
        </div>
      ))}
    </>
  )
}

function filterGroupsBySearch(groups: FilterCheckboxGroup[], search: string): FilterCheckboxGroup[] {
  const normalizedSearch = search.trim().toLowerCase()
  if (!normalizedSearch) return groups

  return groups
    .map((group) => {
      const groupMatches = searchableText(group).includes(normalizedSearch)
      return {
        ...group,
        options: groupMatches
          ? group.options
          : group.options.filter((option) => searchableText(option).includes(normalizedSearch)),
      }
    })
    .filter((group) => group.options.length > 0)
}

function searchableText(item: { label: ReactNode; ariaLabel?: string; searchText?: string }) {
  return [item.searchText, item.ariaLabel, primitiveNodeText(item.label)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function primitiveNodeText(node: ReactNode) {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return ''
}
