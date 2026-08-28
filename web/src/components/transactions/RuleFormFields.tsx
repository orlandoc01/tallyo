import type { Account, Category, Tag } from '../../types/graphql'
import { TextField } from '../common/FormControls'
import { ToggleSettingRow } from '../common/ToggleSwitch'
import { AccountCheckboxList } from './AccountCheckboxList'
import { CategorySelect } from './CategorySelect'
import type { RuleFormFieldsState } from './useRuleFormFields'

const inputClassName = 'mt-2 w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-500'

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
      <section className="rounded-2xl border border-neutral-100 p-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-500">Filters</h3>
        <div className="mt-4 space-y-4">
          <label className="block text-sm font-semibold text-neutral-950">
            Merchant pattern
            <input
              aria-label="Merchant pattern"
              className={inputClassName}
              onChange={(event) => fields.setMerchantPattern(event.target.value)}
              placeholder="Merchant name pattern"
              value={fields.merchantPattern}
            />
          </label>

          <label className="block text-sm font-semibold text-neutral-950">
            Original name pattern
            <input
              aria-label="Original name pattern"
              className={inputClassName}
              onChange={(event) => fields.setOriginalPattern(event.target.value)}
              placeholder="Original transaction name pattern"
              value={fields.originalPattern}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-neutral-950">
              Amount min
              <input
                aria-label="Amount min"
                className={inputClassName}
                onChange={(event) => fields.setAmountMin(event.target.value)}
                step="0.01"
                type="number"
                value={fields.amountMin}
              />
            </label>
            <label className="block text-sm font-semibold text-neutral-950">
              Amount max
              <input
                aria-label="Amount max"
                className={inputClassName}
                onChange={(event) => fields.setAmountMax(event.target.value)}
                step="0.01"
                type="number"
                value={fields.amountMax}
              />
            </label>
          </div>

          {includePriority ? (
            <label className="block text-sm font-semibold text-neutral-950">
              Priority
              <input
                aria-label="Priority"
                className={inputClassName}
                min="0"
                onChange={(event) => fields.setPriority(event.target.value)}
                type="number"
                value={fields.priority}
              />
            </label>
          ) : null}

          <div>
            <div className="text-sm font-semibold text-neutral-950">Accounts</div>
            <div className="mt-2 max-h-32 overflow-auto rounded-xl border border-neutral-100 p-2">
              <AccountCheckboxList accounts={accounts} onChange={(ids) => fields.setAccountIds(ids ?? [])} selectedAccountIds={fields.accountIds} />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-neutral-100 p-4">
        <h3 className="text-sm font-bold uppercase tracking-wide text-neutral-500">Changes</h3>
        <div className="mt-4 space-y-4">
          <TextField label="Merchant name" onChange={fields.setMerchantName} placeholder="Replace merchant name" value={fields.merchantName} />

          <CategorySelect categories={categories} label="Category" onChange={fields.setCategoryId} placeholder="Choose category" value={fields.categoryId} />

          <div>
            <div className="text-sm font-semibold text-neutral-950">Tags</div>
            <div className="mt-2 max-h-36 space-y-1 overflow-auto rounded-xl border border-neutral-100 p-2">
              {tags.length ? tags.map((tag) => (
                <label key={tag.id} className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1 text-sm text-neutral-700 hover:bg-neutral-50">
                  <input checked={fields.tagIds.includes(tag.id)} onChange={() => toggleTag(tag.id)} type="checkbox" />
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                  {tag.name}
                </label>
              )) : <div className="px-2 py-1 text-sm text-neutral-500">No tags yet.</div>}
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
