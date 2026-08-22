import { useState } from 'react'
import { useAuth } from '../../auth/useAuth'
import type { Account, CategoryGroup, Owner, Tag, TransactionsFilter, TransactionSort } from '../../types/graphql'
import { CollapsibleFilterSection } from '../common/CollapsibleFilterSection'
import { CompactDateRangeInputs } from '../reports/DateRangeSelector'
import { localDateRangeFromDateTimeRange, localDateRangeToUtcDateTimeRange } from '../../utils/dates'
import { categoryFilterOptions } from '../../utils/categoryFilter'
import { FilterCheckboxList } from '../common/FilterCheckboxList'
import { FilterListPicker } from '../common/FilterListPicker'
import { SearchableGroupedFilterCheckboxList } from '../common/SearchableFilterCheckboxList'
import { AccountCheckboxList } from './AccountCheckboxList'
import { CreateRuleModal } from './CreateRuleModal'
import { AmountFilterSection, TagsFilterSection, TextFilterSection } from './TransactionFilterSections'
import { ToggleRow } from './ToggleRow'

const sortOptions: Array<{ label: string; value: string; sort: TransactionSort }> = [
  { label: 'Newest first', value: 'DATE:DESC', sort: { field: 'DATE', direction: 'DESC' } },
  { label: 'Oldest first', value: 'DATE:ASC', sort: { field: 'DATE', direction: 'ASC' } },
  { label: 'Amount high to low', value: 'AMOUNT:DESC', sort: { field: 'AMOUNT', direction: 'DESC' } },
  { label: 'Amount low to high', value: 'AMOUNT:ASC', sort: { field: 'AMOUNT', direction: 'ASC' } },
]

type SectionKey = 'dateRange' | 'owner' | 'text' | 'amount' | 'accounts' | 'categories' | 'tags'

function getInitialCollapsedState(filter: TransactionsFilter): Record<SectionKey, boolean> {
  return {
    dateRange: !filter.datetimeRange,
    owner: !filter.ownerIds?.length,
    text: !filter.merchantPrefix && !filter.originalPrefix,
    amount: !filter.amountMin && !filter.amountMax && !filter.exactAmount,
    accounts: !filter.accountIds?.length,
    categories: !filter.categoryIds?.length,
    tags: !filter.tagIds?.length && !filter.untagged,
  }
}

export function TransactionFilters({
  accounts,
  categoryGroups,
  className = 'rounded-3xl border border-neutral-200 bg-white p-5 shadow-card',
  filter,
  onChange,
  onClear,
  onRuleCreated,
  onSortChange,
  owners,
  ownersFetching = false,
  showTitle = true,
  sort,
  tags = [],
}: {
  accounts: Account[]
  categoryGroups: CategoryGroup[]
  className?: string
  filter: TransactionsFilter
  onChange: (filter: TransactionsFilter) => void
  onClear?: () => void
  onRuleCreated?: () => void
  onSortChange?: (sort: TransactionSort) => void
  owners: Owner[]
  ownersFetching?: boolean
  showTitle?: boolean
  sort?: TransactionSort
  tags?: Tag[]
}) {
  const { hideOwners } = useAuth()
  const sortValue = sort ? `${sort.field}:${sort.direction}` : sortOptions[0].value
  const [isCreateRuleOpen, setIsCreateRuleOpen] = useState(false)
  const { dateFrom, dateTo } = localDateRangeFromDateTimeRange(filter.datetimeRange ?? undefined)
  const selectedCategoryIds = filter.categoryIds ?? []
  const activeSections = {
    dateRange: Boolean(filter.datetimeRange),
    owner: Boolean(filter.ownerIds?.length),
    text: Boolean(filter.merchantPrefix || filter.originalPrefix),
    amount: filter.amountMin != null || filter.amountMax != null || filter.exactAmount != null,
    accounts: Boolean(filter.accountIds?.length),
    categories: Boolean(filter.categoryIds?.length),
    tags: Boolean(filter.tagIds?.length || filter.untagged),
  }

  const [collapsedSections, setCollapsedSections] = useState<Record<SectionKey, boolean>>(() => getInitialCollapsedState(filter))

  function toggleSection(section: SectionKey) {
    const nextCollapsed = !collapsedSections[section]
    if (nextCollapsed) {
      const next = { ...filter }
      switch (section) {
        case 'dateRange':
          next.datetimeRange = undefined
          break
        case 'owner':
          next.ownerIds = undefined
          break
        case 'text':
          next.merchantPrefix = undefined
          next.originalPrefix = undefined
          break
        case 'amount':
          next.amountMin = undefined
          next.amountMax = undefined
          next.exactAmount = undefined
          break
        case 'accounts':
          next.accountIds = undefined
          break
        case 'categories':
          next.categoryIds = undefined
          break
        case 'tags':
          next.tagIds = undefined
          next.untagged = undefined
          break
      }
      onChange(next)
    }
    setCollapsedSections((prev) => ({ ...prev, [section]: nextCollapsed }))
  }

  function changeCategoryIds(categoryIds: string[]) {
    onChange({ ...filter, categoryIds: categoryIds.length ? categoryIds : undefined })
  }

  function handleClearFilters() {
    if (onClear) {
      onClear()
    } else {
      onChange({ isHidden: false })
    }
    setCollapsedSections({ dateRange: true, owner: true, text: true, amount: true, accounts: true, categories: true, tags: true })
  }

  return (
    <aside className={className}>
      {showTitle ? <h2 className="font-bold">Filters</h2> : null}
      <div className={showTitle ? 'mt-4 space-y-4' : 'space-y-4'}>
        {onSortChange ? (
          <label className="block text-sm font-medium">
            Sort
            <select
              className="mt-1 w-full rounded-xl border border-neutral-200 px-3 py-2"
              onChange={(event) => {
                const option = sortOptions.find((item) => item.value === event.target.value) ?? sortOptions[0]
                onSortChange(option.sort)
              }}
              value={sortValue}
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        ) : null}

        <CollapsibleFilterSection
          active={activeSections.dateRange}
          expanded={!collapsedSections.dateRange}
          label="Date range"
          onToggle={() => toggleSection('dateRange')}
        >
          <CompactDateRangeInputs
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChange={(next) => onChange({ ...filter, datetimeRange: localDateRangeToUtcDateTimeRange(next.dateFrom, next.dateTo) })}
          />
        </CollapsibleFilterSection>

        <CollapsibleFilterSection
          active={activeSections.categories}
          expanded={!collapsedSections.categories}
          label="Categories"
          onToggle={() => toggleSection('categories')}
        >
          <FilterListPicker>
            <SearchableGroupedFilterCheckboxList
              className="space-y-3"
              emptyMessage="No categories found."
              groups={categoryFilterOptions(categoryGroups)}
              optionsClassName="space-y-2.5"
              searchLabel="Category search"
              searchPlaceholder="Search categories"
              selectAllAriaLabel="Select all categories"
              selectedIds={selectedCategoryIds}
              onChange={changeCategoryIds}
            />
          </FilterListPicker>
        </CollapsibleFilterSection>

        <TagsFilterSection
          active={activeSections.tags}
          expanded={!collapsedSections.tags}
          filter={filter}
          onChange={onChange}
          onToggle={() => toggleSection('tags')}
          tags={tags}
        />

        <div className="-mx-3 rounded-2xl border border-neutral-200 bg-neutral-50 px-3 py-4">
          <div className="space-y-4">
            {!hideOwners ? (
              <CollapsibleFilterSection
                active={activeSections.owner}
                expanded={!collapsedSections.owner}
                label="Owner"
                onToggle={() => toggleSection('owner')}
              >
                {ownersFetching ? (
                  <div className="rounded-xl bg-white p-3 text-sm text-neutral-500">Loading owners...</div>
                ) : (
                  <FilterCheckboxList
                    options={owners.map((owner) => ({ id: owner.id, label: owner.name, ariaLabel: owner.name }))}
                    selectedIds={filter.ownerIds ?? []}
                    onChange={(ownerIds) => onChange({ ...filter, ownerIds: ownerIds.length ? ownerIds : undefined })}
                  />
                )}
              </CollapsibleFilterSection>
            ) : null}

            <TextFilterSection
              active={activeSections.text}
              expanded={!collapsedSections.text}
              filter={filter}
              onChange={onChange}
              onToggle={() => toggleSection('text')}
            />

            <AmountFilterSection
              active={activeSections.amount}
              expanded={!collapsedSections.amount}
              filter={filter}
              onChange={onChange}
              onToggle={() => toggleSection('amount')}
            />

            <CollapsibleFilterSection
              active={activeSections.accounts}
              expanded={!collapsedSections.accounts}
              label="Accounts"
              onToggle={() => toggleSection('accounts')}
            >
              <FilterListPicker>
                <AccountCheckboxList
                  accounts={accounts}
                  enableGroupToggle
                  onChange={(accountIds) => onChange({ ...filter, accountIds })}
                  selectedAccountIds={filter.accountIds ?? undefined}
                />
              </FilterListPicker>
            </CollapsibleFilterSection>

            <button
              className="w-full rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white"
              onClick={() => setIsCreateRuleOpen(true)}
              type="button"
            >
              Create Rule
            </button>
          </div>
        </div>

        <ToggleRow
          label="Include Hidden"
          onChange={(value) => onChange({ ...filter, isHidden: value ? undefined : false })}
          value={filter.isHidden !== false}
        />

        <button className="rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold" onClick={handleClearFilters} type="button">
          Clear filters
        </button>
      </div>
      {isCreateRuleOpen ? (
        <CreateRuleModal
          accounts={accounts}
          categoryGroups={categoryGroups}
          filter={filter}
          onClose={() => setIsCreateRuleOpen(false)}
          onCreated={onRuleCreated}
        />
      ) : null}
    </aside>
  )
}
