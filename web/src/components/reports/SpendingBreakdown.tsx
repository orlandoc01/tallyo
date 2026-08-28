import clsx from 'clsx'
import { BarChart3, ChevronDown, ChevronUp, PieChart as PieIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Tooltip } from 'recharts'
import { DonutChart } from '../common/DonutChart'
import { Card } from '../common/FormControls'
import { SegmentedControl } from '../common/SegmentedControl'
import type { CategorySpending, SpendingPeriod } from '../../types/domain'
import { spendingChartColor } from '../../utils/chartStyles'
import { formatCurrency, formatSignedCurrency } from '../../utils/currency'
import { type GroupBy, aggregateByGroup, topCategoriesWithEverythingElse, topNWithEverythingElse } from '../../utils/spending'
import { CategoryBar } from './CategoryBar'

export type ChartView = 'bar' | 'pie'

interface DisplayItem {
  categoryIds: string[]
  id: string
  name: string
  emoji: string
  total: number
  transactionCount: number
  percentOfTotal: number
  color: string
}

export interface SpendingCategoryFocus {
  id: string
  categoryIds: string[]
}

export function SpendingBreakdown({
  expanded,
  focusedCategoryId,
  groupBy,
  onCategoryFocusChange,
  onToggleExpanded,
  onViewChange,
  period,
  view: viewProp,
}: {
  expanded?: boolean
  focusedCategoryId?: string | null
  groupBy?: GroupBy
  onCategoryFocusChange?: (focus: SpendingCategoryFocus | null) => void
  onToggleExpanded?: () => void
  onViewChange?: (view: ChartView) => void
  period?: SpendingPeriod
  view?: ChartView
}) {
  const [internalView, setInternalView] = useState<ChartView>('bar')
  const view = viewProp ?? internalView
  function setView(v: ChartView) { setInternalView(v); onViewChange?.(v) }
  const sorted = useMemo(() => [...(period?.categories ?? [])].sort((a, b) => b.total - a.total), [period?.categories])
  const nonZeroSorted = useMemo(() => sorted.filter((item) => item.total !== 0), [sorted])

  const maxVisible = groupBy === 'group' ? 6 : 10

  const totalCount = groupBy === 'group'
    ? aggregateByGroup(nonZeroSorted).length
    : nonZeroSorted.filter((c) => c.total > 0).length

  const displayItems: DisplayItem[] = useMemo(() => {
    if (groupBy === 'group') {
      const grouped = aggregateByGroup(nonZeroSorted)
      const { visible: topVisible, everythingElse } = expanded
        ? { visible: grouped, everythingElse: null }
        : topNWithEverythingElse(grouped, maxVisible)
      const items = everythingElse ? [...topVisible] : topVisible
      const visibleGroupIDs = new Set(topVisible.map((item) => item.id))
      const categoryIDsByGroup = new Map<string, string[]>()
      for (const category of nonZeroSorted) {
        const categoryIDs = categoryIDsByGroup.get(category.category.groupName) ?? []
        categoryIDs.push(category.category.id)
        categoryIDsByGroup.set(category.category.groupName, categoryIDs)
      }
      const everythingElseCategoryIds = grouped
        .filter((item) => !visibleGroupIDs.has(item.id))
        .flatMap((item) => categoryIDsByGroup.get(item.id) ?? [])
      return items.map((item) => ({
        categoryIds: item === everythingElse ? everythingElseCategoryIds : categoryIDsByGroup.get(item.id) ?? [],
        id: item.id,
        name: item.name,
        emoji: item.emoji,
        total: item.total,
        transactionCount: item.transactionCount,
        percentOfTotal: item.percentOfTotal,
        color: spendingChartColor(item.id),
      }))
    }

    const { visible: topVisible, everythingElse } = expanded
      ? { visible: nonZeroSorted, everythingElse: null as CategorySpending | null }
      : topCategoriesWithEverythingElse(nonZeroSorted, maxVisible)
    const items = everythingElse ? [...topVisible] : topVisible
    const visibleCategoryIDs = new Set(topVisible.map((item) => item.category.id))
    const everythingElseCategoryIds = nonZeroSorted
      .filter((item) => !visibleCategoryIDs.has(item.category.id))
      .map((item) => item.category.id)
    return items.map((item) => ({
      categoryIds: item === everythingElse ? everythingElseCategoryIds : [item.category.id],
      id: item.category.id,
      name: item.category.name,
      emoji: item.category.emoji,
      total: item.total,
      transactionCount: item.transactionCount,
      percentOfTotal: item.percentOfTotal,
      color: spendingChartColor(item.category.id),
    }))
  }, [groupBy, nonZeroSorted, expanded, maxVisible])

  const maxAbsTotal = Math.max(...displayItems.map((item) => Math.abs(item.total)), 0)
  const hasFocus = focusedCategoryId !== undefined && focusedCategoryId !== null

  function toggleCategoryFocus(id: string, categoryIds: string[]) {
    onCategoryFocusChange?.(focusedCategoryId === id ? null : { id, categoryIds })
  }

  if (!period || nonZeroSorted.length === 0) {
    return <div className="p-8 text-sm text-neutral-500">No spending data for this period.</div>
  }

  const pieData = makePieData(displayItems, expanded)

  return (
    <Card as="section" overflow="visible">
      <div className="hidden flex-nowrap items-center justify-between gap-3 border-b border-neutral-100 p-5 lg:flex lg:flex-wrap">
        <p className="text-sm text-neutral-500">{period.periodStart} to {period.periodEnd}</p>
        <SegmentedControl
          ariaLabel="Spending chart view"
          options={[
            { value: 'pie', label: <><PieIcon className="h-4 w-4" />Pie</> },
            { value: 'bar', label: <><BarChart3 className="h-4 w-4" />Bars</> },
          ]}
          value={view}
          onChange={setView}
        />
      </div>

      {view === 'bar' ? (
        <div className="space-y-3 p-5">
          {displayItems.map((item) => (
            <CategoryBar
              dimmed={hasFocus && focusedCategoryId !== item.id}
              focused={focusedCategoryId === item.id}
              item={{ category: { id: item.id, name: item.name, emoji: item.emoji }, total: item.total }}
              key={item.id}
              maxAbsTotal={maxAbsTotal}
              onClick={onCategoryFocusChange ? () => toggleCategoryFocus(item.id, item.categoryIds) : undefined}
            />
          ))}
          <ExpandButton expanded={expanded} maxVisible={maxVisible} onToggleExpanded={onToggleExpanded} totalCount={totalCount} />
        </div>
      ) : (
        <div className="grid gap-8 p-5 lg:grid-cols-[minmax(20rem,0.9fr)_1fr]">
          <div className="h-[360px]">
            <DonutChart
              innerRadius="58%"
              outerRadius="88%"
              paddingAngle={1}
              slices={pieData.map((item) => {
                const focused = focusedCategoryId === item.categoryId

                return {
                  key: item.name,
                  label: item.name,
                  value: item.value,
                  color: item.color,
                  dimmed: hasFocus && !focused,
                  selected: focused,
                }
              })}
            >
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
            </DonutChart>
            <div className="pointer-events-none -mt-52 text-center">
              <div className="text-xl font-bold">{formatCurrency(period.total)}</div>
              <div className="text-sm text-neutral-500">Total</div>
            </div>
          </div>
          <div className="grid content-center gap-4 sm:grid-cols-2">
            {pieData.map((item) => (
              <button
                aria-pressed={focusedCategoryId === item.categoryId}
                className={clsx(
                  'flex items-start gap-3 rounded-xl p-2 text-left transition focus:outline-none focus:ring-2 focus:ring-brand-400',
                  focusedCategoryId === item.categoryId ? 'bg-brand-50' : 'hover:bg-neutral-50',
                  hasFocus && focusedCategoryId !== item.categoryId && 'opacity-55 grayscale',
                )}
                key={item.name}
                onClick={() => toggleCategoryFocus(item.categoryId, item.categoryIds)}
                type="button"
              >
                <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                <div>
                  <div className="font-medium">{item.name}</div>
                  <div className="text-sm font-semibold tabular-nums">{formatSignedCurrency(item.signedValue)} ({item.percent.toFixed(1)}%)</div>
                </div>
              </button>
            ))}
            <div className="sm:col-span-2">
              <ExpandButton expanded={expanded} maxVisible={maxVisible} onToggleExpanded={onToggleExpanded} totalCount={totalCount} />
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

function makePieData(items: DisplayItem[], expanded?: boolean) {
  const positiveTotal = items.reduce((total, item) => total + Math.max(0, item.total), 0)
  const visible = expanded
    ? items.filter((item) => positiveTotal === 0 || item.total > 0)
    : items.filter((item) => positiveTotal === 0 || (Math.max(0, item.total) / positiveTotal) * 100 >= 1.5)
  const hidden = items.filter((item) => !visible.includes(item))
  const existingEverythingElse = visible.find((item) => item.id === 'everything-else')
  const hiddenTotal = hidden.reduce((total, item) => total + Math.max(0, item.total), 0)
  const hiddenCategoryIds = hidden
    .filter((item) => item.total > 0)
    .flatMap((item) => item.categoryIds)

  const visibleData = visible.map((item) => ({
    categoryId: item.id,
    categoryIds: item === existingEverythingElse ? [...item.categoryIds, ...hiddenCategoryIds] : item.categoryIds,
    name: item.name,
    value: Math.max(0, item.total) + (item === existingEverythingElse ? hiddenTotal : 0),
    signedValue: item.total + (item === existingEverythingElse ? hiddenTotal : 0),
    percent: positiveTotal > 0 ? ((Math.max(0, item.total) + (item === existingEverythingElse ? hiddenTotal : 0)) / positiveTotal) * 100 : 0,
    color: item.color,
  }))

  if (hidden.length === 0 || hiddenTotal === 0 || existingEverythingElse) {
    return visibleData
  }

  return [
    ...visibleData,
    {
      categoryId: 'everything-else',
      categoryIds: hiddenCategoryIds,
      name: 'Everything else',
      value: hiddenTotal,
      signedValue: hiddenTotal,
      percent: positiveTotal > 0 ? (hiddenTotal / positiveTotal) * 100 : 0,
      color: spendingChartColor('everything-else'),
    },
  ]
}

function ExpandButton({
  expanded,
  maxVisible,
  onToggleExpanded,
  totalCount,
}: {
  expanded?: boolean
  maxVisible: number
  onToggleExpanded?: () => void
  totalCount: number
}) {
  if (!onToggleExpanded || totalCount <= maxVisible) {
    return null
  }

  return (
    <button
      className="flex w-full items-center justify-center gap-1 rounded-xl border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
      onClick={onToggleExpanded}
      type="button"
    >
      {expanded ? (
        <>Show less <ChevronUp className="h-4 w-4" /></>
      ) : (
        <>Show all {totalCount} categories <ChevronDown className="h-4 w-4" /></>
      )}
    </button>
  )
}
