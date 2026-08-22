import type { ReactNode } from 'react'

export interface FilterCheckboxOption {
  id: string
  label: ReactNode
  ariaLabel?: string
  searchText?: string
  description?: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
}

export interface FilterCheckboxGroup {
  id: string
  label: ReactNode
  ariaLabel?: string
  searchText?: string
  summary?: ReactNode
  options: FilterCheckboxOption[]
  allOptionIds?: string[]
}

interface FilterCheckboxListProps {
  options: FilterCheckboxOption[]
  selectedIds: string[]
  onChange: (selectedIds: string[]) => void
  selectionMode?: 'multi' | 'single'
}

interface GroupedFilterCheckboxListProps {
  groups: FilterCheckboxGroup[]
  selectedIds: string[]
  onChange: (selectedIds: string[]) => void
}

export function FilterCheckboxList({ options, selectedIds, onChange, selectionMode = 'multi' }: FilterCheckboxListProps) {
  return (
    <div className="space-y-1.5">
      {options.map((option) => (
        <FilterCheckboxRow
          checked={selectedIds.includes(option.id)}
          key={option.id}
          option={option}
          onChange={(checked) => onChange(nextSelectedIds(selectedIds, option.id, checked, selectionMode))}
        />
      ))}
    </div>
  )
}

export function GroupedFilterCheckboxList({ groups, selectedIds, onChange }: GroupedFilterCheckboxListProps) {
  return (
    <div className="space-y-2.5">
      {groups.map((group) => {
        const optionIds = group.options.map((option) => option.id)
        const groupOptionIds = group.allOptionIds ?? optionIds
        const checked = groupOptionIds.length > 0 && groupOptionIds.every((id) => selectedIds.includes(id))
        return (
          <div key={group.id}>
            <FilterCheckboxRow
              checked={checked}
              option={{ id: group.id, label: group.label, ariaLabel: group.ariaLabel, trailing: group.summary }}
              onChange={(nextChecked) => onChange(nextGroupSelectedIds(selectedIds, groupOptionIds, nextChecked))}
            />
            <div className="relative mt-1.5 space-y-1.5 pl-5 before:absolute before:bottom-2 before:left-2.5 before:top-0 before:w-px before:bg-neutral-200 dark:before:bg-neutral-800">
              {group.options.map((option) => (
                <FilterCheckboxRow
                  checked={selectedIds.includes(option.id)}
                  key={option.id}
                  option={option}
                  onChange={(checked) => onChange(nextSelectedIds(selectedIds, option.id, checked, 'multi'))}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FilterCheckboxRow({ option, checked, onChange }: { option: FilterCheckboxOption; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className={filterCheckboxRowClassName(checked)}>
      <input
        aria-label={option.ariaLabel}
        checked={checked}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      {option.leading}
      <span className="min-w-0 flex-1">
        <span className={filterCheckboxLabelClassName}>{option.label}</span>
        {option.description ? <span className={filterCheckboxDescriptionClassName}>{option.description}</span> : null}
      </span>
      {option.trailing ? <span className={filterCheckboxTrailingClassName}>{option.trailing}</span> : null}
    </label>
  )
}

function filterCheckboxRowClassName(checked: boolean) {
  return `relative flex cursor-pointer items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-sm transition-colors focus-within:outline-none focus-within:ring-1 focus-within:ring-inset focus-within:ring-brand-500/40 dark:focus-within:ring-brand-400/30 ${checked ? 'bg-brand-50 text-neutral-900 ring-1 ring-inset ring-brand-200 dark:bg-brand-500/10 dark:text-neutral-100 dark:ring-brand-400/30' : 'bg-transparent text-neutral-700 [@media(hover:hover)]:hover:border-brand-300 dark:text-neutral-200 dark:[@media(hover:hover)]:hover:border-brand-500/60'}`
}

const filterCheckboxLabelClassName = 'block truncate font-medium text-neutral-900 dark:text-neutral-100'
const filterCheckboxDescriptionClassName = 'mt-0.5 block text-xs text-neutral-500 dark:text-neutral-400'
const filterCheckboxTrailingClassName = 'shrink-0 text-[0.68rem] font-semibold text-neutral-500 dark:text-neutral-400'

function nextSelectedIds(selectedIds: string[], id: string, checked: boolean, selectionMode: 'multi' | 'single') {
  if (selectionMode === 'single') {
    return checked ? [id] : []
  }
  const selected = new Set(selectedIds)
  if (checked) selected.add(id)
  else selected.delete(id)
  return [...selected]
}

function nextGroupSelectedIds(selectedIds: string[], optionIds: string[], checked: boolean) {
  const selected = new Set(selectedIds)
  for (const id of optionIds) {
    if (checked) selected.add(id)
    else selected.delete(id)
  }
  return [...selected]
}
