import type { Account, Category, CategoryGroup, Transaction, TransactionsFilter } from '../../types/graphql'
import { ActionSheet } from '../common/ActionSheet'
import { CreateRuleModal } from './CreateRuleModal'
import { CreateTransactionModal } from './CreateTransactionModal'

export type CreateStep = 'chooser' | 'transaction' | 'rule' | null

// The mobile "+ Create" entry point: an action sheet chooser first, then the
// existing transaction or rule modal. Desktop opens the transaction modal directly.
export function TransactionsCreateFlow({ accounts, categories, categoryGroups, filter, onCreated, onRuleCreated, onStepChange, step }: {
  accounts: Account[]
  categories: Category[]
  categoryGroups: CategoryGroup[]
  filter: TransactionsFilter
  onCreated: (transaction: Transaction) => void
  onRuleCreated: () => void
  onStepChange: (step: CreateStep) => void
  step: CreateStep
}) {
  const close = () => onStepChange(null)
  if (step === 'chooser') {
    return (
      <ActionSheet
        items={[
          { label: 'Transaction', onSelect: () => onStepChange('transaction') },
          { label: 'Rule', onSelect: () => onStepChange('rule') },
        ]}
        onClose={close}
        title="Create"
      />
    )
  }
  if (step === 'transaction') return <CreateTransactionModal accounts={accounts} categories={categories} onClose={close} onCreated={onCreated} />
  if (step === 'rule') return <CreateRuleModal accounts={accounts} categoryGroups={categoryGroups} filter={filter} onClose={close} onCreated={onRuleCreated} />
  return null
}
