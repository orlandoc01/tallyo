import type { Account, Category, Tag } from '../../types/graphql'
import { checkboxClass, SectionLabel, TextField } from '../common/FormControls'
import { ScrollFadeBox } from '../common/ScrollFadeBox'
import { ToggleSettingRow } from '../common/ToggleSwitch'
import { AccountCheckboxList } from './AccountCheckboxList'
import { CategorySelect } from './CategorySelect'
import type { RuleFormFieldsState } from './useRuleFormFields'

const sectionClass = 'rounded-md border border-border p-4'
const groupLabelClass = 'text-xs text-text-muted'

export function RuleFormFields({
  fields,
  accounts,
  categories,
  tags,
  includePriority,
}: {
  fields: RuleFormFieldsState
  accounts: Account[]
  categories: Category[]
  tags: Tag[]
  includePriority?: boolean
}) {
  function toggleTag(tagId: string) {
    fields.setTagIds(fields.tagIds.includes(tagId) ? fields.tagIds.filter((id) => id !== tagId) : [...fields.tagIds, tagId])
  }

  return (
    <>
      <section className={sectionClass}>
        <SectionLabel as="h3">Filters</SectionLabel>
        <div className="mt-3 space-y-3">
          <TextField label="Merchant pattern" onChange={fields.setMerchantPattern} placeholder="Merchant name pattern" value={fields.merchantPattern} />
          <TextField label="Original name pattern" onChange={fields.setOriginalPattern} placeholder="Original transaction name pattern" value={fields.originalPattern} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Amount min" onChange={fields.setAmountMin} step="0.01" type="number" value={fields.amountMin} />
            <TextField label="Amount max" onChange={fields.setAmountMax} step="0.01" type="number" value={fields.amountMax} />
          </div>
          {includePriority ? (
            <TextField label="Priority" min="0" onChange={fields.setPriority} type="number" value={fields.priority} />
          ) : null}
          <div>
            <div className={groupLabelClass}>Accounts</div>
            <ScrollFadeBox className="mt-1 max-h-56 rounded-md border border-border p-2">
              <AccountCheckboxList accounts={accounts} onChange={(ids) => fields.setAccountIds(ids ?? [])} selectedAccountIds={fields.accountIds} showCount />
            </ScrollFadeBox>
          </div>
        </div>
      </section>

      <section className={sectionClass}>
        <SectionLabel as="h3">Changes</SectionLabel>
        <div className="mt-3 space-y-3">
          <TextField label="Merchant name" onChange={fields.setMerchantName} placeholder="Replace merchant name" value={fields.merchantName} />

          <CategorySelect categories={categories} label="Category" onChange={fields.setCategoryId} placeholder="Choose category" value={fields.categoryId} />

          <div>
            <div className={groupLabelClass}>Tags</div>
            <div className="mt-1 max-h-36 overflow-auto rounded-md border border-border p-1.5">
              {tags.length ? tags.map((tag) => (
                <label className="flex h-8 cursor-pointer items-center gap-2 rounded-[5px] px-2 text-[13px] text-text-1 hover:bg-raised" key={tag.id}>
                  <input checked={fields.tagIds.includes(tag.id)} className={`${checkboxClass} h-4 w-4`} onChange={() => toggleTag(tag.id)} type="checkbox" />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </label>
              )) : <div className="px-2 py-1 text-[13px] text-text-muted">No tags yet.</div>}
            </div>
          </div>

          <ToggleSettingRow
            checked={fields.shouldHide}
            description="Matching transactions will be hidden from reports and transaction lists."
            onChange={fields.setShouldHide}
            title="Hide matching transactions"
          />
        </div>
      </section>
    </>
  )
}
