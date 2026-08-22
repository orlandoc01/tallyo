import { useState } from 'react'
import type { Account, Owner } from '../../types/graphql'
import { AccountCheckboxList } from '../transactions/AccountCheckboxList'
import { useAuth } from '../../auth/useAuth'
import { ASSET_ACCOUNT_GROUPS, type AccountGroupId } from '../../utils/accountGroups'
import { FilterCheckboxList } from '../common/FilterCheckboxList'
import { CollapsibleFilterSection } from '../common/CollapsibleFilterSection'
import { filterSummary } from '../common/filterSummary'
import { ToggleSwitch } from '../common/ToggleSwitch'
import { ReportFilterDropdown } from '../reports/ReportFilterDropdown'

interface AnalysisFilterContentProps {
  accounts: Account[]
  owners: Owner[]
  ownerIds: string[]
  accountGroupIds: AccountGroupId[]
  accountIds: string[]
  includeUnclassified?: boolean
  checkboxVariant?: 'default' | 'highlight'
  enableAccountConnectionToggle?: boolean
  showAccountFilters?: boolean
  onOwnerChange: (ownerIds: string[]) => void
  onAccountGroupChange: (groupIds: AccountGroupId[]) => void
  onAccountChange: (accountIds: string[]) => void
  onIncludeUnclassifiedChange?: (includeUnclassified: boolean) => void
}

interface AnalysisFiltersProps extends AnalysisFilterContentProps {
  accountGroupCountMode?: 'additive' | 'derived'
  onClear: () => void
}

export function AnalysisFilters({ accounts, owners, ownerIds, accountGroupIds, accountIds, includeUnclassified, accountGroupCountMode = 'additive', checkboxVariant = 'default', enableAccountConnectionToggle = false, showAccountFilters = true, onOwnerChange, onAccountGroupChange, onAccountChange, onIncludeUnclassifiedChange, onClear }: AnalysisFiltersProps) {
  const activeFilterCount = activeAnalysisFilterCount({ accountGroupCountMode, ownerIds, accountGroupIds, accountIds, includeUnclassified, onIncludeUnclassifiedChange, showAccountFilters })

  return (
    <ReportFilterDropdown activeFilterCount={activeFilterCount} onClear={onClear}>
      <AnalysisFilterContent
        accounts={accounts}
        accountGroupIds={accountGroupIds}
        accountIds={accountIds}
        checkboxVariant={checkboxVariant}
        enableAccountConnectionToggle={enableAccountConnectionToggle}
        includeUnclassified={includeUnclassified}
        showAccountFilters={showAccountFilters}
        ownerIds={ownerIds}
        owners={owners}
        onAccountChange={onAccountChange}
        onAccountGroupChange={onAccountGroupChange}
        onIncludeUnclassifiedChange={onIncludeUnclassifiedChange}
        onOwnerChange={onOwnerChange}
      />
    </ReportFilterDropdown>
  )
}

export function AnalysisFilterContent({ accounts, owners, ownerIds, accountGroupIds, accountIds, includeUnclassified, checkboxVariant = 'default', enableAccountConnectionToggle = false, showAccountFilters = true, onOwnerChange, onAccountGroupChange, onAccountChange, onIncludeUnclassifiedChange }: AnalysisFilterContentProps) {
  const { hideOwners } = useAuth()
  const [expandedSections, setExpandedSections] = useState<Record<FilterSection, boolean>>({ owner: false, accountType: false, account: false })
  const accountGroups = availableAccountGroups(accounts)

  function toggleSection(section: FilterSection) {
    setExpandedSections((current) => ({ ...current, [section]: !current[section] }))
  }

  return (
    <div className="space-y-4">
      {onIncludeUnclassifiedChange ? <ToggleRow checked={includeUnclassified ?? false} label="Include unclassified" onChange={onIncludeUnclassifiedChange} /> : null}
      {!hideOwners ? (
        <CollapsibleFilterSection active={ownerIds.length > 0} expanded={expandedSections.owner} label="Owner" summary={filterSummary(ownerIds.length)} onToggle={() => toggleSection('owner')}>
          <FilterCheckboxList options={owners.map((owner) => ({ id: owner.id, label: owner.name, ariaLabel: owner.name }))} selectedIds={ownerIds} onChange={onOwnerChange} />
        </CollapsibleFilterSection>
      ) : null}
      {showAccountFilters ? (
        <>
          <CollapsibleFilterSection active={accountGroupIds.length > 0} expanded={expandedSections.accountType} label="Account type" summary={filterSummary(accountGroupIds.length)} onToggle={() => toggleSection('accountType')}>
            <FilterCheckboxList options={accountGroups.map((group) => ({ id: group.id, label: group.label, ariaLabel: group.label }))} selectedIds={accountGroupIds} onChange={(ids) => onAccountGroupChange(ids as AccountGroupId[])} />
          </CollapsibleFilterSection>
          <CollapsibleFilterSection active={accountIds.length > 0} expanded={expandedSections.account} label="Account" summary={filterSummary(accountIds.length)} onToggle={() => toggleSection('account')}>
            <div className="max-h-64 overflow-auto rounded-xl border border-neutral-100 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900">
              <AccountCheckboxList accounts={accounts} enableGroupToggle={enableAccountConnectionToggle} selectedAccountIds={accountIds} variant={checkboxVariant} onChange={(ids) => onAccountChange(ids ?? [])} />
            </div>
          </CollapsibleFilterSection>
        </>
      ) : null}
    </div>
  )
}

type FilterSection = 'owner' | 'accountType' | 'account'

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-200 px-3 py-3 dark:border-neutral-800">
      <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200">{label}</span>
      <ToggleSwitch checked={checked} dark label={label} onChange={onChange} />
    </div>
  )
}

function activeAnalysisFilterCount({ accountGroupCountMode, ownerIds, accountGroupIds, accountIds, includeUnclassified, onIncludeUnclassifiedChange, showAccountFilters }: Pick<AnalysisFiltersProps, 'accountGroupCountMode' | 'ownerIds' | 'accountGroupIds' | 'accountIds' | 'includeUnclassified' | 'onIncludeUnclassifiedChange' | 'showAccountFilters'>) {
  const accountGroupCount = showAccountFilters && accountGroupCountMode !== 'derived' ? accountGroupIds.length : 0
  const accountCount = showAccountFilters ? accountIds.length : 0
  return ownerIds.length + accountGroupCount + accountCount + (onIncludeUnclassifiedChange && includeUnclassified ? 1 : 0)
}

function availableAccountGroups(accounts: Account[]) {
  const visibleAccounts = accounts.filter((account) => !account.hidden)
  const groups = ASSET_ACCOUNT_GROUPS.filter((group) => visibleAccounts.some((account) => account.type === group.accountType))
  return groups.length ? groups.map((group) => ({ id: group.id, label: group.label })) : ASSET_ACCOUNT_GROUPS.map((group) => ({ id: group.id, label: group.label }))
}
