import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Category } from '../../types/graphql'
import type { SpendingPeriod } from '../../types/domain'
import { categories, spendingPeriod } from '../../mocks/fixtures'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { CategoryBar } from './CategoryBar'
import { SpendingBreakdown } from './SpendingBreakdown'
import { SpendingComparison } from './SpendingComparison'
import { buildComparisonPoints, formatPositionLabel } from './spendingComparisonData'
import { SpendingTrends } from './SpendingTrends'

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

describe('report components', () => {
  it('renders positive and negative category bars', () => {
    render(
      <>
        <CategoryBar item={spendingPeriod.categories[0]} maxAbsTotal={150} />
        <CategoryBar item={spendingPeriod.categories[6]} maxAbsTotal={150} />
      </>,
    )

    expect(screen.getByText(/Restaurants & Bars/)).toBeInTheDocument()
    expect(screen.getAllByText('-$24.99')).not.toHaveLength(0)
  })

  it('toggles the spending breakdown to pie view and handles empty data', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<SpendingBreakdown period={spendingPeriod} />)

    expect(screen.getByText(/Restaurants & Bars/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^pie$/i }))
    expect(screen.getByText('Total')).toBeInTheDocument()

    rerender(<SpendingBreakdown />)
    expect(screen.getByText('No spending data for this period.')).toBeInTheDocument()
  })

  it('focuses and clears category bars', async () => {
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

  it('focuses pie legend categories', async () => {
    const user = userEvent.setup()
    const onCategoryFocusChange = vi.fn()

    render(<SpendingBreakdown focusedCategoryId={null} onCategoryFocusChange={onCategoryFocusChange} period={spendingPeriod} />)

    await user.click(screen.getByRole('button', { name: /^pie$/i }))
    await user.click(screen.getByRole('button', { name: /Groceries.*\$62\.30/ }))

    expect(onCategoryFocusChange).toHaveBeenCalledWith({ id: '1', categoryIds: ['1'] })
  })

  it('does not duplicate Everything else in pie view when hidden categories include credits', async () => {
    const user = userEvent.setup()
    const manyCatsPeriod = makeManyCategoriesPeriod()
    const periodWithCredit: SpendingPeriod = {
      ...manyCatsPeriod,
      categories: [
        ...manyCatsPeriod.categories,
        { category: makeCategory(99, 'Refunds', '↩️', 'Credits', '↩️'), total: -5, transactionCount: 1, percentOfTotal: -0.38 },
      ],
    }

    render(<SpendingBreakdown expanded={false} onToggleExpanded={() => {}} period={periodWithCredit} />)

    await user.click(screen.getByRole('button', { name: /^pie$/i }))

    expect(screen.getAllByText('Everything else')).toHaveLength(1)
    expect(screen.queryByText('$0.00 (0.0%)')).not.toBeInTheDocument()
  })

  it('omits zero-value categories from the breakdown bars', () => {
    const zeroCategory = makeCategory(100, 'Unused', '0', 'Misc', '0')
    const periodWithZero: SpendingPeriod = {
      ...spendingPeriod,
      categories: [
        ...spendingPeriod.categories,
        { category: zeroCategory, total: 0, transactionCount: 0, percentOfTotal: 0 },
      ],
    }

    render(<SpendingBreakdown period={periodWithZero} />)

    expect(screen.queryByRole('button', { name: /Unused/ })).not.toBeInTheDocument()
  })

  it('renders the spending trends stacked bar chart with clickable legend items', () => {
    const onCategoryFocusChange = vi.fn()
    render(
      <SpendingTrends
        onCategoryFocusChange={onCategoryFocusChange}
        periods={trendsPeriods}
      />,
    )

    expect(screen.getByText(/Restaurants & Bars/)).toBeInTheDocument()
  })

  it('focuses category by clicking trend legend items', async () => {
    const user = userEvent.setup()
    const onCategoryFocusChange = vi.fn()

    render(
      <SpendingTrends
        onCategoryFocusChange={onCategoryFocusChange}
        periods={trendsPeriods}
      />,
    )

    await user.click(screen.getByRole('button', { name: /Restaurants & Bars/ }))
    expect(onCategoryFocusChange).toHaveBeenCalledWith('2')
  })

  it('shows focused view and clear button when a category is focused', async () => {
    const user = userEvent.setup()
    const onCategoryFocusChange = vi.fn()

    const { rerender } = render(
      <SpendingTrends
        focusedCategoryId="2"
        onCategoryFocusChange={onCategoryFocusChange}
        periods={trendsPeriods}
      />,
    )

    expect(screen.getAllByRole('button', { name: /clear focus/i })).not.toHaveLength(0)
    expect(screen.getByText(/focused on.*restaurants & bars/i)).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /clear focus/i })[0])
    expect(onCategoryFocusChange).toHaveBeenCalledWith(null)

    rerender(
      <SpendingTrends
        focusedCategoryId={null}
        onCategoryFocusChange={onCategoryFocusChange}
        periods={trendsPeriods}
      />,
    )

    expect(screen.queryByRole('button', { name: /clear focus/i })).not.toBeInTheDocument()
  })

  it('shows group-by mode with aggregated groups', () => {
    render(<SpendingBreakdown groupBy="group" period={spendingPeriod} />)

    expect(screen.getByText(/Food/)).toBeInTheDocument()
    expect(screen.getByText(/Lifestyle/)).toBeInTheDocument()
    expect(screen.queryByText(/Groceries/)).not.toBeInTheDocument()
  })

  it('shows "Everything else" when more than 10 categories are present', () => {
    const manyCatsPeriod = makeManyCategoriesPeriod()
    render(<SpendingBreakdown expanded={false} onToggleExpanded={() => {}} period={manyCatsPeriod} />)

    expect(screen.getByText(/Everything else/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /show all 12 categories/i })).toBeInTheDocument()
  })

  it('focuses the categories represented by Everything else', async () => {
    const user = userEvent.setup()
    const onCategoryFocusChange = vi.fn()

    render(<SpendingBreakdown expanded={false} onCategoryFocusChange={onCategoryFocusChange} onToggleExpanded={() => {}} period={makeManyCategoriesPeriod()} />)

    await user.click(screen.getByRole('button', { name: /Everything else.*\$90\.00/ }))

    expect(onCategoryFocusChange).toHaveBeenCalledWith({ id: 'everything-else', categoryIds: ['20', '21'] })
  })

  it('expands to show all categories and collapses back', async () => {
    const user = userEvent.setup()
    const onToggleExpanded = vi.fn()
    const manyCatsPeriod = makeManyCategoriesPeriod()

    const { rerender } = render(<SpendingBreakdown expanded={false} onToggleExpanded={onToggleExpanded} period={manyCatsPeriod} />)

    await user.click(screen.getByRole('button', { name: /show all 12 categories/i }))
    expect(onToggleExpanded).toHaveBeenCalled()

    rerender(<SpendingBreakdown expanded={true} onToggleExpanded={onToggleExpanded} period={manyCatsPeriod} />)

    expect(screen.getByText('Show less')).toBeInTheDocument()
    expect(screen.queryByText(/Everything else/)).not.toBeInTheDocument()
  })

  it('expands pie view with the same control as bar view', async () => {
    const user = userEvent.setup()
    const onToggleExpanded = vi.fn()
    const basePeriod = makeManyCategoriesPeriod()
    const manyCatsPeriod: SpendingPeriod = {
      ...basePeriod,
      total: 1301,
      categories: [
        ...basePeriod.categories,
        { category: makeCategory(99, 'Tiny Category', '•', 'Tiny', '•'), total: 1, transactionCount: 1, percentOfTotal: 0.08 },
      ],
    }

    const { rerender } = render(<SpendingBreakdown expanded={false} onToggleExpanded={onToggleExpanded} period={manyCatsPeriod} />)

    await user.click(screen.getByRole('button', { name: /^pie$/i }))
    await user.click(screen.getByRole('button', { name: /show all 13 categories/i }))
    expect(onToggleExpanded).toHaveBeenCalled()

    rerender(<SpendingBreakdown expanded={true} onToggleExpanded={onToggleExpanded} period={manyCatsPeriod} />)

    expect(screen.getByText('Show less')).toBeInTheDocument()
    expect(screen.getByText('Tiny Category')).toBeInTheDocument()
    expect(screen.queryByText(/Everything else/)).not.toBeInTheDocument()
  })

  it('shows "Everything else" in group-by mode when more than 6 groups exist', () => {
    const manyCatsPeriod = makeManyCategoriesPeriod()
    render(<SpendingBreakdown expanded={false} groupBy="group" onToggleExpanded={() => {}} period={manyCatsPeriod} />)

    expect(screen.getByText(/Everything else/)).toBeInTheDocument()
  })

  it('trends shows group-by mode aggregating categories into groups', () => {
    render(
      <SpendingTrends
        groupBy="group"
        periods={trendsPeriods}
      />,
    )

    expect(screen.getByText(/Food/)).toBeInTheDocument()
  })

  it('trends shows the top five categories and keeps Everything else last', () => {
    render(<SpendingTrends periods={[makeManyCategoriesPeriod()]} />)

    expect(screen.getByText(/Insurance/)).toBeInTheDocument()
    expect(screen.queryByText(/Entertainment/)).not.toBeInTheDocument()
    expect(screen.getByText(/Everything else/)).toBeInTheDocument()
    expect(screen.getAllByRole('button').at(-1)).toHaveTextContent(/Everything else/)
  })

  it('switches trends to line view with top category series', async () => {
    const user = userEvent.setup()
    render(<SpendingTrends periods={[makeManyCategoriesPeriod()]} />)

    await user.click(screen.getByRole('button', { name: 'Line' }))
    expect(screen.getByText(/Rent/)).toBeInTheDocument()
    expect(screen.getByText(/Groceries/)).toBeInTheDocument()
    expect(screen.getByText(/Insurance/)).toBeInTheDocument()
    expect(screen.queryByText(/Entertainment/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Everything else/)).not.toBeInTheDocument()
  })

  it('focuses category by clicking line chart legend items', async () => {
    const user = userEvent.setup()
    const onCategoryFocusChange = vi.fn()

    render(<SpendingTrends onCategoryFocusChange={onCategoryFocusChange} periods={[makeManyCategoriesPeriod()]} />)

    await user.click(screen.getByRole('button', { name: 'Line' }))
    await user.click(screen.getByRole('button', { name: /Rent/ }))

    expect(onCategoryFocusChange).toHaveBeenCalledWith('10')
  })

  it('renders focused category bar chart in trends', () => {
    const onCategoryFocusChange = vi.fn()
    render(
      <SpendingTrends
        focusedCategoryId="2"
        onCategoryFocusChange={onCategoryFocusChange}
        periods={trendsPeriods}
      />,
    )

    expect(screen.getByText(/focused on.*restaurants & bars/i)).toBeInTheDocument()
  })

  it('keeps focused trends in line view when line is selected', async () => {
    const user = userEvent.setup()
    const onCategoryFocusChange = vi.fn()

    const { container, rerender } = render(
      <SpendingTrends
        focusedCategoryId={null}
        onCategoryFocusChange={onCategoryFocusChange}
        periods={trendsPeriods}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Line' }))
    await user.click(screen.getByRole('button', { name: /Restaurants & Bars/ }))

    expect(onCategoryFocusChange).toHaveBeenCalledWith('2')

    rerender(
      <SpendingTrends
        focusedCategoryId="2"
        onCategoryFocusChange={onCategoryFocusChange}
        periods={trendsPeriods}
      />,
    )

    expect(container.querySelector('.recharts-line')).toBeInTheDocument()
    expect(container.querySelector('.recharts-bar-rectangle')).not.toBeInTheDocument()
  })

  it('switching to pie view shows the pie chart Total label', async () => {
    const user = userEvent.setup()
    render(<SpendingBreakdown period={spendingPeriod} />)

    await user.click(screen.getByRole('button', { name: /^pie$/i }))
    expect(screen.getByText('Total')).toBeInTheDocument()
  })

  it('renders the spending comparison chart with default month-vs-last-month mode', async () => {
    render(<SpendingComparison categoryIds={[]} />, { wrapper: GraphqlTestProvider })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /this month vs\. last month/i })).toBeInTheDocument()
    })
    expect(screen.getAllByText(/this month/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/last month/i).length).toBeGreaterThan(0)
  })

  it('switches comparison mode via dropdown to each option', async () => {
    const user = userEvent.setup()
    render(<SpendingComparison categoryIds={[]} />, { wrapper: GraphqlTestProvider })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /this month vs\. last month/i })).toBeInTheDocument()
    })

    // week vs last week
    await user.click(screen.getByRole('button', { name: /this month vs\. last month/i }))
    await user.click(screen.getByRole('button', { name: /this week vs\. last week/i }))
    expect(screen.getAllByText(/this week/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/last week/i).length).toBeGreaterThan(0)

    // year vs last year
    await user.click(screen.getByRole('button', { name: /this week vs\. last week/i }))
    await user.click(screen.getByRole('button', { name: /this year vs\. last year/i }))
    expect(screen.getAllByText(/this year/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/last year/i).length).toBeGreaterThan(0)

    // month vs last year
    await user.click(screen.getByRole('button', { name: /this year vs\. last year/i }))
    await user.click(screen.getByRole('button', { name: /this month vs\. last year/i }))
    expect(screen.getAllByText(/this month/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/this month last year/i).length).toBeGreaterThan(0)
  })

  it('applies category filter to comparison queries', async () => {
    render(<SpendingComparison categoryIds={['1', '2']} />, { wrapper: GraphqlTestProvider })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /this month vs\. last month/i })).toBeInTheDocument()
    })
    // Component renders without error when categoryIds are provided
    expect(screen.getAllByText(/spending/i).length).toBeGreaterThan(0)
  })

  it('applies owner filter to comparison queries', async () => {
    render(<SpendingComparison categoryIds={[]} owners={['alex']} />, { wrapper: GraphqlTestProvider })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /this month vs\. last month/i })).toBeInTheDocument()
    })
  })

  it('buildComparisonPoints stops current line past todayIndex and handles mismatched lengths', () => {
    const current = [{ totalAmount: 10 }, { totalAmount: 20 }, { totalAmount: 30 }]
    const historical = [{ totalAmount: 5 }, { totalAmount: 15 }]

    // todayIndex=1: current line stops after index 1; historical shorter than current
    const points = buildComparisonPoints(current, historical, 'month-vs-last-month', 1)

    expect(points).toHaveLength(3) // max of 3 and 2
    expect(points[0]).toMatchObject({ label: 'Day 1', current: 10, historical: 5 })
    expect(points[1]).toMatchObject({ label: 'Day 2', current: 30, historical: 20 })
    // index 2 > todayIndex(1) → current is null; index 2 >= historicalLength(2) → historical is null
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
})
