import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { accounts, analysisReportForView, owners } from '../../mocks/fixtures'
import { renderWithProviders } from '../../test/renderWithProviders'
import type { AnalysisSlice } from '../../types/graphql'
import { PortfolioCard } from './PortfolioCard'
import { MIN_DONUT_SHARE, donutSlices, portfolioViewOption } from './portfolioSlices'

function slice(label: string, valueUSD: number, percent: number): AnalysisSlice {
  return { __typename: 'AnalysisSlice', label, valueUSD, percent, holdings: [] }
}

describe('portfolioSlices', () => {
  it('floors tiny positive slices at the minimum donut share without touching larger ones', () => {
    const donut = donutSlices([slice('Stock', 9_990, 99.9), slice('Preferred', 10, 0.1)], 10_000)

    expect(donut[0]).toMatchObject({ key: 'Stock', value: 9_990 })
    expect(donut[1].value).toBeCloseTo(10_000 * MIN_DONUT_SHARE)
    expect(donut[1].color).not.toBe(donut[0].color)
    expect(donutSlices([slice('Unclassified', 1, 0.01)], 10_000)[0].color).toBe('#94a3b8')
  })

  it('draws negative slices as nothing and leaves zero-total and single-slice reports alone', () => {
    expect(donutSlices([slice('Stock', 100, 100), slice('Short', -5, -5)], 95).map((item) => item.value)).toEqual([100, 0])
    expect(donutSlices([slice('Stock', 0, 0), slice('Bond', 0, 0)], 0).map((item) => item.value)).toEqual([0, 0])
    expect(donutSlices([slice('Stock', 1, 100)], 1)).toHaveLength(1)
    expect(donutSlices([slice('Stock', 1, 100)], 1)[0].value).toBe(1)
    expect(donutSlices([], 0)).toEqual([])
  })

  it('maps URL params to analysis views', () => {
    expect(portfolioViewOption('sectors')).toMatchObject({ view: 'SECTORS', label: 'Sectors' })
    expect(portfolioViewOption('category')).toMatchObject({ view: 'MORNINGSTAR_CATEGORY', label: 'Category' })
  })
})

function renderCard(overrides: Partial<Parameters<typeof PortfolioCard>[0]> = {}, hideOwners = false) {
  const report = analysisReportForView('COMPOSITION')
  const props = {
    accounts,
    amountsHidden: false,
    body: null,
    fetching: false,
    filters: { ownerIds: [], accountGroupIds: [], accountIds: [], includeUnclassified: false },
    owners,
    report,
    selectedLabel: null,
    view: 'composition' as const,
    onClearFilters: vi.fn(),
    onEditAsset: vi.fn(),
    onFilterChange: vi.fn(),
    onSelectLabel: vi.fn(),
    onToggleAmountsHidden: vi.fn(),
    onViewChange: vi.fn(),
    ...overrides,
  }
  renderWithProviders(<PortfolioCard {...props} />, { auth: { hideOwners } })
  return { props, report }
}

const stockRows = () => screen.getAllByRole('button', { name: /^Stock/ })
const donutPath = (label: string) => screen.getByText(label, { selector: 'title' }).closest('path') as SVGPathElement

describe('PortfolioCard', () => {
  it('summarises the report and switches views', async () => {
    const { props } = renderCard()

    expect(screen.getByText('Total analyzed')).toBeInTheDocument()
    expect(screen.getByText('4 slices across Composition')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Portfolio by composition' })).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('radio', { name: 'Sectors' })[0])
    expect(props.onViewChange).toHaveBeenCalledWith('sectors')
  })

  it('shows a placeholder instead of zeros while the report is unavailable', () => {
    renderCard({ report: undefined, body: <p>Loading</p> })

    expect(screen.getByText('Total analyzed')).toBeInTheDocument()
    expect(screen.getByText('Total analyzed unavailable')).toHaveClass('sr-only')
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument()
    expect(screen.queryByText(/0 slices/)).not.toBeInTheDocument()
    expect(screen.getByText('Loading')).toBeInTheDocument()
  })

  it('hides a stale report behind the placeholder while a new one is fetching', () => {
    renderCard({ fetching: true, body: <p>Loading</p> })

    expect(screen.getByText('Total analyzed unavailable')).toBeInTheDocument()
    expect(screen.queryByText('4 slices across Composition')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Loading')).toBeInTheDocument()
  })

  it('keeps row text as the accessible name and exposes expansion only on expandable rows', async () => {
    const { props, report } = renderCard()

    for (const row of stockRows()) expect(row).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(stockRows()[0])
    expect(props.onSelectLabel).toHaveBeenCalledWith('Stock')
    for (const row of stockRows()) expect(row).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(screen.getAllByRole('button', { name: /Edit Vanguard Total Stock Market ETF/i })[0])
    expect(props.onEditAsset).toHaveBeenCalledWith(report.slices[0].holdings[0].asset)
    expect(screen.getAllByText('Public Assets').length).toBeGreaterThan(0)

    const empty = slice('Empty', 1, 1)
    renderCard({ report: { ...report, slices: [empty] } })
    for (const row of screen.getAllByRole('button', { name: /^Empty/ })) expect(row).not.toHaveAttribute('aria-expanded')
  })

  it('clears the selection and collapses when the selected slice is clicked again', async () => {
    const onSelectLabel = vi.fn()
    function Harness() {
      const [selectedLabel, setSelectedLabel] = useState<string | null>(null)
      return <PortfolioCard accounts={accounts} amountsHidden={false} body={null} fetching={false} filters={{ ownerIds: [], accountGroupIds: [], accountIds: [], includeUnclassified: false }} owners={owners} report={analysisReportForView('COMPOSITION')} selectedLabel={selectedLabel} view="composition" onClearFilters={vi.fn()} onEditAsset={vi.fn()} onFilterChange={vi.fn()} onSelectLabel={(label) => { onSelectLabel(label); setSelectedLabel(label) }} onToggleAmountsHidden={vi.fn()} onViewChange={vi.fn()} />
    }
    renderWithProviders(<Harness />, { auth: {} })

    await userEvent.click(stockRows()[0])
    expect(onSelectLabel).toHaveBeenLastCalledWith('Stock')
    for (const row of stockRows()) expect(row).toHaveAttribute('aria-pressed', 'true')
    for (const row of stockRows()) expect(row).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(stockRows()[0])
    expect(onSelectLabel).toHaveBeenLastCalledWith(null)
    for (const row of stockRows()) expect(row).toHaveAttribute('aria-pressed', 'false')
    for (const row of stockRows()) expect(row).toHaveAttribute('aria-expanded', 'false')
  })

  it('links donut hover and selection to the rows', async () => {
    const { props } = renderCard()

    await userEvent.hover(stockRows()[0])
    expect(donutPath('Bond').style.opacity).toBe('0.35')
    expect(donutPath('Stock').style.opacity).toBe('1')
    await userEvent.unhover(stockRows()[0])
    expect(donutPath('Bond').style.opacity).toBe('1')

    await userEvent.hover(donutPath('Bond'))
    for (const row of screen.getAllByRole('button', { name: /^Bond/ })) expect(row).toHaveClass('bg-raised')
    for (const row of stockRows()) expect(row).not.toHaveClass('bg-raised')

    await userEvent.click(donutPath('Bond'))
    expect(props.onSelectLabel).toHaveBeenCalledWith('Bond')
  })

  it('highlights the selected slice and masks amounts while keeping weights visible', () => {
    renderCard({ amountsHidden: true, selectedLabel: 'Stock' })

    for (const row of stockRows()) expect(row).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByText(/•/).length).toBeGreaterThan(0)
    expect(screen.queryByText('$16,300.00')).not.toBeInTheDocument()
    expect(screen.getAllByText('70.0%').length).toBeGreaterThan(0)
  })

  it('flags the Unclassified slice with a note', () => {
    const report = analysisReportForView('COMPOSITION')
    renderCard({ report: { ...report, slices: [...report.slices, slice('Unclassified', 100, 1)] } })

    expect(screen.getAllByText('Analysis data not yet available for these holdings.')).toHaveLength(2)
  })

  it('opens the filter panel with owner, account type and account chips', async () => {
    const { props } = renderCard()

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    await userEvent.click(screen.getByRole('button', { name: 'Account type' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Tax Advantaged' }))
    expect(props.onFilterChange).toHaveBeenCalledWith({ accountGroupIds: ['TAX_ADVANTAGED'] })

    await userEvent.click(screen.getByRole('switch', { name: 'Include unclassified' }))
    expect(props.onFilterChange).toHaveBeenCalledWith({ includeUnclassified: true })
    expect(within(screen.getByRole('button', { name: 'Owner' })).getByText('Owner')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument()
  })

  it('omits the owner chip when owners are hidden', async () => {
    renderCard({}, true)

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    expect(screen.queryByRole('button', { name: 'Owner' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Account type' })).toBeInTheDocument()
  })

  it('renders the body in place of the breakdown when there are no slices', () => {
    renderCard({ body: <p>Nothing here</p>, report: { __typename: 'AnalysisReport', view: 'COMPOSITION', totalValueUSD: 0, slices: [] } })

    expect(screen.getByText('Nothing here')).toBeInTheDocument()
    expect(screen.getByText('0 slices across Composition')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
