import { useState } from 'react'
import type { Account } from '../../types/graphql'
import { accountDisplayLabel } from '../../utils/accounts'
import { AccountFilterOptions } from '../common/AccountFilterOptions'
import { CollapsibleFilterSection } from '../common/CollapsibleFilterSection'
import { FilterDropdown } from '../common/FilterChip'
import { FilterPanel } from '../common/FilterPanel'
import { filterSummary, selectionSummary } from '../common/filterSummary'
import { TextField } from '../common/FormControls'
import { MobileFilterDropdown } from '../common/MobileFilterDropdown'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { AccountCheckboxList } from './AccountCheckboxList'
import type { RuleFilterValues } from './ruleFilterUtils'

interface RuleFilterProps {
  accounts: Account[]
  filters: RuleFilterValues
  onChange: (updates: Partial<RuleFilterValues>) => void
  onClear: () => void
}

type Section = 'patterns' | 'account' | 'amount'

function patternsActive(filters: RuleFilterValues) {
  return Boolean(filters.merchantPattern.trim() || filters.originalPattern.trim())
}

function patternsSummary(filters: RuleFilterValues) {
  const count = (filters.merchantPattern.trim() ? 1 : 0) + (filters.originalPattern.trim() ? 1 : 0)
  return count ? filterSummary(count) : undefined
}

function amountSummary(filters: RuleFilterValues) {
  const min = filters.amountMin.trim()
  const max = filters.amountMax.trim()
  if (min && max) return `$${min} to $${max}`
  if (min) return `At least $${min}`
  if (max) return `Up to $${max}`
  return undefined
}

function PatternFields({ filters, onChange }: Pick<RuleFilterProps, 'filters' | 'onChange'>) {
  return (
    <div className="space-y-2 px-1">
      <TextField label="Merchant pattern" onChange={(merchantPattern) => onChange({ merchantPattern })} placeholder="Target" type="search" value={filters.merchantPattern} />
      <TextField label="Original name pattern" onChange={(originalPattern) => onChange({ originalPattern })} placeholder="TARGET STORE" type="search" value={filters.originalPattern} />
    </div>
  )
}

function AmountFields({ filters, onChange }: Pick<RuleFilterProps, 'filters' | 'onChange'>) {
  return (
    <div className="grid grid-cols-2 gap-2 px-1">
      <TextField inputMode="decimal" label="Amount min" onChange={(amountMin) => onChange({ amountMin })} placeholder="Any" step="0.01" type="number" value={filters.amountMin} />
      <TextField inputMode="decimal" label="Amount max" onChange={(amountMax) => onChange({ amountMax })} placeholder="Any" step="0.01" type="number" value={filters.amountMax} />
    </div>
  )
}

export function RuleFilterPanel({ accounts, caretRight, clearable, filters, onChange, onClear }: RuleFilterProps & { caretRight?: number; clearable: boolean }) {
  const visibleAccounts = accounts.filter((account) => !account.hidden)
  return (
    <FilterPanel caretRight={caretRight} clearable={clearable} onClear={onClear}>
      <FilterDropdown active={patternsActive(filters)} label="Patterns" summary={patternsSummary(filters)} width={300}>
        <PatternFields filters={filters} onChange={onChange} />
      </FilterDropdown>
      <FilterDropdown active={filters.accountIds.length > 0} label="Account" summary={selectionSummary(filters.accountIds, (id) => { const account = visibleAccounts.find((item) => item.id === id); return account && accountDisplayLabel(account) })} width={320}>
        <AccountFilterOptions accounts={visibleAccounts} onChange={(accountIds) => onChange({ accountIds })} selectedIds={filters.accountIds} />
      </FilterDropdown>
      <FilterDropdown active={Boolean(amountSummary(filters))} label="Amount" summary={amountSummary(filters)} width={300}>
        <AmountFields filters={filters} onChange={onChange} />
      </FilterDropdown>
    </FilterPanel>
  )
}

export function RuleMobileFilters({ accounts, filters, onChange, onClear, onClose }: RuleFilterProps & { onClose: () => void }) {
  const [open, setOpen] = useState<Section | null>(null)
  const toggle = (section: Section) => () => setOpen((current) => current === section ? null : section)
  return (
    <MobileFilterDropdown footer={<MobileFilterFooter onPrimary={onClose} />} labelledBy="rule-filters-title" onClear={onClear} onClose={onClose}>
      <CollapsibleFilterSection active={patternsActive(filters)} expanded={open === 'patterns'} label="Patterns" summary={patternsSummary(filters) ?? 'Any'} onToggle={toggle('patterns')}>
        <PatternFields filters={filters} onChange={onChange} />
      </CollapsibleFilterSection>
      <CollapsibleFilterSection active={filters.accountIds.length > 0} expanded={open === 'account'} label="Account" summary={filterSummary(filters.accountIds.length)} onToggle={toggle('account')}>
        <div className="max-h-72 overflow-auto">
          <AccountCheckboxList accounts={accounts} enableGroupToggle onChange={(accountIds) => onChange({ accountIds: accountIds ?? [] })} selectedAccountIds={filters.accountIds} />
        </div>
      </CollapsibleFilterSection>
      <CollapsibleFilterSection active={Boolean(amountSummary(filters))} expanded={open === 'amount'} label="Amount" summary={amountSummary(filters) ?? 'Any'} onToggle={toggle('amount')}>
        <AmountFields filters={filters} onChange={onChange} />
      </CollapsibleFilterSection>
    </MobileFilterDropdown>
  )
}
