import { useState } from 'react'
import { Copy, Plus, Settings, Trash2 } from 'lucide-react'
import { format, parse } from 'date-fns'
import { CategorySelect } from '../transactions/CategorySelect'
import { formatCurrency } from '../../utils/currency'
import type { Category } from '../../types/graphql'

export function FirstBudgetIntro({ onStart }: { onStart: () => void }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-brand-200 bg-gradient-to-br from-brand-50 via-white to-emerald-50 p-6 shadow-sm dark:border-brand-900/60 dark:from-brand-950/30 dark:via-neutral-900 dark:to-emerald-950/20">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">First budget</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight text-neutral-950 dark:text-neutral-50">Set up your first monthly budget</h2>
        <p className="mt-3 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
          Build a starting plan from last month&apos;s income and expense activity, adjust the category targets, then continue to track actual results against the month.
        </p>
        <button
          className="mt-5 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700"
          onClick={onStart}
          type="button"
        >
          Setup Budget
        </button>
      </div>
    </section>
  )
}

export function EmptyMonthOptions({
  availableMonths,
  copying,
  copyFromMonth,
  onCopy,
  onCopyFromMonthChange,
  onSetup,
}: {
  availableMonths: string[]
  copying: boolean
  copyFromMonth: string
  onCopy: () => void
  onCopyFromMonthChange: (month: string) => void
  onSetup: () => void
}) {
  function formatMonthLabel(month: string) {
    try {
      return format(parse(month, 'yyyy-MM', new Date()), 'MMMM yyyy')
    } catch {
      return month
    }
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="max-w-2xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="inline-flex items-center gap-2 rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={copying || !copyFromMonth}
            onClick={onCopy}
            type="button"
          >
            <Copy aria-hidden className="h-4 w-4" />
            Copy month
          </button>
          {availableMonths.length > 0 && (
            <select
              className="rounded-full border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 shadow-sm focus:border-brand-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
              onChange={(e) => onCopyFromMonthChange(e.target.value)}
              value={copyFromMonth}
            >
              {availableMonths.map((month) => (
                <option key={month} value={month}>
                  {formatMonthLabel(month)}
                </option>
              ))}
            </select>
          )}
        </div>
        <div>
          <button
            className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-5 py-2.5 text-sm font-semibold text-neutral-700 shadow-sm hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
            onClick={onSetup}
            type="button"
          >
            <Settings aria-hidden className="h-4 w-4" />
            Setup
          </button>
        </div>
      </div>
    </section>
  )
}

export function BudgetSetupWizard({
  categories,
  drafts,
  included,
  isFirstBudget,
  lastMonthActuals,
  onAddCategory,
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
    <section className="rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div className="border-b border-neutral-100 px-4 py-4 dark:border-neutral-800">
        <h2 className="text-lg font-semibold text-neutral-950 dark:text-neutral-50">
          {isFirstBudget ? 'Review your starting targets' : 'Review budget targets'}
        </h2>
        <p className="mt-1 text-sm text-neutral-500">Prefilled from last month&apos;s income and expenses. Remove categories you do not want to budget yet.</p>
      </div>
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {includedCategories.map((category) => {
          const actual = lastMonthActuals.get(category.id) ?? 0
          return (
            <div className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto_auto] sm:items-center" key={category.id}>
              <div className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="text-lg">{category.emoji}</span>
                <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{category.name}</span>
              </div>
              <div className="text-sm text-neutral-500 sm:text-right">Last month: {formatCurrency(actual)}</div>
              <div className="flex items-center gap-2">
                <label className="sr-only" htmlFor={`setup-budget-${category.id}`}>Budget amount for {category.name}</label>
                <span aria-hidden className="text-neutral-400">$</span>
                <input
                  className="w-28 rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-right text-sm tabular-nums focus:border-brand-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
                  id={`setup-budget-${category.id}`}
                  inputMode="decimal"
                  onChange={(event) => onChangeAmount(category.id, event.target.value)}
                  value={drafts[category.id] ?? '0.00'}
                />
                <button
                  aria-label={`Remove ${category.name}`}
                  className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-rose-600 dark:hover:bg-neutral-800"
                  onClick={() => onRemoveCategory(category.id)}
                  type="button"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 px-4 py-4 dark:border-neutral-800">
        <div className="min-w-0 flex-1 sm:max-w-sm">
          <CategorySelect
            categories={availableCategories}
            label="Add category"
            onChange={setCategoryToAdd}
            placeholder="Add category"
            value={categoryToAdd}
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            className="inline-flex items-center gap-1 rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800"
            disabled={!categoryToAdd}
            onClick={addSelectedCategory}
            type="button"
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
        <button
          className="rounded-full bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={saving || included.size === 0}
          onClick={onContinue}
          type="button"
        >
          Continue
        </button>
      </div>
    </section>
  )
}
