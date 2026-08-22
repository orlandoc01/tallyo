import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { analysisReportForView } from '../../mocks/fixtures'
import type { AnalysisSlice } from '../../types/graphql'
import { AnalysisPieChart } from './AnalysisPieChart'
import { AnalysisSliceList } from './AnalysisSliceList'
import { AnalysisViewToggle } from './AnalysisViewToggle'

vi.mock('recharts', () => ({
  Cell: ({ onClick, onMouseEnter, onMouseLeave }: { onClick?: () => void; onMouseEnter?: () => void; onMouseLeave?: () => void }) => <button data-testid="pie-cell" onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} type="button" />,
  Pie: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
}))

describe('portfolio components', () => {
  it('changes analysis view', async () => {
    const onChange = vi.fn()
    render(<AnalysisViewToggle value="COMPOSITION" onChange={onChange} />)

    await userEvent.click(screen.getByRole('radio', { name: 'Sectors' }))

    expect(onChange).toHaveBeenCalledWith('SECTORS')
  })

  it('renders pie chart and reports clicked slice', async () => {
    const report = analysisReportForView('COMPOSITION')
    const onSliceClick = vi.fn()
    render(<AnalysisPieChart slices={report.slices} totalValueUSD={report.totalValueUSD} onSliceClick={onSliceClick} />)

    expect(screen.getByText('Total')).toBeInTheDocument()
    await userEvent.hover(screen.getAllByTestId('pie-cell')[0])
    expect(onSliceClick).toHaveBeenCalledWith('Stock')
    await userEvent.unhover(screen.getAllByTestId('pie-cell')[0])
    expect(onSliceClick).toHaveBeenCalledWith(null)

    await userEvent.click(screen.getAllByTestId('pie-cell')[0])

    expect(onSliceClick).toHaveBeenCalledWith('Stock')
  })

  it('masks pie chart and holding amounts when requested', async () => {
    const report = analysisReportForView('COMPOSITION')
    render(
      <>
        <AnalysisPieChart amountsHidden slices={report.slices} totalValueUSD={report.totalValueUSD} />
        <AnalysisSliceList amountsHidden slices={report.slices} />
      </>,
    )

    expect(screen.getAllByText('....').length).toBeGreaterThan(0)
    expect(screen.queryByText('$16,300.00')).not.toBeInTheDocument()

    await userEvent.click(screen.getByText('Stock'))

    expect(screen.getByText('Vanguard Total Stock Market ETF')).toBeInTheDocument()
    // VTI is held in two accounts in the fixture (brokerage + IRA); this slice
    // aggregates them into one row, so the percent reflects the combined value.
    expect(screen.getByText('55.0%')).toBeInTheDocument()
  })

  it('expands slices and shows holdings', async () => {
    const report = analysisReportForView('SECTORS')
    render(<AnalysisSliceList slices={report.slices} />)

    await userEvent.click(screen.getByText('Technology'))

    expect(screen.getByText('Vanguard Total Stock Market ETF')).toBeInTheDocument()
    expect(screen.getByText('Unassigned')).toBeInTheDocument()
    expect(screen.queryByText(/These holdings have no categorization for this view/)).not.toBeInTheDocument()
  })

  it('uses shared group styling for normal slices and special styling only for unclassified', () => {
    const slices: AnalysisSlice[] = [
      { __typename: 'AnalysisSlice', label: 'Technology', valueUSD: 600, percent: 60, holdings: [] },
      { __typename: 'AnalysisSlice', label: 'Unassigned', valueUSD: 300, percent: 30, holdings: [] },
      { __typename: 'AnalysisSlice', label: 'Unclassified', valueUSD: 100, percent: 10, holdings: [] },
    ]

    render(<AnalysisSliceList slices={slices} />)

    expect(screen.getByText('Unassigned').closest('section')).toHaveClass('border-neutral-100', 'bg-neutral-50')
    expect(screen.getByText('Unassigned').closest('section')).not.toHaveClass('border-dashed')
    expect(screen.getByText('Unclassified').closest('section')).toHaveClass('border-dashed')
  })

  it('uses net-worth selected styling and shared child backgrounds', async () => {
    const report = analysisReportForView('COMPOSITION')
    render(<AnalysisSliceList selectedLabel="Stock" slices={report.slices} />)

    const stockSection = screen.getByText('Stock').closest('section')
    expect(stockSection).toHaveClass('border-neutral-100', 'bg-neutral-50')
    expect(stockSection?.firstElementChild).toHaveClass('bg-brand-50', 'ring-brand-200')
    expect(stockSection?.firstElementChild?.className).not.toContain('hover:bg-neutral-100')

    await userEvent.click(screen.getByRole('button', { name: 'Expand Stock holdings' }))

    expect(screen.getByText('Vanguard Total Stock Market ETF').closest('.w-full')).toHaveClass('bg-neutral-50')
  })

  it('reports clicked holding assets for editing', async () => {
    const report = analysisReportForView('COMPOSITION')
    const onEditAsset = vi.fn()
    render(<AnalysisSliceList slices={report.slices} onEditAsset={onEditAsset} />)

    await userEvent.click(screen.getByText('Stock'))
    await userEvent.click(screen.getByRole('button', { name: /Edit Vanguard Total Stock Market ETF/i }))

    expect(onEditAsset).toHaveBeenCalledWith(report.slices[0].holdings[0].asset)
  })
})
