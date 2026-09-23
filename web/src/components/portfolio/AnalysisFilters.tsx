import { useState } from 'react'
import type { Account, Owner } from '../../types/graphql'
import { AccountCheckboxList } from '../transactions/AccountCheckboxList'
import { useAuth } from '../../auth/useAuth'
import { ASSET_ACCOUNT_GROUPS, visibleAccountCountsByGroup, visibleAccountCountsByOwner, type AccountGroupId } from '../../utils/accountGroups'
import { FilterCheckboxList } from '../common/FilterCheckboxList'
import { CollapsibleFilterSection } from '../common/CollapsibleFilterSection'
import { filterSummary } from '../common/filterSummary'
import { ToggleSwitch } from '../common/ToggleSwitch'
import { OwnerDot } from '../common/OwnerDot'

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

export function AnalysisFilterContent({ accounts, owners, ownerIds, accountGroupIds, accountIds, includeUnclassified, checkboxVariant = 'default', enableAccountConnectionToggle = false, showAccountFilters = true, onOwnerChange, onAccountGroupChange, onAccountChange, onIncludeUnclassifiedChange }: AnalysisFilterContentProps) {
  const { hideOwners } = useAuth()
  const [expandedSections, setExpandedSections] = useState<Record<FilterSection, boolean>>({ owner: false, accountType: false, account: false })
  const accountGroups = availableAccountGroups(accounts)

  function toggleSection(section: FilterSection) {
    setExpandedSections((current) => ({ ...current, [section]: !current[section] }))
  }

  const ownerCounts = visibleAccountCountsByOwner(accounts)

  return (
    <div>
      {onIncludeUnclassifiedChange ? <ToggleRow checked={includeUnclassified ?? false} label="Include unclassified" onChange={onIncludeUnclassifiedChange} /> : null}
      {!hideOwners ? (
        <CollapsibleFilterSection active={ownerIds.length > 0} expanded={expandedSections.owner} label="Owner" summary={filterSummary(ownerIds.length)} onToggle={() => toggleSection('owner')}>
          <FilterCheckboxList
            options={owners.map((owner) => ({
              id: owner.id,
              label: owner.name,
              ariaLabel: owner.name,
              leading: <OwnerDot name={owner.name} />,
              trailing: ownerCounts.get(owner.id) ?? 0,
            }))}
            selectedIds={ownerIds}
            onChange={onOwnerChange}
          />
        </CollapsibleFilterSection>
      ) : null}
      {showAccountFilters ? (
        <>
          <CollapsibleFilterSection active={accountGroupIds.length > 0} expanded={expandedSections.accountType} label="Account type" summary={filterSummary(accountGroupIds.length)} onToggle={() => toggleSection('accountType')}>
            <FilterCheckboxList options={accountGroups.map((group) => ({ id: group.id, label: group.label, ariaLabel: group.label, trailing: group.count }))} selectedIds={accountGroupIds} onChange={(ids) => onAccountGroupChange(ids as AccountGroupId[])} />
          </CollapsibleFilterSection>
          <CollapsibleFilterSection active={accountIds.length > 0} expanded={expandedSections.account} label="Account" summary={filterSummary(accountIds.length)} onToggle={() => toggleSection('account')}>
            <div className="max-h-72 overflow-auto">
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
    <div className="flex min-h-[52px] items-center justify-between gap-3">
      <span className="text-sm font-medium text-text-1">{label}</span>
      <ToggleSwitch checked={checked} label={label} onChange={onChange} />
    </div>
  )
}

function availableAccountGroups(accounts: Account[]) {
  const visibleAccounts = accounts.filter((account) => !account.hidden)
  const counts = visibleAccountCountsByGroup(accounts)
  const groups = ASSET_ACCOUNT_GROUPS.filter((group) => visibleAccounts.some((account) => account.type === group.accountType))
  return (groups.length ? groups : ASSET_ACCOUNT_GROUPS).map((group) => ({ id: group.id, label: group.label, count: counts.get(group.id) ?? 0 }))
}
