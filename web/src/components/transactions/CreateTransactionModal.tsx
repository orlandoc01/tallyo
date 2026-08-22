import { useState, type FormEvent } from 'react'
import { useMutation } from 'urql'
import { FormError, SelectField, TextAreaField, TextField } from '../common/FormControls'
import { Modal, ModalActions, ModalFooter } from '../common/Modal'
import { ModalCloseButton } from '../common/ModalHeader'
import { useSaveAction } from '../../hooks/useSaveAction'
import { CREATE_TRANSACTION_MUTATION } from '../../graphql/mutations'
import type { Account, Category, CreateTransactionInput, CreateTransactionPayload, Transaction } from '../../types/graphql'
import { accountDisplayLabel } from '../../utils/accounts'
import { toDateInputValue } from '../../utils/dates'
import { ToggleRow } from './ToggleRow'

export function CreateTransactionModal({
  accounts,
  categories,
  onClose,
  onCreated,
}: {
  accounts: Account[]
  categories: Category[]
  onClose: () => void
  onCreated: (transaction: Transaction) => void
}) {
  const visibleAccounts = accounts.filter((account) => !account.hidden)
  const [, createTransaction] = useMutation<{ createTransaction: CreateTransactionPayload }, { input: CreateTransactionInput }>(CREATE_TRANSACTION_MUTATION)
  const { error, saving, save, setError } = useSaveAction()
  const [accountId, setAccountId] = useState(visibleAccounts[0]?.id ?? '')
  const [date, setDate] = useState(toDateInputValue(new Date()))
  const [amount, setAmount] = useState('')
  const [merchantName, setMerchantName] = useState('')
  const [originalName, setOriginalName] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [notes, setNotes] = useState('')
  const [isRecurring, setIsRecurring] = useState(false)
  const [isHidden, setIsHidden] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

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
    await save(async () => {
      const result = await createTransaction({ input: { accountId, date, amount: parsedAmount, merchantName: merchantName.trim() || null, originalName: originalName.trim() || null, categoryId: categoryId || null, notes: notes.trim() || null, isRecurring, isHidden } })
      created = result.data?.createTransaction.transaction
      if (!result.error && !created) throw new Error('Transaction was not created.')
      return result
    }, () => { if (created) onCreated(created) })
  }

  return (
    <Modal label="Create transaction" onClose={onClose} scrollable size="lg">
      <form className="space-y-5" noValidate onSubmit={handleSubmit}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-neutral-950">Create transaction</h2>
            <p className="text-sm text-neutral-500">Manual transactions receive a server-generated ID.</p>
          </div>
          <ModalCloseButton label="Close create transaction" onClick={onClose} />
        </div>

        {error ? <FormError>{error}</FormError> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField className="sm:col-span-2" disabled={visibleAccounts.length === 0} label="Account" onChange={setAccountId} options={visibleAccounts.map((account) => ({ label: accountDisplayLabel(account), value: account.id }))} required value={accountId} />
          <TextField label="Date" onChange={setDate} required type="date" value={date} />
          <TextField inputMode="decimal" label="Amount" onChange={setAmount} placeholder="42.50" required step="0.01" type="number" value={amount} />
          <TextField label="Merchant" onChange={setMerchantName} placeholder="Coffee Shop" value={merchantName} />
          <TextField label="Original name" onChange={setOriginalName} placeholder="POS COFFEE SHOP" value={originalName} />
          <SelectField
            className="sm:col-span-2"
            label="Category"
            onChange={setCategoryId}
            options={[{ label: 'Uncategorized', value: '' }, ...categories.map((category) => ({ label: `${category.emoji} ${category.groupName} / ${category.name}`, value: category.id }))]}
            value={categoryId}
          />
        </div>

        <p className="text-xs text-neutral-500">Use positive amounts for spending and negative amounts for refunds or credits.</p>

        <div className="space-y-2 border-t border-neutral-100 pt-4">
          <ToggleRow label="Hidden" onChange={setIsHidden} value={isHidden} />
          <ToggleRow label="Recurring" onChange={setIsRecurring} value={isRecurring} />
        </div>

        <TextAreaField label="Notes" onChange={setNotes} rows={3} value={notes} />

        {visibleAccounts.length === 0 ? <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">Add an account before creating transactions.</div> : null}

        <ModalFooter>
          <ModalActions busy={saving} busyLabel="Creating..." disabled={saving || visibleAccounts.length === 0} onCancel={onClose} submitLabel="Create transaction" />
        </ModalFooter>
      </form>
    </Modal>
  )
}
