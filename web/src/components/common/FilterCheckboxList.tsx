import clsx from 'clsx'
import type { ReactNode } from 'react'
import { nextGroupSelectedIds, nextSelectedIds } from '../../utils/selection'
import { checkboxClass } from './FormControls'

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
    <div>
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

export function FilterRadioList<T extends string>({ options, selectedId, onChange }: { options: Array<FilterCheckboxOption & { id: T }>; selectedId: T; onChange: (id: T) => void }) {
  return (
    <div role="radiogroup">
      {options.map((option) => (
        <button
          aria-checked={selectedId === option.id}
          aria-label={option.ariaLabel}
          className={clsx(filterRowClassName, selectedId === option.id ? 'text-text-1' : 'text-text-2')}
          key={option.id}
          onClick={() => onChange(option.id)}
          role="radio"
          type="button"
        >
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {option.trailing ? <span className={filterCheckboxTrailingClassName}>{option.trailing}</span> : null}
          {selectedId === option.id ? <span aria-hidden className="h-2 w-2 rounded-full bg-brand-600" /> : null}
        </button>
      ))}
    </div>
  )
}

export function GroupedFilterCheckboxList({ groups, selectedIds, onChange }: GroupedFilterCheckboxListProps) {
  return (
    <div>
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
            <div className="pl-6">
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
    <label className={clsx(filterRowClassName, 'cursor-pointer text-text-1')}>
      <input
        aria-label={option.ariaLabel}
        checked={checked}
        className={clsx(checkboxClass, 'h-[18px] w-[18px]')}
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

const filterRowClassName = 'flex min-h-11 w-full items-center gap-3 rounded-md px-2 text-left text-sm transition-colors [@media(hover:hover)]:hover:bg-raised'
const filterCheckboxLabelClassName = 'block truncate'
const filterCheckboxDescriptionClassName = 'mt-0.5 block text-xs text-text-muted'
const filterCheckboxTrailingClassName = 'shrink-0 text-xs text-text-muted'
