import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { CollapsibleFilterSection } from './CollapsibleFilterSection'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { LoadingSpinner } from './LoadingSpinner'
import { QueryGate } from './QueryGate'

describe('common UI states', () => {
  it('renders empty state title and description', () => {
    render(<EmptyState description="Nothing matched the current filters." title="No results" />)

    expect(screen.getByText('No results')).toBeInTheDocument()
    expect(screen.getByText('Nothing matched the current filters.')).toBeInTheDocument()
  })

  it('renders optional common states without secondary actions', () => {
    render(
      <>
        <EmptyState title="No data" />
        <ErrorState message="Offline." />
      </>,
    )

    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Offline.')
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })

  it('renders an error state and retries', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()

    render(<ErrorState message="Could not load data." onRetry={onRetry} />)
    await user.click(screen.getByRole('button', { name: /retry/i }))

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load data.')
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('renders loading state', () => {
    render(<LoadingSpinner label="Loading reports" />)

    expect(screen.getByRole('status')).toHaveTextContent('Loading reports')
  })

  it('gates query state rendering', async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    const { rerender } = render(
      <QueryGate data={undefined} empty={false} emptyTitle="No rows" error={undefined} fetching loadingLabel="Loading rows" onRetry={onRetry}>
        <div>Rows loaded</div>
      </QueryGate>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Loading rows')
    expect(screen.queryByText('Rows loaded')).not.toBeInTheDocument()

    rerender(
      <QueryGate data={{ rows: [] }} empty={false} emptyTitle="No rows" error={{ message: 'Offline' }} errorPrefix="Failed" fetching={false} onRetry={onRetry}>
        <div>Rows loaded</div>
      </QueryGate>,
    )
    await user.click(screen.getByRole('button', { name: /retry/i }))
    expect(screen.getByRole('alert')).toHaveTextContent('Failed: Offline')
    expect(onRetry).toHaveBeenCalledOnce()

    rerender(
      <QueryGate data={{ rows: [] }} empty emptyTitle="No rows" error={undefined} fetching={false}>
        <div>Rows loaded</div>
      </QueryGate>,
    )
    expect(screen.getByText('No rows')).toBeInTheDocument()

    rerender(
      <QueryGate data={{ rows: [1] }} empty={false} emptyTitle="No rows" error={undefined} fetching>
        <div>Rows loaded</div>
      </QueryGate>,
    )
    expect(screen.getByText('Rows loaded')).toBeInTheDocument()
  })

  it('renders shared button variants', () => {
    render(
      <>
        <Button>Primary</Button>
        <Button size="sm" variant="secondary">Secondary</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="ghost">Ghost</Button>
      </>,
    )

    expect(screen.getByRole('button', { name: 'Primary' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Secondary' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Danger' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ghost' })).toBeInTheDocument()
  })

  it('highlights active collapsible filter section headers', () => {
    render(
      <CollapsibleFilterSection active expanded={false} label="Accounts" summary="2 selected" onToggle={vi.fn()}>
        <div>Account filters</div>
      </CollapsibleFilterSection>,
    )

    const header = screen.getByRole('button', { name: /accounts/i })
    expect(header).toHaveClass('border-brand-200')
    expect(header).toHaveClass('bg-brand-50/70')
    expect(header).toHaveClass('ring-brand-200')
    expect(screen.queryByText('Account filters')).not.toBeInTheDocument()
  })
})
