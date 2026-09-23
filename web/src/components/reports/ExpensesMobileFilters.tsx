import { useState } from 'react'
import { useAccounts, useCategoryGroups } from '../../hooks/useEntityQueries'
import type { TransactionsFilter } from '../../types/graphql'
import { MobileFilterDropdown } from '../common/MobileFilterDropdown'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { CreateRuleModal } from '../transactions/CreateRuleModal'
import { AccountSection, CategorySection, DateSection, OwnerSection, ShowHiddenRow } from '../transactions/TransactionFilterSections'
import { dateRangeSummary } from '../transactions/transactionFilterPresets'

type Section = 'date' | 'category' | 'account' | 'owner'

export function ExpensesMobileFilters({ filter, isDateFiltered, now, onApply, onClear, onClose, onRuleCreated, showDate }: {
  filter: TransactionsFilter
  isDateFiltered: (filter: TransactionsFilter) => boolean
  now: Date
  onApply: (filter: TransactionsFilter) => void
  onClear: () => void
  onClose: () => void
  onRuleCreated: () => void
  showDate: boolean
}) {
  const { accounts } = useAccounts()
  const { categoryGroups } = useCategoryGroups()
  const [pending, setPending] = useState(filter)
  const [open, setOpen] = useState<Section | null>(null)
  const [isCreateRuleOpen, setIsCreateRuleOpen] = useState(false)
  const toggle = (section: Section) => () => setOpen((current) => current === section ? null : section)
  const sectionProps = (id: Section) => ({ expanded: open === id, filter: pending, onChange: setPending, onToggle: toggle(id) })
  const dateFiltered = isDateFiltered(pending)

  return (
    <MobileFilterDropdown
      footer={<MobileFilterFooter onPrimary={() => onApply(pending)} onSecondary={() => setIsCreateRuleOpen(true)} secondaryLabel="Create rule" secondaryVariant="outline-accent" />}
      labelledBy="expenses-filters-title"
      onClear={onClear}
      onClose={onClose}
    >
      {showDate ? <DateSection {...sectionProps('date')} active={dateFiltered} now={now} summary={dateRangeSummary(pending, now) ?? (dateFiltered ? 'All time' : undefined)} /> : null}
      <CategorySection {...sectionProps('category')} />
      <AccountSection {...sectionProps('account')} />
      <OwnerSection {...sectionProps('owner')} />
      <ShowHiddenRow filter={pending} onChange={setPending} />
      {isCreateRuleOpen ? (
        <CreateRuleModal accounts={accounts} categoryGroups={categoryGroups} filter={pending} onClose={() => setIsCreateRuleOpen(false)} onCreated={onRuleCreated} />
      ) : null}
    </MobileFilterDropdown>
  )
}
