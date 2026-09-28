import { useId, useState, type ReactNode } from 'react'
import type { Account, Category, Tag } from '../../types/graphql'
import { accountDisplayLabel } from '../../utils/accounts'
import { FormError } from '../common/FormControls'
import { MobileFilterFooter } from '../common/MobileFilterFooter'
import { MobileSheet } from '../common/MobileFilterDropdown'
import { SheetAccordionRow, SheetField, SheetPickList, SheetToggleRow } from '../common/SheetRows'
import { SheetTabButtons, SheetTabPanel } from '../common/SheetTabs'
import { CategoryTag } from '../common/Tag'
import { useSheetSections } from '../common/useSheetSections'
import { CategoryPickList } from './CategoryPickList'
import { TagPickList } from './TagPickList'
import type { RuleFormFieldsState } from './useRuleFormFields'

type Tab = 'filters' | 'changes'
type Section = 'merchantPattern' | 'originalPattern' | 'amountMin' | 'amountMax' | 'priority' | 'accounts' | 'merchantName' | 'category' | 'tags'

const TAB_ITEMS: Array<{ id: Tab; children: string }> = [{ id: 'filters', children: 'Filters' }, { id: 'changes', children: 'Changes' }]

export function RuleSheet({ accounts, applyRetroactively, canSubmit, categories, danger, disabled = false, error, fields, includePriority = false, onClose, onSubmit, saving, setApplyRetroactively, submitLabel, tags, title }: {
  accounts: Account[]
  applyRetroactively: boolean
  canSubmit: boolean
  categories: Category[]
  danger?: ReactNode
  disabled?: boolean
  error: string | null
  fields: RuleFormFieldsState
  includePriority?: boolean
  onClose: () => void
  onSubmit: () => Promise<void>
  saving: boolean
  setApplyRetroactively: (value: boolean) => void
  submitLabel: string
  tags: Tag[]
  title: string
}) {
  const tabsId = useId()
  const [tab, setTab] = useState<Tab>('filters')
  const { open, pickOne, toggle } = useSheetSections<Section>()
  const visibleAccounts = accounts.filter((account) => !account.hidden)
  const category = categories.find((item) => item.id === fields.categoryId)
  const tagNames = tags.filter((tag) => fields.tagIds.includes(tag.id)).map((tag) => tag.name)
  const footer = <MobileFilterFooter primaryDisabled={saving || disabled || !canSubmit} primaryLabel={saving ? 'Saving…' : submitLabel} onPrimary={() => { void onSubmit() }} />

  return (
    <MobileSheet bodyClassName="pb-2" footer={footer} hideClose labelledBy="rule-sheet-title" maxHeight="84%" onClose={onClose} title={title}>
      <SheetTabButtons ariaLabel="Rule sections" idPrefix={tabsId} items={TAB_ITEMS} onChange={setTab} value={tab} />
      {error ? <FormError className="my-3">{error}</FormError> : null}
      {tab === 'filters' ? (
        <SheetTabPanel idPrefix={tabsId} tabId="filters">
          <SheetField expanded={open === 'merchantPattern'} label="Merchant pattern" onChange={fields.setMerchantPattern} onToggle={toggle('merchantPattern')} placeholder="Merchant name pattern" value={fields.merchantPattern} />
          <SheetField expanded={open === 'originalPattern'} label="Original name pattern" onChange={fields.setOriginalPattern} onToggle={toggle('originalPattern')} placeholder="Original transaction name pattern" value={fields.originalPattern} />
          <SheetField expanded={open === 'amountMin'} inputMode="decimal" label="Amount min" onChange={fields.setAmountMin} onToggle={toggle('amountMin')} placeholder="0.00" type="number" value={fields.amountMin} />
          <SheetField expanded={open === 'amountMax'} inputMode="decimal" label="Amount max" onChange={fields.setAmountMax} onToggle={toggle('amountMax')} placeholder="0.00" type="number" value={fields.amountMax} />
          {includePriority ? <SheetField expanded={open === 'priority'} label="Priority" onChange={fields.setPriority} onToggle={toggle('priority')} placeholder="0" type="number" value={fields.priority} /> : null}
          <SheetAccordionRow expanded={open === 'accounts'} label="Accounts" onToggle={toggle('accounts')} summary={fields.accountIds.length ? `${fields.accountIds.length} selected` : 'All accounts'}>
            <SheetPickList options={visibleAccounts.map((account) => ({ id: account.id, label: accountDisplayLabel(account) }))} selectedIds={fields.accountIds} selectionMode="multi" onChange={fields.setAccountIds} />
          </SheetAccordionRow>
        </SheetTabPanel>
      ) : (
        <SheetTabPanel idPrefix={tabsId} tabId="changes">
          <SheetField expanded={open === 'merchantName'} label="Merchant name" onChange={fields.setMerchantName} onToggle={toggle('merchantName')} placeholder="Replace merchant name" value={fields.merchantName} />
          <SheetAccordionRow expanded={open === 'category'} label="Category" onToggle={toggle('category')} summary={category ? <CategoryTag category={category} /> : 'No change'}>
            <CategoryPickList categories={categories} noneLabel="No change" onChange={pickOne(fields.setCategoryId)} selectedId={fields.categoryId} />
          </SheetAccordionRow>
          <SheetAccordionRow expanded={open === 'tags'} label="Tags" onToggle={toggle('tags')} summary={tagNames.length ? tagNames.join(', ') : 'None'}>
            <TagPickList onChange={fields.setTagIds} selectedIds={fields.tagIds} tags={tags} />
          </SheetAccordionRow>
          <SheetToggleRow checked={fields.shouldHide} description="Matching transactions will be hidden from reports and transaction lists." label="Hide matching transactions" onChange={fields.setShouldHide} />
          <SheetToggleRow checked={applyRetroactively} label="Apply retroactively" onChange={setApplyRetroactively} />
        </SheetTabPanel>
      )}
      {danger}
    </MobileSheet>
  )
}
