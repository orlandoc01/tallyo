import { useState } from 'react'
import type { Tag, TransactionsFilter } from '../../types/graphql'
import { CollapsibleFilterSection } from '../common/CollapsibleFilterSection'
import { FilterCheckboxList } from '../common/FilterCheckboxList'
import { TextField } from '../common/FormControls'

interface FilterSectionProps {
  active: boolean
  expanded: boolean
  filter: TransactionsFilter
  onChange: (filter: TransactionsFilter) => void
  onToggle: () => void
}

export function TagsFilterSection({ active, expanded, filter, onChange, onToggle, tags }: FilterSectionProps & { tags: Tag[] }) {
  const [tagSearch, setTagSearch] = useState('')
  const selectedTagIds = filter.tagIds ?? []
  const visibleTags = tags.filter((tag) => tag.name.toLowerCase().includes(tagSearch.toLowerCase()))

  return (
    <CollapsibleFilterSection active={active} expanded={expanded} label="Tags" onToggle={onToggle}>
      <div className="max-h-56 overflow-auto rounded-xl border border-neutral-100 p-2">
        <TextField className="mb-3" label="Tag search" onChange={setTagSearch} placeholder="Search tags" value={tagSearch} />
        <FilterCheckboxList
          options={[{ id: 'untagged', label: 'Untagged', ariaLabel: 'Untagged' }]}
          selectedIds={filter.untagged === true ? ['untagged'] : []}
          onChange={(ids) => onChange({ ...filter, untagged: ids.includes('untagged') || undefined, tagIds: undefined })}
        />
        <FilterCheckboxList
          options={visibleTags.map((tag) => ({
            id: tag.id,
            label: tag.name,
            ariaLabel: tag.name,
            leading: <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} />,
          }))}
          selectedIds={selectedTagIds}
          onChange={(tagIds) => onChange({ ...filter, tagIds: tagIds.length ? tagIds : undefined, untagged: undefined })}
        />
        {visibleTags.length === 0 ? <div className="text-sm text-neutral-500">No tags found.</div> : null}
      </div>
    </CollapsibleFilterSection>
  )
}

export function TextFilterSection({ active, expanded, filter, onChange, onToggle }: FilterSectionProps) {
  return (
    <CollapsibleFilterSection active={active} expanded={expanded} label="Text" onToggle={onToggle}>
      <div className="space-y-3">
        <TextField label="Merchant" labelClassName="text-xs text-neutral-500" onChange={(merchantPrefix) => onChange({ ...filter, merchantPrefix: merchantPrefix || undefined })} placeholder="Merchant name" value={filter.merchantPrefix ?? ''} />
        <TextField label="Original" labelClassName="text-xs text-neutral-500" onChange={(originalPrefix) => onChange({ ...filter, originalPrefix: originalPrefix || undefined })} placeholder="Original name" value={filter.originalPrefix ?? ''} />
      </div>
    </CollapsibleFilterSection>
  )
}

export function AmountFilterSection({ active, expanded, filter, onChange, onToggle }: FilterSectionProps) {
  return (
    <CollapsibleFilterSection active={active} expanded={expanded} label="Amount" onToggle={onToggle}>
      <div className="space-y-3">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
          <AmountInput
            hideLabel
            label="Amount min"
            onChange={(amountMin) => onChange({ ...filter, amountMin })}
            placeholder="Min"
            value={filter.amountMin ?? undefined}
          />
          <span className="text-sm text-neutral-400">-</span>
          <AmountInput
            hideLabel
            label="Amount max"
            onChange={(amountMax) => onChange({ ...filter, amountMax })}
            placeholder="Max"
            value={filter.amountMax ?? undefined}
          />
        </div>
        <AmountInput
          label="Exact amount"
          onChange={(exactAmount) => onChange({ ...filter, exactAmount })}
          value={filter.exactAmount ?? undefined}
        />
      </div>
    </CollapsibleFilterSection>
  )
}

function AmountInput({ hideLabel = false, label, onChange, placeholder, value }: { hideLabel?: boolean; label: string; onChange: (value: number | undefined) => void; placeholder?: string; value?: number }) {
  return (
    <TextField hideLabel={hideLabel} label={label} onChange={(raw) => {
      const parsed = Number(raw)
      onChange(raw === '' || !Number.isFinite(parsed) ? undefined : parsed)
    }} placeholder={placeholder} step="0.01" type="number" value={value ?? ''} />
  )
}
