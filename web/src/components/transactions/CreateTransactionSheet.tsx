import type { Category } from '../../types/graphql'
import { accountDisplayLabel } from '../../utils/accounts'
import { FormError, FormWarning } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { SheetAccordionRow, SheetField, SheetPickList, SheetToggleRow } from '../common/SheetRows'
import { CategoryTag } from '../common/Tag'
import { useSheetSections } from '../common/useSheetSections'
import { CategoryPickList } from './CategoryPickList'
import type { useCreateTransactionForm } from './useCreateTransactionForm'

type Section = 'account' | 'date' | 'amount' | 'merchant' | 'original' | 'category' | 'notes'

export function CreateTransactionSheet({ categories, form, onClose }: {
  categories: Category[]
  form: ReturnType<typeof useCreateTransactionForm>
  onClose: () => void
}) {
  const { open, pickOne, toggle } = useSheetSections<Section>()
  const { draft, patch, visibleAccounts } = form
  const account = visibleAccounts.find((item) => item.id === draft.accountId)
  const category = categories.find((item) => item.id === draft.categoryId)
  const footer = (
    <MobileFilterFooter
      primaryDisabled={form.saving || visibleAccounts.length === 0}
      primaryLabel={form.saving ? 'Creating…' : 'Create transaction'}
      onPrimary={() => { void form.save() }}
    />
  )

  return (
    <MobileSheet bodyClassName="pb-2" footer={footer} hideClose labelledBy="create-transaction-sheet-title" maxHeight="84%" onClose={onClose} title="New transaction">
      {form.error ? <FormError className="mb-3">{form.error}</FormError> : null}
      <SheetAccordionRow expanded={open === 'account'} label="Account" onToggle={toggle('account')} summary={account ? accountDisplayLabel(account) : 'Choose account'}>
        <SheetPickList options={visibleAccounts.map((item) => ({ id: item.id, label: accountDisplayLabel(item) }))} selectedIds={[draft.accountId]} onChange={pickOne((accountId) => patch({ accountId }))} />
      </SheetAccordionRow>
      <SheetField expanded={open === 'date'} label="Date" onChange={(date) => patch({ date })} onToggle={toggle('date')} placeholder="YYYY-MM-DD" type="date" value={draft.date} />
      <SheetField expanded={open === 'amount'} inputMode="decimal" label="Amount" onChange={(amount) => patch({ amount })} onToggle={toggle('amount')} placeholder="42.50" type="number" value={draft.amount} />
      <SheetField expanded={open === 'merchant'} label="Merchant" onChange={(merchantName) => patch({ merchantName })} onToggle={toggle('merchant')} placeholder="Coffee Shop" value={draft.merchantName} />
      <SheetField expanded={open === 'original'} label="Original name" onChange={(originalName) => patch({ originalName })} onToggle={toggle('original')} placeholder="POS COFFEE SHOP" value={draft.originalName} />
      <SheetAccordionRow expanded={open === 'category'} label="Category" onToggle={toggle('category')} summary={category ? <CategoryTag category={category} /> : 'Uncategorized'}>
        <CategoryPickList categories={categories} noneLabel="Uncategorized" onChange={pickOne((categoryId) => patch({ categoryId }))} selectedId={draft.categoryId} />
      </SheetAccordionRow>
      <SheetField expanded={open === 'notes'} label="Notes" multiline onChange={(notes) => patch({ notes })} onToggle={toggle('notes')} placeholder="Add a note" value={draft.notes} />
      <SheetToggleRow checked={draft.isHidden} label="Hidden" onChange={(isHidden) => patch({ isHidden })} />
      <SheetToggleRow checked={draft.isRecurring} label="Recurring" onChange={(isRecurring) => patch({ isRecurring })} />
      <p className="py-3 text-xs text-text-3">Use positive amounts for spending and negative amounts for refunds or credits.</p>
      {visibleAccounts.length === 0 ? <FormWarning className="mb-3">Add an account before creating transactions.</FormWarning> : null}
    </MobileSheet>
  )
}
