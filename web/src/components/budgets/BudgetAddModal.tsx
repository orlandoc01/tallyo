import { useState, type FormEvent } from 'react'
import { useBudgetMutations } from '../../hooks/useBudgets'
import { useSaveAction } from '../../hooks/useSaveAction'
import type { Category } from '../../types/graphql'
import { FormError, SelectField, TextField } from '../common/FormControls'
import { Modal, ModalActions } from '../common/Modal'
import { ModalTitleRow } from '../common/ModalHeader'

export function BudgetAddModal({ categories, month, onClose, onSaved }: {
  categories: Category[]
  month: string
  onClose: () => void
  onSaved: () => void
}) {
  const { setBudget } = useBudgetMutations()
  const { error, save, saving } = useSaveAction()
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const parsedAmount = Number.parseFloat(amount)
  const valid = categoryId !== '' && Number.isFinite(parsedAmount) && parsedAmount >= 0

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!valid) return
    void save(() => setBudget({ input: { month, categoryId, amount: parsedAmount } }), onSaved)
  }

  return (
    <Modal label="Add budget" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <ModalTitleRow title="Add budget" onClose={onClose} />
        <div className="mt-4 space-y-3">
          <SelectField
            label="Category"
            onChange={setCategoryId}
            options={categories.map((category) => ({ label: `${category.emoji} ${category.name}`, value: category.id }))}
            value={categoryId}
          />
          <TextField inputMode="decimal" label="Amount" onChange={setAmount} placeholder="0.00" value={amount} />
        </div>
        {error ? <FormError className="mt-3">{error}</FormError> : null}
        <ModalActions busy={saving} className="mt-6" disabled={!valid || saving} onCancel={onClose} submitLabel="Save budget" />
      </form>
    </Modal>
  )
}
