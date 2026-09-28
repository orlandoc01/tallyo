import { useState, type FormEvent } from 'react'
import { useBudgetMutations } from '../../hooks/useBudgets'
import { useIsMobile } from '../../hooks/useIsMobile'
import { useSaveAction } from '../../hooks/useSaveAction'
import type { Category } from '../../types/graphql'
import { FormError, SelectField, TextField } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { Modal, ModalActions } from '../common/Modal'
import { ModalTitleRow } from '../common/ModalHeader'
import { SheetAccordionRow, SheetField } from '../common/SheetRows'
import { useSheetSections } from '../common/useSheetSections'
import { CategoryPickList } from '../transactions/CategoryPickList'

type Section = 'category' | 'amount'

interface BudgetAddFormProps {
  amount: string
  categories: Category[]
  categoryId: string
  error: string | null
  onClose: () => void
  onSubmit: () => void
  saving: boolean
  setAmount: (value: string) => void
  setCategoryId: (value: string) => void
  valid: boolean
}

function BudgetAddSheet({ amount, categories, categoryId, error, onClose, onSubmit, saving, setAmount, setCategoryId, valid }: BudgetAddFormProps) {
  const { open, pickOne, toggle } = useSheetSections<Section>()
  const selected = categories.find((category) => category.id === categoryId)
  const footer = <MobileFilterFooter primaryDisabled={!valid || saving} primaryLabel={saving ? 'Saving…' : 'Save budget'} onPrimary={onSubmit} />

  return (
    <MobileSheet bodyClassName="pb-2" footer={footer} hideClose labelledBy="budget-add-sheet-title" maxHeight="84%" onClose={onClose} title="Add budget">
      {error ? <FormError className="mb-3">{error}</FormError> : null}
      <SheetAccordionRow expanded={open === 'category'} label="Category" onToggle={toggle('category')} summary={selected ? `${selected.emoji} ${selected.name}` : 'Choose category'}>
        <CategoryPickList categories={categories} onChange={pickOne(setCategoryId)} selectedId={categoryId} />
      </SheetAccordionRow>
      <SheetField expanded={open === 'amount'} inputMode="decimal" label="Amount" onChange={setAmount} onToggle={toggle('amount')} placeholder="0.00" type="number" value={amount} />
    </MobileSheet>
  )
}

export function BudgetAddModal({ categories, month, onClose, onSaved }: {
  categories: Category[]
  month: string
  onClose: () => void
  onSaved: () => void
}) {
  const isMobile = useIsMobile()
  const { setBudget } = useBudgetMutations()
  const { error, save, saving } = useSaveAction()
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '')
  const [amount, setAmount] = useState('')
  const parsedAmount = Number.parseFloat(amount)
  const valid = categoryId !== '' && Number.isFinite(parsedAmount) && parsedAmount >= 0

  function submit() {
    if (!valid) return
    void save(() => setBudget({ input: { month, categoryId, amount: parsedAmount } }), onSaved)
  }

  if (isMobile) {
    return <BudgetAddSheet amount={amount} categories={categories} categoryId={categoryId} error={error} onClose={onClose} onSubmit={submit} saving={saving} setAmount={setAmount} setCategoryId={setCategoryId} valid={valid} />
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    submit()
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
