import { useContext } from 'react'
import { TransactionSelectionContext } from './transactionSelectionContextValue'

export function useTransactionSelection() {
  const ctx = useContext(TransactionSelectionContext)
  if (!ctx) throw new Error('useTransactionSelection must be used inside TransactionSelectionProvider')
  return ctx
}
