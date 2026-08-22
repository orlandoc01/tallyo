import type { Transaction } from '../../types/graphql'
import { formatDisplayDate } from '../../utils/dates'
import { formatSignedCurrency } from '../../utils/currency'
import { MobileTransactionRow } from './TransactionRow'
import { type TransactionRowContext, dayTotal, renderTransactionRows } from './transactionRows'

export function MobileDateGroup({
  ctx,
  date,
  transactions,
}: {
  ctx: TransactionRowContext
  date: string
  transactions: Transaction[]
}) {
  return (
    <>
      <div className="flex items-center justify-between bg-neutral-50 px-4 py-2 text-xs font-semibold text-neutral-500">
        <span>{formatDisplayDate(date)}</span>
        <span className="tabular-nums">{formatSignedCurrency(dayTotal(transactions))}</span>
      </div>
      {renderTransactionRows(transactions, ctx, MobileTransactionRow)}
    </>
  )
}
