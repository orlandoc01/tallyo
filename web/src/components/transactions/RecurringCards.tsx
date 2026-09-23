import clsx from 'clsx'
import type { ReactNode } from 'react'
import type { RecurringCharge } from '../../types/graphql'
import { accountDisplayLabel } from '../../utils/accounts'
import { categoryTint } from '../../utils/categoryTint'
import { formatCurrency, formatTransactionAmount } from '../../utils/currency'
import { formatDisplayDate } from '../../utils/dates'
import { pluralize } from '../../utils/pluralize'
import { EmojiAvatar } from '../common/Avatar'
import { ClickableRow } from '../common/ClickableRow'
import { DataGridHeader, DataGridRow, dataGridNumericCell, dataGridTextCell } from '../common/DataGrid'
import { Card } from '../common/FormControls'
import { StatBlock, StatGrid } from '../common/StatBlock'
import { CategoryTag, Tag } from '../common/Tag'
import { TransactionAmount } from '../common/TransactionAmount'
import { type CadenceGroup, latestTransaction, type RecurringStats } from './recurringCadence'

const GRID_COLUMNS = 'minmax(180px,2fr) minmax(100px,1fr) minmax(130px,1.5fr) minmax(150px,1.5fr) minmax(90px,110px)'

export function RecurringStatsCard({ stats }: { stats: RecurringStats }) {
  const rows: Array<{ label: string; value: ReactNode }> = [
    { label: 'Monthly recurring expenses', value: formatCurrency(stats.monthlyExpenses) },
    { label: 'Monthly recurring income', value: <span className="text-positive">{`+${formatCurrency(stats.monthlyIncome)}`}</span> },
    { label: 'Next 7 days', value: `${formatCurrency(stats.next7Total)} · ${pluralize(stats.next7Count, 'item')}` },
  ]
  return (
    <Card aria-label="Recurring summary" as="section" className="px-4 py-3.5 lg:px-5 lg:py-4">
      <div className="flex flex-col gap-3 lg:hidden">
        {rows.map((row) => (
          <div className="flex items-baseline justify-between gap-3" key={row.label}>
            <span className="text-[13px] text-text-muted">{row.label}</span>
            <span className="text-[15px] font-semibold tabular-nums text-text-1">{row.value}</span>
          </div>
        ))}
      </div>
      <div className="hidden lg:block">
        <StatGrid>
          {rows.map((row) => <StatBlock key={row.label} label={row.label} value={row.value} />)}
        </StatGrid>
      </div>
    </Card>
  )
}

function chargeAccount(charge: RecurringCharge) {
  const account = latestTransaction(charge.transactions)?.account
  return account ? accountDisplayLabel(account) : '—'
}

export function RecurringCadenceCard({ group, onSelect }: { group: CadenceGroup; onSelect: (charge: RecurringCharge) => void }) {
  return (
    <Card as="section">
      <div className="flex h-11 items-center justify-between gap-3 px-4">
        <h2 className="text-sm font-semibold text-text-1">{group.label}</h2>
        <span className="text-[13px] tabular-nums text-text-muted">{pluralize(group.items.length, 'item')} · {formatTransactionAmount(group.cycleTotal)} / cycle</span>
      </div>
      <div className="hidden overflow-x-auto lg:block">
        <div className="min-w-[760px]">
          <DataGridHeader gridTemplateColumns={GRID_COLUMNS} variant="list">
            <span>Merchant</span>
            <span>Last seen</span>
            <span>Category</span>
            <span>Account</span>
            <span className="text-right">Amount</span>
          </DataGridHeader>
          {group.items.map((charge) => (
            <DataGridRow ariaLabel={`View transactions for ${charge.merchantName}`} gridTemplateColumns={GRID_COLUMNS} key={charge.id} onClick={() => onSelect(charge)}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-sm font-medium text-text-1">{charge.merchantName}</span>
                {charge.status === 'EARLY_DETECTION' ? <Tag className="shrink-0">Early detection</Tag> : null}
              </span>
              <span className={clsx(dataGridTextCell, 'text-text-3')}>{formatDisplayDate(charge.lastDate)}</span>
              <span className="flex min-w-0 items-center">{charge.category ? <CategoryTag category={charge.category} /> : <span className="text-text-muted">—</span>}</span>
              <span className={clsx(dataGridTextCell, 'text-[13px] text-text-muted')}>{chargeAccount(charge)}</span>
              <span className={dataGridNumericCell}><TransactionAmount amount={charge.estimatedAmount} /></span>
            </DataGridRow>
          ))}
        </div>
      </div>
      <div className="lg:hidden">
        {group.items.map((charge) => (
          <ClickableRow
            ariaLabel={`View transactions for ${charge.merchantName}`}
            className="flex h-[58px] w-full items-center gap-3 border-t border-border px-4 text-left"
            key={charge.id}
            onClick={() => onSelect(charge)}
          >
            <EmojiAvatar emoji={charge.category?.emoji ?? '•'} tint={charge.category ? categoryTint(charge.category) : 'gray'} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-text-1">{charge.merchantName}</span>
              <span className="block truncate text-xs text-text-muted">{chargeAccount(charge)}</span>
            </span>
            <TransactionAmount amount={charge.estimatedAmount} />
          </ClickableRow>
        ))}
      </div>
    </Card>
  )
}
