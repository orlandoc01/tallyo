import clsx from 'clsx'
import { ChevronRight, LayoutGrid } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { ClickableRow } from '../common/ClickableRow'
import { Card, SearchInput } from '../common/FormControls'
import { displayAmount } from './amountDisplay'
import { accountInstitution, accountRowAmount, accountSyncStatus, filterSidebarGroups, sidebarGroups, type SidebarGroup } from './accountSidebarGroups'
import { formatCurrencyAbbrev } from '../../utils/currency'
import { institutionColor } from '../../utils/colors'
import type { Account, ClassifierBreakdown, LiabilityBreakdown } from '../../types/graphql'
import type { AccountGroupId } from '../../utils/accountGroups'

interface AccountSidebarProps {
  netWorth: number
  breakdown: ClassifierBreakdown[]
  liabilityBreakdown: LiabilityBreakdown[]
  onAccountClick?: (account: Account) => void
  onAccountGroupClick?: (accountGroupId: AccountGroupId | null, accountIds: string[]) => void
  onClearAccountFilters?: () => void
  amountsHidden?: boolean
  selectedAccountGroupIds?: AccountGroupId[]
  selectedAccountIds?: string[]
  canReadHoldings?: boolean
  variant?: 'desktop' | 'mobile'
}

export function AccountSidebar({
  netWorth,
  breakdown,
  liabilityBreakdown,
  onAccountClick,
  onAccountGroupClick,
  onClearAccountFilters,
  amountsHidden = false,
  selectedAccountGroupIds = [],
  selectedAccountIds = [],
  canReadHoldings = true,
  variant = 'desktop',
}: AccountSidebarProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const allGroups = sidebarGroups(breakdown, liabilityBreakdown, canReadHoldings)
  const groups = filterSidebarGroups(allGroups, search)
  const searching = search.trim() !== ''
  const accountCount = allGroups.reduce((sum, group) => sum + group.accounts.length, 0)
  const mobile = variant === 'mobile'

  const rows = groups.map((group) => {
    const groupAccountIds = group.accounts.map((account) => account.id)
    const expanded = searching || (open[group.id] ?? !mobile)
    const selected = group.accountGroupId ? selectedAccountGroupIds.includes(group.accountGroupId) : groupAccountIds.length > 0 && groupAccountIds.every((accountId) => selectedAccountIds.includes(accountId))
    return (
      <GroupRow
        amountsHidden={amountsHidden}
        expanded={expanded}
        group={group}
        key={group.id}
        mobile={mobile}
        selected={selected}
        onClick={onAccountGroupClick && groupAccountIds.length > 0 ? () => onAccountGroupClick(group.accountGroupId ?? null, groupAccountIds) : undefined}
        onToggle={group.accounts.length > 0 && !searching ? () => setOpen((current) => ({ ...current, [group.id]: !expanded })) : undefined}
      >
        {expanded ? group.accounts.map((account) => (
          <AccountRow
            account={account}
            amountsHidden={amountsHidden}
            isLiability={group.isLiability}
            key={account.id}
            mobile={mobile}
            selected={selectedAccountIds.includes(account.id)}
            onClick={onAccountClick ? () => onAccountClick(account) : undefined}
          />
        )) : null}
      </GroupRow>
    )
  })
  const empty = groups.length === 0 ? <p className="px-4 py-3 text-[13px] text-text-muted">{searching ? 'No accounts match.' : 'No visible accounts with balances.'}</p> : null

  if (mobile) {
    return (
      <Card className="pb-2 pt-4 lg:hidden" data-account-sidebar>
        <div className="flex items-baseline justify-between px-4">
          <h2 className="text-[17px] font-semibold tracking-[-0.2px] text-text-1">Accounts</h2>
          <span className="text-xs text-text-muted">{accountCount} accounts</span>
        </div>
        {canReadHoldings ? <SearchInput ariaLabel="Search accounts" className="mx-4 mb-1 mt-3" onChange={setSearch} placeholder="Search accounts" value={search} /> : null}
        {rows}
        {empty}
      </Card>
    )
  }

  return (
    <Card as="aside" className="sticky top-4 hidden max-h-[calc(100vh-32px)] py-3 lg:block" data-account-sidebar overflow="auto">
      {canReadHoldings ? <div className="px-4 pb-3"><SearchInput ariaLabel="Search accounts" onChange={setSearch} placeholder="Search accounts" value={search} /></div> : null}
      <button
        aria-pressed={selectedAccountIds.length === 0}
        className={clsx('mx-2 flex w-[calc(100%-16px)] items-center gap-2.5 rounded-md px-3 py-2.5 text-sm font-medium text-text-1', selectedAccountIds.length === 0 ? 'bg-raised-nav' : 'hover:bg-raised')}
        onClick={onClearAccountFilters}
        type="button"
      >
        <LayoutGrid aria-hidden className="h-4 w-4 text-text-2" />
        <span className="flex-1 text-left">Net Worth</span>
        <span>{displayAmount(amountsHidden, formatCurrencyAbbrev(netWorth, 1))}</span>
      </button>
      <div className="my-2 border-t border-border" />
      {rows}
      {empty}
    </Card>
  )
}

function GroupRow({ amountsHidden, children, expanded, group, mobile, selected, onClick, onToggle }: {
  amountsHidden: boolean
  children: ReactNode
  expanded: boolean
  group: SidebarGroup
  mobile: boolean
  selected: boolean
  onClick?: () => void
  onToggle?: () => void
}) {
  const Icon = group.icon
  const value = displayAmount(amountsHidden, formatCurrencyAbbrev(group.total))
  const toggleLabel = `${expanded ? 'Collapse' : 'Expand'} ${group.label} accounts`
  const label = (
    <>
      <span className="min-w-0 flex-1 truncate text-left text-sm font-medium text-text-1">{group.label}</span>
      <span className="text-sm font-medium text-text-1">{value}</span>
    </>
  )
  const body = onClick
    ? <button aria-pressed={selected} className="flex min-w-0 flex-1 items-center gap-2.5" onClick={onClick} type="button">{label}</button>
    : <span className="flex min-w-0 flex-1 items-center gap-2.5">{label}</span>

  if (mobile) {
    return (
      <div>
        <div className={clsx('flex h-12 items-center gap-2.5 px-4', selected && 'bg-raised-nav')}>
          {onToggle ? (
            <button aria-label={toggleLabel} className="flex h-4 w-4 shrink-0 items-center justify-center" onClick={onToggle} type="button">
              <ChevronRight aria-hidden className={clsx('h-2.5 w-2.5 text-text-muted transition-transform', expanded && 'rotate-90')} />
            </button>
          ) : (
            <span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center">
              {expanded ? <ChevronRight className="h-2.5 w-2.5 rotate-90 text-text-muted" /> : null}
            </span>
          )}
          <Icon aria-hidden className="h-4 w-4 shrink-0 text-text-2" />
          {body}
        </div>
        {children}
      </div>
    )
  }

  return (
    <div>
      <div className={clsx('group mx-2 flex items-center gap-2.5 rounded-md px-3 py-2.5', selected ? 'bg-raised-nav' : 'hover:bg-raised')}>
        {onToggle ? (
          <button aria-label={toggleLabel} className="relative h-4 w-4 shrink-0" onClick={onToggle} type="button">
            <Icon aria-hidden className="absolute inset-0 h-4 w-4 text-text-2 transition-opacity duration-[120ms] group-hover:opacity-0" />
            <ChevronRight aria-hidden className={clsx('absolute inset-0 m-auto h-2.5 w-2.5 text-text-muted opacity-0 transition-[opacity,transform] duration-[120ms] group-hover:opacity-100', expanded && 'rotate-90')} />
          </button>
        ) : expanded ? (
          <ChevronRight aria-hidden className="h-4 w-4 shrink-0 rotate-90 p-[3px] text-text-muted" />
        ) : <Icon aria-hidden className="h-4 w-4 shrink-0 text-text-2" />}
        {body}
      </div>
      {children}
    </div>
  )
}

function AccountRow({ account, amountsHidden, isLiability, mobile, selected, onClick }: {
  account: Account
  amountsHidden: boolean
  isLiability: boolean
  mobile: boolean
  selected: boolean
  onClick?: () => void
}) {
  const sync = accountSyncStatus(account)
  const className = clsx(
    'flex items-center gap-2.5 text-left',
    mobile ? 'h-[50px] w-full bg-surface-2 pl-10 pr-4' : 'ml-6 mr-2 w-[calc(100%-32px)] rounded-md px-3 py-1.5',
    selected ? 'bg-raised-nav' : onClick && 'hover:bg-raised',
  )
  const content = (
    <>
      <span aria-hidden className={clsx('flex shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white', mobile ? 'h-6 w-6' : 'h-[22px] w-[22px]')} style={{ backgroundColor: institutionColor(accountInstitution(account)) }}>
        {account.name.charAt(0).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-text-1">{account.name}</span>
        <span className="block truncate text-[11px] text-text-muted">{accountInstitution(account)}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-[13px] font-medium text-text-1">{displayAmount(amountsHidden, accountRowAmount(account, isLiability))}</span>
        {sync ? <span className={clsx('block text-[11px]', sync.stale ? 'text-warning' : 'text-text-muted')}>{sync.text}</span> : null}
      </span>
    </>
  )
  return <ClickableRow ariaLabel={`Open details for ${account.name}`} className={className} onClick={onClick} pressed={selected}>{content}</ClickableRow>
}
