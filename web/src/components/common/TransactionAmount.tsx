import clsx from 'clsx'
import { formatTransactionAmount, transactionAmountClassName } from '../../utils/currency'

export function TransactionAmount({ amount, italic = false }: { amount: number; italic?: boolean }) {
  return (
    <span className={clsx('text-sm font-medium tabular-nums', italic && 'italic', transactionAmountClassName(amount))}>
      {formatTransactionAmount(amount)}
    </span>
  )
}
