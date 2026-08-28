import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CompactDateRangeInputs, DateRangeSelector } from './DateRangeSelector'

describe('DateRangeSelector', () => {
  it('renders date inputs and granularity pills with current values', () => {
    render(
      <DateRangeSelector
        dateFrom="2026-05-01"
        dateTo="2026-05-31"
        granularity="MONTHLY"
        onChange={() => {}}
      />,
    )

    const dateInputs = screen.getAllByDisplayValue(/^2026-05/)
    expect(dateInputs).toHaveLength(2)
    expect(dateInputs[0]).toHaveValue('2026-05-01')
    expect(dateInputs[1]).toHaveValue('2026-05-31')
    expect(screen.getByLabelText('Date range preset')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Monthly' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Quarterly' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Yearly' })).toBeInTheDocument()
  })

  it('calls onChange when granularity is changed', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <DateRangeSelector
        dateFrom="2026-05-01"
        dateTo="2026-05-31"
        granularity="MONTHLY"
        onChange={onChange}
      />,
    )

    await user.click(screen.getByRole('radio', { name: 'Quarterly' }))
    expect(onChange).toHaveBeenCalledWith({ dateFrom: '2026-05-01', dateTo: '2026-05-31', granularity: 'QUARTERLY' })
  })

  it('calls onChange when start date is changed', () => {
    const onChange = vi.fn()

    render(
      <DateRangeSelector
        dateFrom="2026-05-01"
        dateTo="2026-05-31"
        granularity="MONTHLY"
        onChange={onChange}
      />,
    )

    const startInput = screen.getByDisplayValue('2026-05-01')
    fireEvent.change(startInput, { target: { value: '2026-04-01' } })
    expect(onChange).toHaveBeenCalledWith({ dateFrom: '2026-04-01', dateTo: '2026-05-31', granularity: 'MONTHLY' })
  })

  it('calls onChange when end date is changed', () => {
    const onChange = vi.fn()

    render(
      <DateRangeSelector
        dateFrom="2026-05-01"
        dateTo="2026-05-31"
        granularity="MONTHLY"
        onChange={onChange}
      />,
    )

    const endInput = screen.getByDisplayValue('2026-05-31')
    fireEvent.change(endInput, { target: { value: '2026-06-30' } })
    expect(onChange).toHaveBeenCalledWith({ dateFrom: '2026-05-01', dateTo: '2026-06-30', granularity: 'MONTHLY' })
  })

  it('highlights active granularity pill', () => {
    render(
      <DateRangeSelector
        dateFrom="2026-05-01"
        dateTo="2026-05-31"
        granularity="YEARLY"
        onChange={() => {}}
      />,
    )

    const yearlyButton = screen.getByRole('radio', { name: 'Yearly' })
    expect(yearlyButton).toHaveClass('bg-white', 'shadow-sm')
  })

  it('applies preset date ranges', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 15))
    const onChange = vi.fn()

    render(
      <DateRangeSelector
        dateFrom="2026-05-01"
        dateTo="2026-05-31"
        granularity="MONTHLY"
        onChange={onChange}
      />,
    )

    fireEvent.change(screen.getByLabelText('Date range preset'), { target: { value: 'last_month' } })
    expect(onChange).toHaveBeenCalledWith({ dateFrom: '2026-04-01', dateTo: '2026-04-30', granularity: 'MONTHLY' })
    vi.useRealTimers()
  })

  it('renders compact date range pills without a separator', () => {
    const onChange = vi.fn()

    render(
      <CompactDateRangeInputs
        dateFrom="2026-05-01"
        dateTo="2026-05-31"
        onChange={onChange}
      />,
    )

    expect(screen.getByText('05-01-26')).toBeInTheDocument()
    expect(screen.getByText('05-31-26')).toBeInTheDocument()
    expect(screen.queryByText('–')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-04-01' } })
    expect(onChange).toHaveBeenCalledWith({ dateFrom: '2026-04-01', dateTo: '2026-05-31' })
  })
})
