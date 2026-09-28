import { useState } from 'react'
import { useMutation } from 'urql'
import { CREATE_TRANSACTION_MUTATION } from '../../graphql/mutations'
import { useSaveAction } from '../../hooks/useSaveAction'
import type { Account, CreateTransactionInput, CreateTransactionPayload, Transaction } from '../../types/graphql'
import { toDateInputValue } from '../../utils/dates'

interface CreateTransactionDraft {
  accountId: string
  date: string
  amount: string
  merchantName: string
  originalName: string
  categoryId: string
  notes: string
  isRecurring: boolean
  isHidden: boolean
}

export function useCreateTransactionForm({ accounts, onCreated }: { accounts: Account[]; onCreated: (transaction: Transaction) => void }) {
  const visibleAccounts = accounts.filter((account) => !account.hidden)
  const [, createTransaction] = useMutation<{ createTransaction: CreateTransactionPayload }, { input: CreateTransactionInput }>(CREATE_TRANSACTION_MUTATION)
  const { error, saving, save: run, setError } = useSaveAction()
  const [draft, setDraft] = useState<CreateTransactionDraft>({
    accountId: visibleAccounts[0]?.id ?? '',
    date: toDateInputValue(new Date()),
    amount: '',
    merchantName: '',
    originalName: '',
    categoryId: '',
    notes: '',
    isRecurring: false,
    isHidden: false,
  })
  const patch = (changes: Partial<CreateTransactionDraft>) => setDraft((current) => ({ ...current, ...changes }))

  async function save() {
    setError(null)
    const { accountId, amount, categoryId, date, isHidden, isRecurring, merchantName, notes, originalName } = draft
    if (!date) {
      setError('Enter a date.')
      return
    }
    const parsedAmount = Number(amount)
    if (amount.trim() === '' || !Number.isFinite(parsedAmount)) {
      setError('Enter a valid amount.')
      return
    }
    if (!merchantName.trim() && !originalName.trim()) {
      setError('Enter a merchant or original name.')
      return
    }

    let created: Transaction | undefined
    await run(async () => {
      const result = await createTransaction({ input: { accountId, date, amount: parsedAmount, merchantName: merchantName.trim() || null, originalName: originalName.trim() || null, categoryId: categoryId || null, notes: notes.trim() || null, isRecurring, isHidden } })
      created = result.data?.createTransaction.transaction
      if (!result.error && !created) throw new Error('Transaction was not created.')
      return result
    }, () => { if (created) onCreated(created) })
  }

  return { draft, error, patch, save, saving, visibleAccounts }
}
