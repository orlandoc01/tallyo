import type { Account, NetWorthRange, Owner } from '../../types/graphql'
import type { AccountGroupId } from '../../utils/accountGroups'
import { FilterDropdown, FilterPresetRow } from '../common/FilterChip'
import { FilterPanel } from '../common/FilterPanel'
import { DEFAULT_NET_WORTH_RANGE, NET_WORTH_RANGE_OPTIONS, rangeOption } from './netWorthRanges'
import { AccountChip, AccountTypeChip, OwnerChip } from './WealthFilterChips'

export function NetWorthFilterPanel({ accounts, accountGroupIds, accountIds, owners, ownerIds, range, showAccountFilters, onAccountChange, onAccountGroupChange, onClear, onOwnerChange, onRangeChange }: {
  accounts: Account[]
  accountGroupIds: AccountGroupId[]
  accountIds: string[]
  owners: Owner[]
  ownerIds: string[]
  range: NetWorthRange
  showAccountFilters: boolean
  onAccountChange: (ids: string[]) => void
  onAccountGroupChange: (ids: AccountGroupId[]) => void
  onClear: () => void
  onOwnerChange: (ids: string[]) => void
  onRangeChange: (range: NetWorthRange) => void
}) {
  return (
    <FilterPanel clearable={ownerIds.length > 0 || accountIds.length > 0} onClear={onClear}>
      <FilterDropdown active={range !== DEFAULT_NET_WORTH_RANGE} label="Date" summary={range !== DEFAULT_NET_WORTH_RANGE ? rangeOption(range).label : undefined} width={200}>
        {(close) => (
          <div role="radiogroup" aria-label="Date range">
            {NET_WORTH_RANGE_OPTIONS.map((option) => (
              <FilterPresetRow hint={option.compact} key={option.id} label={option.label} onSelect={() => { onRangeChange(option.id); close() }} selected={option.id === range} />
            ))}
          </div>
        )}
      </FilterDropdown>
      <OwnerChip accounts={accounts} ownerIds={ownerIds} owners={owners} onChange={onOwnerChange} />
      {showAccountFilters ? (
        <>
          <AccountTypeChip accountGroupIds={accountGroupIds} accounts={accounts} onChange={onAccountGroupChange} />
          <AccountChip accountIds={accountIds} accounts={accounts} onChange={onAccountChange} />
        </>
      ) : null}
    </FilterPanel>
  )
}
