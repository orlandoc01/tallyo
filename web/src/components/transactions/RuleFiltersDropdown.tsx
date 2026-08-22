import { useState, type ReactNode } from 'react'
import type { Account } from '../../types/graphql'
import { CollapsibleFilterSection } from '../common/CollapsibleFilterSection'
import { filterSummary } from '../common/filterSummary'
import { FilterDropdownShell } from '../common/FilterDropdownShell'
import { AccountCheckboxList } from './AccountCheckboxList'
import { countActiveRuleFilters, type RuleFilterValues } from './ruleFilterUtils'

interface RuleFiltersDropdownProps {
  accounts: Account[]
  filters: RuleFilterValues
  buttonAriaLabel?: string
  buttonClassName?: string
  buttonContent?: ReactNode
  onChange: (updates: Partial<RuleFilterValues>) => void
  onClear: () => void
}

type FilterSection = 'patterns' | 'account' | 'amount'

export function RuleFiltersDropdown({ accounts, filters, buttonAriaLabel, buttonClassName, buttonContent, onChange, onClear }: RuleFiltersDropdownProps) {
  const [expandedSections, setExpandedSections] = useState<Record<FilterSection, boolean>>({ patterns: false, account: false, amount: false })
  const activeFilterCount = countActiveRuleFilters(filters)
  const patternsActive = Boolean(filters.merchantPattern.trim() || filters.originalPattern.trim())
  const accountActive = filters.accountIds.length > 0
  const amountActive = Boolean(filters.amountMin.trim() || filters.amountMax.trim())

  function toggleSection(section: FilterSection) {
    setExpandedSections((current) => ({ ...current, [section]: !current[section] }))
  }

  return (
    <FilterDropdownShell
      activeFilterCount={activeFilterCount}
      buttonAriaLabel={buttonAriaLabel}
      buttonClassName={buttonClassName}
      buttonContent={buttonContent}
      panelClassName="absolute right-0 z-20 mt-2 w-[min(22rem,calc(100vw-1rem))] rounded-2xl border border-neutral-200 bg-white p-4 shadow-card"
      onClear={onClear}
    >
      <div className="space-y-4">
        <CollapsibleFilterSection active={patternsActive} ariaLabel="Patterns filter" expanded={expandedSections.patterns} label="Patterns" summary={patternsSummary(filters)} onToggle={() => toggleSection('patterns')}>
          <div className="space-y-3">
            <FilterTextInput
              label="Merchant pattern"
              onChange={(merchantPattern) => onChange({ merchantPattern })}
              placeholder="Target"
              value={filters.merchantPattern}
            />
            <FilterTextInput
              label="Original name pattern"
              onChange={(originalPattern) => onChange({ originalPattern })}
              placeholder="TARGET STORE"
              value={filters.originalPattern}
            />
          </div>
        </CollapsibleFilterSection>
        <CollapsibleFilterSection active={accountActive} ariaLabel="Account filter" expanded={expandedSections.account} label="Account" summary={filterSummary(filters.accountIds.length)} onToggle={() => toggleSection('account')}>
          <div className="max-h-64 overflow-auto rounded-xl border border-neutral-100 bg-white p-2">
            <AccountCheckboxList accounts={accounts} selectedAccountIds={filters.accountIds} onChange={(accountIds) => onChange({ accountIds: accountIds ?? [] })} />
          </div>
        </CollapsibleFilterSection>
        <CollapsibleFilterSection active={amountActive} ariaLabel="Amount filter" expanded={expandedSections.amount} label="Amount" summary={amountSummary(filters)} onToggle={() => toggleSection('amount')}>
          <div className="grid grid-cols-2 gap-3">
            <FilterNumberInput label="Amount min" onChange={(amountMin) => onChange({ amountMin })} value={filters.amountMin} />
            <FilterNumberInput label="Amount max" onChange={(amountMax) => onChange({ amountMax })} value={filters.amountMax} />
          </div>
        </CollapsibleFilterSection>
      </div>
    </FilterDropdownShell>
  )
}

function FilterTextInput({ label, placeholder, value, onChange }: { label: string; placeholder: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">
      <span>{label}</span>
      <input
        className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-neutral-900 outline-none focus:border-brand-500"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="search"
        value={value}
      />
    </label>
  )
}

function FilterNumberInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wide text-neutral-500">
      <span>{label}</span>
      <input
        className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium normal-case tracking-normal text-neutral-900 outline-none focus:border-brand-500"
        inputMode="decimal"
        onChange={(event) => onChange(event.target.value)}
        placeholder="Any"
        step="0.01"
        type="number"
        value={value}
      />
    </label>
  )
}

function patternsSummary(filters: RuleFilterValues) {
  const count = (filters.merchantPattern.trim() ? 1 : 0) + (filters.originalPattern.trim() ? 1 : 0)
  return filterSummary(count)
}

function amountSummary(filters: RuleFilterValues) {
  const min = filters.amountMin.trim()
  const max = filters.amountMax.trim()
  if (min && max) return `$${min} to $${max}`
  if (min) return `At least $${min}`
  if (max) return `Up to $${max}`
  return 'Any'
}
