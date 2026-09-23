import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Category } from '../../types/graphql'
import type { SpendingPeriod } from '../../types/domain'
import { categories, spendingPeriod } from '../../mocks/fixtures'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { useIsMobile } from '../../hooks/useIsMobile'
import { spendingChartColor } from '../../utils/chartStyles'
import { nextSort } from './reportsSort'
import { SpendingBreakdown } from './SpendingBreakdown'
import { SpendingComparison } from './SpendingComparison'
import { buildComparisonPoints, comparisonTickLabels, formatPositionLabel } from './spendingComparisonData'
import { breakdownItems, pieItems } from './spendingBreakdownItems'
import { SpendingTrends } from './SpendingTrends'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: vi.fn(() => false) }))

afterEach(() => {
  vi.mocked(useIsMobile).mockReturnValue(false)
})

function makeCategory(id: number, name: string, emoji: string, groupName: string, groupEmoji: string): Category {
  return { id: String(id), name, emoji, groupName, groupEmoji, kind: 'EXPENSE' as const, sortOrder: id, plaidPFC2Codes: [] }
}

function makeManyCategoriesPeriod(): SpendingPeriod {
  const cats: Category[] = [
    makeCategory(10, 'Rent', '🏠', 'Housing', '🏗️'),
    makeCategory(11, 'Groceries', '🍏', 'Food', '🍽️'),
    makeCategory(12, 'Dining Out', '🍽️', 'Food', '🍽️'),
    makeCategory(13, 'Gas', '⛽', 'Transport', '🚗'),
    makeCategory(14, 'Insurance', '🛡️', 'Insurance', '🛡️'),
    makeCategory(15, 'Entertainment', '🎬', 'Entertainment', '🎭'),
    makeCategory(16, 'Clothing', '👕', 'Shopping', '🛍️'),
    makeCategory(17, 'Utilities', '💡', 'Housing', '🏗️'),
    makeCategory(18, 'Phone', '📱', 'Utilities', '📱'),
    makeCategory(19, 'Internet', '🌐', 'Utilities', '📱'),
    makeCategory(20, 'Gym', '🏋️', 'Health', '💪'),
    makeCategory(21, 'Coffee', '☕', 'Food', '🍽️'),
  ]
  return {
    periodLabel: '2026-05',
    periodStart: '2026-05-01',
    periodEnd: '2026-05-31',
    total: 1300,
    categories: cats.map((cat, i) => ({
      category: cat,
      total: 150 - i * 10,
      transactionCount: 3,
      percentOfTotal: (150 - i * 10) / 1300 * 100,
    })),
  }
}

const trendsPeriods: SpendingPeriod[] = [
  spendingPeriod,
  {
    ...spendingPeriod,
    periodLabel: '2026-04',
    periodStart: '2026-04-01',
    periodEnd: '2026-04-30',
    total: 180,
    categories: [
      { category: categories[1], total: 120, transactionCount: 3, percentOfTotal: 66.67 },
      { category: categories[0], total: 48, transactionCount: 1, percentOfTotal: 26.67 },
    ],
  },
]

describe('spending breakdown', () => {
  it('renders dotted weight bars with signed amounts and handles empty data', () => {
    const { container, rerender } = render(<SpendingBreakdown period={spendingPeriod} />)

    expect(screen.getByText(/Restaurants & Bars/)).toBeInTheDocument()
    expect(screen.getByText('-$24.99')).toBeInTheDocument()
    expect(screen.getByText('40.7%')).toBeInTheDocument()
    const fills = container.querySelectorAll('[aria-hidden] > div')
    expect(fills[0]).toHaveStyle({ width: '100%' })
    expect((fills[0] as HTMLElement).style.background).toContain(spendingChartColor(spendingPeriod.categories[0].category.id))

    rerender(<SpendingBreakdown />)
    expect(screen.getByText('No spending data for this period.')).toBeInTheDocument()
  })

  it('renders the pie view with a legend table and centre total', () => {
    render(<SpendingBreakdown period={spendingPeriod} view="pie" />)

    expect(screen.getByRole('img', { name: 'Spending by category' })).toBeInTheDocument()
    expect(screen.getByText('All categories')).toBeInTheDocument()
    expect(screen.getByText('$368.76')).toBeInTheDocument()
    expect(screen.getByText('Txns')).toBeInTheDocument()
    expect(screen.queryByText('-$24.99')).not.toBeInTheDocument()
  })

  it('focuses and clears category rows', async () => {
    const user = userEvent.setup()
    const onCategoryFocusChange = vi.fn()
    const { rerender } = render(<SpendingBreakdown focusedCategoryId={null} onCategoryFocusChange={onCategoryFocusChange} period={spendingPeriod} />)

    await user.click(screen.getByRole('button', { name: /Restaurants & Bars.*\$150\.00/ }))
    expect(onCategoryFocusChange).toHaveBeenCalledWith({ id: '2', categoryIds: ['2'] })

    rerender(<SpendingBreakdown focusedCategoryId="2" onCategoryFocusChange={onCategoryFocusChange} period={spendingPeriod} />)

    expect(screen.getByRole('button', { name: /Restaurants & Bars.*\$150\.00/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Groceries.*\$62\.30/ })).toHaveAttribute('aria-pressed', 'false')

    await user.click(screen.getByRole('button', { name: /Restaurants & Bars.*\$150\.00/ }))
    expect(onCategoryFocusChange).toHaveBeenLastCalledWith(null)
  })

  it('focuses pie legend rows and highlights the hovered slice', async () => {
    const user = userEvent.setup()
    const onCategoryFocusChange = vi.fn()

    render(<SpendingBreakdown focusedCategoryId={null} onCategoryFocusChange={onCategoryFocusChange} period={spendingPeriod} view="pie" />)

    const row = screen.getByRole('button', { name: /Groceries.*\$62\.30/ })
    await user.hover(row)
    expect(row).toHaveClass('bg-raised')
    await user.click(row)

    expect(onCategoryFocusChange).toHaveBeenCalledWith({ id: '1', categoryIds: ['1'] })
  })

  it('does not duplicate Everything else in pie view when hidden categories include credits', () => {
    const manyCatsPeriod = makeManyCategoriesPeriod()
    const periodWithCredit: SpendingPeriod = {
      ...manyCatsPeriod,
      categories: [
        ...manyCatsPeriod.categories,
        { category: makeCategory(99, 'Refunds', '↩️', 'Credits', '↩️'), total: -5, transactionCount: 1, percentOfTotal: -0.38 },
      ],
    }

    render(<SpendingBreakdown expanded={false} onToggleExpanded={() => {}} period={periodWithCredit} view="pie" />)

    expect(screen.getAllByText('Everything else')).toHaveLength(1)
    expect(screen.queryByText('Refunds')).not.toBeInTheDocument()
  })

  it('omits zero-value categories from the breakdown bars', () => {
    const zeroCategory = makeCategory(100, 'Unused', '0', 'Misc', '0')
    const periodWithZero: SpendingPeriod = {
      ...spendingPeriod,
      categories: [...spendingPeriod.categories, { category: zeroCategory, total: 0, transactionCount: 0, percentOfTotal: 0 }],
    }

    render(<SpendingBreakdown period={periodWithZero} />)

    expect(screen.queryByRole('button', { name: /Unused/ })).not.toBeInTheDocument()
  })

  it('shows group-by mode with aggregated groups', () => {
    render(<SpendingBreakdown groupBy="group" onCategoryFocusChange={vi.fn()} period={spendingPeriod} view="pie" />)

    expect(screen.getByRole('button', { name: /Food.*\$212\.30/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Lifestyle.*\$59\.26/ })).toBeInTheDocument()
    expect(screen.getByText('All groups')).toBeInTheDocument()
    expect(screen.queryByText(/Groceries/)).not.toBeInTheDocument()
  })

  it('folds categories past the top 10 into Everything else and expands on demand', async () => {
    const user = userEvent.setup()
    const onToggleExpanded = vi.fn()
    const onCategoryFocusChange = vi.fn()
    const manyCatsPeriod = makeManyCategoriesPeriod()
    const { rerender } = render(<SpendingBreakdown expanded={false} onCategoryFocusChange={onCategoryFocusChange} onToggleExpanded={onToggleExpanded} period={manyCatsPeriod} />)

    await user.click(screen.getByRole('button', { name: /Everything else.*\$90\.00/ }))
    expect(onCategoryFocusChange).toHaveBeenCalledWith({ id: 'everything-else', categoryIds: ['20', '21'] })

    await user.click(screen.getByRole('button', { name: /show all 12 categories/i }))
    expect(onToggleExpanded).toHaveBeenCalled()

    rerender(<SpendingBreakdown expanded onCategoryFocusChange={onCategoryFocusChange} onToggleExpanded={onToggleExpanded} period={manyCatsPeriod} />)

    expect(screen.getByText('Show less')).toBeInTheDocument()
    expect(screen.queryByText(/Everything else/)).not.toBeInTheDocument()
    expect(screen.getByText(/Coffee/)).toBeInTheDocument()
  })

  it('shows Everything else in group-by mode when more than 6 groups exist', () => {
    render(<SpendingBreakdown expanded={false} groupBy="group" onToggleExpanded={() => {}} period={makeManyCategoriesPeriod()} />)

    expect(screen.getByText(/Everything else/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show all 8 categories/i })).toBeInTheDocument()
  })
})

describe('spending breakdown on mobile', () => {
  function rowNames() {
    return screen.getAllByRole('button').map((row) => row.getAttribute('aria-label')).filter((name) => name?.includes('$'))
  }

  it('renders the same bar rows and amounts as desktop', () => {
    const onCategoryFocusChange = vi.fn()
    const { unmount } = render(<SpendingBreakdown onCategoryFocusChange={onCategoryFocusChange} period={spendingPeriod} />)
    const desktopRows = rowNames()
    unmount()

    vi.mocked(useIsMobile).mockReturnValue(true)
    render(<SpendingBreakdown onCategoryFocusChange={onCategoryFocusChange} period={spendingPeriod} />)

    expect(rowNames()).toEqual(desktopRows)
    expect(screen.getByText('40.7%')).toBeInTheDocument()
    expect(screen.queryByText('Weight')).not.toBeInTheDocument()
  })

  it('renders the same pie legend rows as desktop with share and counts', () => {
    const onCategoryFocusChange = vi.fn()
    const { unmount } = render(<SpendingBreakdown onCategoryFocusChange={onCategoryFocusChange} period={spendingPeriod} view="pie" />)
    const desktopRows = rowNames()
    unmount()

    vi.mocked(useIsMobile).mockReturnValue(true)
    render(<SpendingBreakdown onCategoryFocusChange={onCategoryFocusChange} period={spendingPeriod} view="pie" />)

    expect(rowNames()).toEqual(desktopRows)
    expect(screen.getByText('Amount · Share')).toBeInTheDocument()
    expect(screen.getByText('38.1% · 2 txns')).toBeInTheDocument()
    expect(screen.getByText('All categories')).toBeInTheDocument()
  })
})

describe('pie items', () => {
  const tiny = { category: makeCategory(99, 'Tiny', '·', 'Tiny', '·'), total: 1, transactionCount: 1, percentOfTotal: 0.08 }

  it('appends Everything else for sub-threshold slices when none exists', () => {
    const items = breakdownItems([...spendingPeriod.categories, tiny], undefined, false)
    const slices = pieItems(items, false)
    expect(slices.at(-1)).toMatchObject({ id: 'everything-else', total: 1, transactionCount: 1, categoryIds: ['99'] })
    expect(slices.some((slice) => slice.id === '99')).toBe(false)
  })

  it('merges sub-threshold slices into an existing Everything else and shows them when expanded', () => {
    const skewed = Array.from({ length: 12 }, (_, i) => ({ category: makeCategory(i + 1, `Cat ${i + 1}`, '·', 'Misc', '·'), total: i === 0 ? 1000 : 12, transactionCount: 3, percentOfTotal: 0 }))
    const items = breakdownItems(skewed, undefined, false)
    const folded = items.find((item) => item.id === 'everything-else')!
    expect(folded.categoryIds).toEqual(['11', '12'])

    const slices = pieItems(items, false)
    expect(slices.map((slice) => slice.id)).toEqual(['1', 'everything-else'])
    expect(slices[1]).toMatchObject({ total: 24 + 9 * 12, transactionCount: 6 + 9 * 3, categoryIds: ['11', '12', '2', '3', '4', '5', '6', '7', '8', '9', '10'] })
    expect(pieItems(breakdownItems(skewed, undefined, true), true)).toHaveLength(12)
  })
})

describe('spending trends', () => {
  it('renders the stacked bars with a clickable legend', async () => {
    const user = userEvent.setup()
    const onCategoryFocusChange = vi.fn()
    const { container } = render(<SpendingTrends onCategoryFocusChange={onCategoryFocusChange} periods={trendsPeriods} />)

    expect(container.querySelector('.recharts-responsive-container')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Restaurants & Bars/ }))
    expect(onCategoryFocusChange).toHaveBeenCalledWith({ id: '2', categoryIds: ['2'] })
  })

  it('resolves Everything else to the categories outside the top five', async () => {
    const user = userEvent.setup()
    const onCategoryFocusChange = vi.fn()
    render(<SpendingTrends onCategoryFocusChange={onCategoryFocusChange} periods={[makeManyCategoriesPeriod()]} />)

    await user.click(screen.getByRole('button', { name: /Everything else/ }))
    expect(onCategoryFocusChange).toHaveBeenCalledWith({ id: 'everything-else', categoryIds: ['15', '16', '17', '18', '19', '20', '21'] })
  })

  it('resolves group legend entries and Everything else to category ids by group', async () => {
    const user = userEvent.setup()
    const onCategoryFocusChange = vi.fn()
    render(<SpendingTrends groupBy="group" onCategoryFocusChange={onCategoryFocusChange} periods={[makeManyCategoriesPeriod()]} />)

    await user.click(screen.getByRole('button', { name: /Housing/ }))
    expect(onCategoryFocusChange).toHaveBeenCalledWith({ id: 'Housing', categoryIds: ['10', '17'] })
    await user.click(screen.getByRole('button', { name: /Everything else/ }))
    expect(onCategoryFocusChange).toHaveBeenLastCalledWith({ id: 'everything-else', categoryIds: ['15', '16', '20'] })
  })

  it('shows the focused category and clears it', async () => {
    const user = userEvent.setup()
    const onCategoryFocusChange = vi.fn()
    const { rerender } = render(<SpendingTrends focusedCategoryId="2" onCategoryFocusChange={onCategoryFocusChange} periods={trendsPeriods} />)

    expect(screen.getByRole('button', { name: /Restaurants & Bars/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText(/focused on.*restaurants & bars/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /clear focus/i }))
    expect(onCategoryFocusChange).toHaveBeenCalledWith(null)

    rerender(<SpendingTrends focusedCategoryId={null} onCategoryFocusChange={onCategoryFocusChange} periods={trendsPeriods} />)
    expect(screen.queryByRole('button', { name: /clear focus/i })).not.toBeInTheDocument()
  })

  it('aggregates categories into groups and shows an empty message without periods', () => {
    const { rerender } = render(<SpendingTrends groupBy="group" periods={trendsPeriods} />)
    expect(screen.getByText(/Food/)).toBeInTheDocument()

    rerender(<SpendingTrends periods={[]} />)
    expect(screen.getByText('No trends data available.')).toBeInTheDocument()
  })

  it('keeps the top five categories and Everything else last', () => {
    render(<SpendingTrends periods={[makeManyCategoriesPeriod()]} />)

    expect(screen.getByText(/Insurance/)).toBeInTheDocument()
    expect(screen.queryByText(/Entertainment/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('button').at(-1)).toHaveTextContent(/Everything else/)
  })
})

describe('spending comparison', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows only last month before the second day of the month', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 4, 1, 12))
    render(<SpendingComparison categoryIds={[]} />, { wrapper: GraphqlTestProvider })

    expect(await screen.findByText(/showing last month only/i)).toBeInTheDocument()
    expect(screen.queryByText('This month', { exact: true })).not.toBeInTheDocument()
    expect(screen.getByText('Last month', { exact: true })).toBeInTheDocument()
  })

  it('renders month-vs-last-month by default and switches modes', async () => {
    const user = userEvent.setup()
    render(<SpendingComparison categoryIds={[]} />, { wrapper: GraphqlTestProvider })

    const select = await screen.findByRole('combobox', { name: 'Comparison period' })
    expect(select).toHaveValue('month-vs-last-month')
    expect(screen.getAllByText(/last month/i).length).toBeGreaterThan(0)

    await user.selectOptions(select, 'week-vs-last-week')
    expect(screen.getAllByText(/last week/i).length).toBeGreaterThan(0)

    await user.selectOptions(select, 'year-vs-last-year')
    expect(screen.getAllByText(/last year/i).length).toBeGreaterThan(0)

    await user.selectOptions(select, 'month-vs-last-year')
    expect(screen.getAllByText(/this month last year/i).length).toBeGreaterThan(0)
  })

  it('renders with category, account and owner filters', async () => {
    render(<SpendingComparison accountIds={['acct-1']} categoryIds={['1', '2']} owners={['alex']} showHidden />, { wrapper: GraphqlTestProvider })

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Comparison period' })).toBeInTheDocument())
  })

  it('buildComparisonPoints stops current line past todayIndex and handles mismatched lengths', () => {
    const current = [{ totalAmount: 10 }, { totalAmount: 20 }, { totalAmount: 30 }]
    const historical = [{ totalAmount: 5 }, { totalAmount: 15 }]

    const points = buildComparisonPoints(current, historical, 'month-vs-last-month', 1)

    expect(points).toHaveLength(3)
    expect(points[0]).toMatchObject({ label: 'Day 1', current: 10, historical: 5 })
    expect(points[1]).toMatchObject({ label: 'Day 2', current: 30, historical: 20 })
    expect(points[2]).toMatchObject({ label: 'Day 3', current: null, historical: null })
  })

  it('formatPositionLabel returns correct labels for all modes', () => {
    expect(formatPositionLabel(0, 'week-vs-last-week')).toBe('Mon')
    expect(formatPositionLabel(4, 'week-vs-last-week')).toBe('Fri')
    expect(formatPositionLabel(0, 'year-vs-last-year')).toBe('Day 1')
    expect(formatPositionLabel(3, 'year-vs-last-year')).toBe('Day 22')
    expect(formatPositionLabel(0, 'month-vs-last-month')).toBe('Day 1')
    expect(formatPositionLabel(14, 'month-vs-last-year')).toBe('Day 15')
  })

  it('comparisonTickLabels spaces ticks across long series and keeps every point of short ones', () => {
    const points = buildComparisonPoints(Array.from({ length: 30 }, () => ({ totalAmount: 1 })), [], 'month-vs-last-month', 29)
    expect(comparisonTickLabels(points, [0, 0.2, 0.4, 0.6, 0.8, 1])).toEqual(['Day 1', 'Day 7', 'Day 13', 'Day 18', 'Day 24', 'Day 30'])
    expect(comparisonTickLabels(points, [0, 0.32, 0.65, 1])).toEqual(['Day 1', 'Day 10', 'Day 20', 'Day 30'])
    const week = buildComparisonPoints(Array.from({ length: 7 }, () => ({ totalAmount: 1 })), [], 'week-vs-last-week', 6)
    expect(comparisonTickLabels(week, [0, 0.2, 0.4, 0.6, 0.8, 1])).toHaveLength(7)
    expect(comparisonTickLabels([], [0, 1])).toEqual([])
  })
})

describe('report transaction sort', () => {
  it('cycles through every sort option', () => {
    expect(nextSort({ field: 'DATE', direction: 'DESC' })).toEqual({ field: 'DATE', direction: 'ASC' })
    expect(nextSort({ field: 'DATE', direction: 'ASC' })).toEqual({ field: 'AMOUNT', direction: 'DESC' })
    expect(nextSort({ field: 'AMOUNT', direction: 'ASC' })).toEqual({ field: 'DATE', direction: 'DESC' })
  })
})
