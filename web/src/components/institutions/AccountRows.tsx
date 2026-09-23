import clsx from 'clsx'
import type { Account } from '../../types/graphql'
import { accountBalanceUSD } from '../../utils/accounts'
import { formatSignedCurrency, maskAmount } from '../../utils/currency'
import { ClickableRow } from '../common/ClickableRow'
import { DataGridHeader, dataGridNumericCell, dataGridTextCell } from '../common/DataGrid'
import { Tag } from '../common/Tag'
import { accountNumberLabel, accountRowLabel, accountTypeLabel, sortAccountsByStatus } from './accountCards'
import { accountNeedsReview } from './connectionReview'
import { ManualAccountBadge } from './ManualAccountBadge'

const GRID_COLUMNS = 'minmax(180px,2fr) minmax(80px,120px) minmax(130px,1.4fr) minmax(80px,110px) minmax(110px,140px)'
const ROW_GRID_CLASS = 'lg:grid-cols-[minmax(180px,2fr)_minmax(80px,120px)_minmax(130px,1.4fr)_minmax(80px,110px)_minmax(110px,140px)]'

export function AccountTable({ accounts, amountsHidden = false, onAccountClick }: {
  accounts: Account[]
  amountsHidden?: boolean
  onAccountClick?: (account: Account) => void
}) {
  if (accounts.length === 0) return null
  return (
    <div className="overflow-x-auto rounded-b-lg">
      <div className="lg:min-w-[680px]">
        <div className="hidden lg:block">
          <DataGridHeader gridTemplateColumns={GRID_COLUMNS} variant="list">
            <span>Account</span>
            <span>Number</span>
            <span>Type</span>
            <span>Status</span>
            <span className="text-right">Balance</span>
          </DataGridHeader>
        </div>
        {sortAccountsByStatus(accounts).map((account) => (
          <AccountRow account={account} amountsHidden={amountsHidden} key={account.id} onClick={onAccountClick ? () => onAccountClick(account) : undefined} />
        ))}
      </div>
    </div>
  )
}

function AccountRow({ account, amountsHidden, onClick }: { account: Account; amountsHidden: boolean; onClick?: () => void }) {
  const balance = accountBalanceUSD(account)
  const formattedBalance = balance === null ? '—' : formatSignedCurrency(balance)
  return (
    <ClickableRow
      ariaLabel={accountRowLabel(account)}
      className={clsx(
        'grid min-h-[52px] w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-t border-border px-4 py-1.5 text-left transition-colors duration-150 lg:h-11 lg:min-h-0 lg:py-0',
        ROW_GRID_CLASS,
        onClick && 'cursor-pointer hover:bg-raised',
      )}
      onClick={onClick}
    >
      <span className={clsx(dataGridTextCell, 'order-1 flex items-center gap-2 text-sm font-medium lg:order-none', account.closed ? 'text-text-muted' : 'text-text-1')}>
        <span className="truncate">{account.name}</span>
        {account.manual ? <ManualAccountBadge /> : null}
        {account.hidden ? <Tag>Hidden</Tag> : null}
        {accountNeedsReview(account) ? <Tag tint="amber">verify type</Tag> : null}
      </span>
      <span className="order-3 flex min-w-0 items-center gap-1 text-xs text-text-muted lg:order-none lg:contents">
        <span className="whitespace-nowrap tracking-[.5px] lg:text-[13px]">{accountNumberLabel(account.mask)}</span>
        <span aria-hidden className="lg:hidden">·</span>
        <span className={clsx(dataGridTextCell, 'lg:text-[13px] lg:text-text-3')}>{accountTypeLabel(account)}</span>
      </span>
      <span className="order-4 flex items-center justify-self-end gap-1.5 text-[11px] text-text-muted lg:order-none lg:justify-self-start lg:text-xs">
        <span aria-hidden className={clsx('h-1.5 w-1.5 rounded-full', account.closed ? 'bg-text-faint' : 'bg-positive')} />
        {account.closed ? 'Closed' : 'Active'}
      </span>
      <span className={clsx(dataGridNumericCell, 'order-2 text-sm font-medium text-text-1 lg:order-none')}>{amountsHidden ? maskAmount(formattedBalance) : formattedBalance}</span>
    </ClickableRow>
  )
}
