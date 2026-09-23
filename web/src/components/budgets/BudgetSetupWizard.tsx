import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { CategorySelect } from '../transactions/CategorySelect'
import { formatCurrency } from '../../utils/currency'
import type { Category } from '../../types/graphql'
import { Button } from '../common/Button'
import { Card, TextField } from '../common/FormControls'

export function FirstBudgetIntro({ onStart }: { onStart: () => void }) {
  return (
    <Card as="section" padded>
      <p className="text-[11px] uppercase tracking-[0.6px] text-text-muted">First budget</p>
      <h2 className="mt-1 text-lg font-semibold tracking-[-0.2px] text-text-1">Set up your first monthly budget</h2>
      <p className="mt-2 max-w-2xl text-[13px] text-text-2">
        Build a starting plan from last month&apos;s income and expense activity, adjust the category targets, then continue to track actual results against the month.
      </p>
      <Button className="mt-4" onClick={onStart}>Setup Budget</Button>
    </Card>
  )
}

export function BudgetSetupWizard({
  categories,
  drafts,
  included,
  isFirstBudget,
  lastMonthActuals,
  onAddCategory,
  onCancel,
  onChangeAmount,
  onContinue,
  onRemoveCategory,
  saving,
}: {
  categories: Category[]
  drafts: Record<string, string>
  included: Set<string>
  isFirstBudget: boolean
  lastMonthActuals: Map<string, number>
  onAddCategory: (categoryId: string) => void
  onCancel: () => void
  onChangeAmount: (categoryId: string, value: string) => void
  onContinue: () => void
  onRemoveCategory: (categoryId: string) => void
  saving: boolean
}) {
  const includedCategories = categories.filter((category) => included.has(category.id))
  const availableCategories = categories.filter((category) => !included.has(category.id))
  const [categoryToAdd, setCategoryToAdd] = useState('')

  function addSelectedCategory() {
    const categoryId = categoryToAdd
    if (!categoryId) return
    onAddCategory(categoryId)
    setCategoryToAdd('')
  }

  return (
    <Card as="section">
      <div className="px-4 py-4">
        <h2 className="text-sm font-semibold text-text-1">
          {isFirstBudget ? 'Review your starting targets' : 'Review budget targets'}
        </h2>
        <p className="mt-1 text-[13px] text-text-muted">Prefilled from last month&apos;s income and expenses. Remove categories you do not want to budget yet.</p>
      </div>
      {includedCategories.map((category) => {
        const actual = lastMonthActuals.get(category.id) ?? 0
        return (
          <div className="grid gap-3 border-t border-border px-4 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center" key={category.id}>
            <div className="flex min-w-0 items-center gap-2">
              <span aria-hidden>{category.emoji}</span>
              <span className="truncate text-sm font-medium text-text-1">{category.name}</span>
            </div>
            <div className="text-[13px] text-text-muted sm:text-right">Last month: {formatCurrency(actual)}</div>
            <div className="flex items-center gap-2">
              <TextField
                className="w-28"
                controlClassName="text-right"
                hideLabel
                inputMode="decimal"
                label={`Budget amount for ${category.name}`}
                onChange={(value) => onChangeAmount(category.id, value)}
                value={drafts[category.id] ?? '0.00'}
              />
              <Button aria-label={`Remove ${category.name}`} onClick={() => onRemoveCategory(category.id)} size="sm" variant="ghost">
                <Trash2 aria-hidden className="h-4 w-4 text-text-muted" />
              </Button>
            </div>
          </div>
        )
      })}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-4">
        <div className="min-w-0 flex-1 sm:max-w-sm">
          <CategorySelect
            categories={availableCategories}
            label="Add category"
            onChange={setCategoryToAdd}
            placeholder="Add category"
            value={categoryToAdd}
          />
        </div>
        <Button disabled={!categoryToAdd} onClick={addSelectedCategory} variant="secondary">
          <Plus aria-hidden className="h-4 w-4" />
          Add
        </Button>
        <div className="flex items-center gap-2">
          <Button onClick={onCancel} variant="secondary">Cancel</Button>
          <Button disabled={saving || included.size === 0} onClick={onContinue}>Continue</Button>
        </div>
      </div>
    </Card>
  )
}
