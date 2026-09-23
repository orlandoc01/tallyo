import { useState, type ReactNode } from 'react'
import { useAccounts, useCategoryGroups, useTags } from '../../hooks/useEntityQueries'
import type { TransactionSort, TransactionsFilter } from '../../types/graphql'
import { CollapsibleFilterSection } from '../common/CollapsibleFilterSection'
import { CheckboxField } from '../common/FormControls'
import { MobileFilterDropdown } from '../common/MobileFilterDropdown'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { selectionSummary } from '../common/filterSummary'
import { CreateRuleModal } from './CreateRuleModal'
import { AmountFilterOptions, SortOptions, TagFilterOptions, TextFilterFields } from './TransactionFilterOptions'
import { AccountSection, CategorySection, DateSection, OwnerSection, ShowHiddenRow } from './TransactionFilterSections'
import { SORT_OPTIONS, amountSummary, sortId } from './transactionFilterPresets'

type Section = 'date' | 'category' | 'account' | 'owner' | 'amount' | 'tags' | 'sort' | 'text'

// Filter and sort edits are staged locally until Apply; the sheet unmounts
// when closed, so the staged state resets naturally.
export function TransactionsMobileFilters({ filter, now, onApply, onClear, onClose, onRuleCreated, sort }: {
  filter: TransactionsFilter
  now: Date
  onApply: (filter: TransactionsFilter, sort: TransactionSort) => void
  onClear: () => void
  onClose: () => void
  onRuleCreated: () => void
  sort: TransactionSort
}) {
  const { accounts } = useAccounts()
  const { categoryGroups } = useCategoryGroups()
  const { tags } = useTags()
  const [pending, setPending] = useState(filter)
  const [pendingSort, setPendingSort] = useState(sort)
  const [open, setOpen] = useState<Section | null>(null)
  const [isCreateRuleOpen, setIsCreateRuleOpen] = useState(false)
  const toggle = (section: Section) => () => setOpen((current) => current === section ? null : section)
  const sectionProps = (id: Section) => ({ expanded: open === id, filter: pending, onChange: setPending, onToggle: toggle(id) })
  const section = (id: Section, label: string, active: boolean, summary: string | undefined, children: ReactNode) => (
    <CollapsibleFilterSection active={active} expanded={open === id} label={label} summary={summary} onToggle={toggle(id)}>{children}</CollapsibleFilterSection>
  )

  return (
    <MobileFilterDropdown
      footer={<MobileFilterFooter onPrimary={() => onApply(pending, pendingSort)} onSecondary={() => setIsCreateRuleOpen(true)} secondaryLabel="Create rule" secondaryVariant="outline-accent" />}
      labelledBy="transaction-filters-title"
      onClear={onClear}
      onClose={onClose}
    >
      <DateSection {...sectionProps('date')} now={now} />
      <CategorySection {...sectionProps('category')} />
      <AccountSection {...sectionProps('account')} />
      <OwnerSection {...sectionProps('owner')} />
      {section('amount', 'Amount', Boolean(amountSummary(pending)), amountSummary(pending), <AmountFilterOptions filter={pending} onChange={setPending} />)}
      {section('tags', 'Tags', Boolean(pending.tagIds?.length || pending.untagged), pending.untagged ? 'Untagged' : selectionSummary(pending.tagIds ?? [], (id) => tags.find((tag) => tag.id === id)?.name), <TagFilterOptions filter={pending} onChange={setPending} tags={tags} />)}
      {section('sort', 'Sort', sortId(pendingSort) !== SORT_OPTIONS[0].id, SORT_OPTIONS.find((option) => option.id === sortId(pendingSort))?.label, <SortOptions onSortChange={setPendingSort} sort={pendingSort} />)}
      {section('text', 'Text', Boolean(pending.merchantPrefix || pending.originalPrefix), pending.merchantPrefix || pending.originalPrefix || undefined, <div className="pb-2"><TextFilterFields filter={pending} onChange={setPending} /></div>)}
      <ShowHiddenRow filter={pending} onChange={setPending} />
      <div className="flex min-h-[52px] items-center border-t border-border">
        <CheckboxField checked={pending.excludeTransfers === true} label="Exclude transfers" onChange={(value) => setPending({ ...pending, excludeTransfers: value || undefined })} />
      </div>
      {isCreateRuleOpen ? (
        <CreateRuleModal accounts={accounts} categoryGroups={categoryGroups} filter={pending} onClose={() => setIsCreateRuleOpen(false)} onCreated={onRuleCreated} />
      ) : null}
    </MobileFilterDropdown>
  )
}
