import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router'
import { renderWithProviders } from '../test/renderWithProviders'
import { SectionHistoryProvider } from './SectionHistoryProvider'
import { STORAGE_KEY } from './sectionHistory'
import { useSectionHistory } from './useSectionHistory'

function HistoryProbe() {
  const { peek, stickyNavProps } = useSectionHistory()
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <>
      <output aria-label="current-url">{location.pathname + location.search + location.hash}</output>
      <Link aria-label="expenses-nav" {...stickyNavProps('/expenses/breakdown')}>Expenses</Link>
      <Link aria-label="portfolio-nav" {...stickyNavProps('/portfolio')}>Portfolio</Link>
      <Link aria-label="transactions-nav" {...stickyNavProps('/transactions')}>Transactions</Link>
      <output aria-label="unvisited-account">{peek('accounts') ?? 'none'}</output>
      <button onClick={() => navigate('/settings/general')} type="button">Settings</button>
      <button onClick={() => navigate('/budgets/2026-06')} type="button">Budget</button>
      <button onClick={() => navigate('/review/transactions')} type="button">Review</button>
      <button onClick={() => navigate('/transactions?q=MEGA')} type="button">Filtered transactions</button>
      <button onClick={() => navigate('/transactions')} type="button">Default transactions</button>
    </>
  )
}

function renderProvider(initialEntry: string) {
  return renderWithProviders(
    <SectionHistoryProvider>
      <Routes>
        <Route element={<HistoryProbe />} path="*" />
      </Routes>
    </SectionHistoryProvider>,
    { initialEntries: [initialEntry] },
  )
}

describe('SectionHistoryProvider', () => {
  it('records and persists full sticky section URLs', async () => {
    renderProvider('/expenses/breakdown?granularity=YEARLY#chart')

    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify({
        expenses: '/expenses/breakdown?granularity=YEARLY#chart',
      }))
    })
  })

  it('does not record non-sticky routes', async () => {
    renderProvider('/settings/general')

    await waitFor(() => {
      expect(localStorage.getItem(STORAGE_KEY)).toBe('{}')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Budget' }))

    await waitFor(() => {
      expect(screen.getByLabelText('current-url')).toHaveTextContent('/budgets/2026-06')
    })
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{}')

    fireEvent.click(screen.getByRole('button', { name: 'Review' }))

    await waitFor(() => {
      expect(screen.getByLabelText('current-url')).toHaveTextContent('/review/transactions')
    })
    expect(localStorage.getItem(STORAGE_KEY)).toBe('{}')
  })

  it('reads persisted history on remount', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      expenses: '/expenses/trends?range=12m',
    }))

    renderProvider('/transactions')

    const link = await screen.findByLabelText('expenses-nav')
    expect(link).toHaveAttribute('href', '/expenses/breakdown')

    fireEvent.click(link)

    await waitFor(() => {
      expect(screen.getByLabelText('current-url')).toHaveTextContent('/expenses/trends?range=12m')
    })
  })

  it('keeps only the most recent full URL for a sticky section', async () => {
    renderProvider('/transactions?q=ACME&owner_ids=owner-2')

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
        transactions: '/transactions?q=ACME&owner_ids=owner-2',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Filtered transactions' }))

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
        transactions: '/transactions?q=MEGA',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Default transactions' }))

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
        transactions: '/transactions',
      })
    })
  })

  it('lets the default section URL replace a remembered filtered URL', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      transactions: '/transactions?q=ACME',
    }))

    renderProvider('/transactions')

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
        transactions: '/transactions',
      })
    })

    fireEvent.click(screen.getByLabelText('portfolio-nav'))

    await waitFor(() => {
      expect(screen.getByLabelText('current-url')).toHaveTextContent('/portfolio')
    })

    fireEvent.click(screen.getByLabelText('transactions-nav'))

    await waitFor(() => {
      expect(screen.getByLabelText('current-url')).toHaveTextContent('/transactions')
    })
  })

  it('restores sticky history only from an explicit sticky nav click', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      transactions: '/transactions?q=ACME',
    }))

    renderProvider('/expenses/breakdown')

    const link = await screen.findByLabelText('transactions-nav')
    expect(link).toHaveAttribute('href', '/transactions')

    fireEvent.click(link)

    await waitFor(() => {
      expect(screen.getByLabelText('current-url')).toHaveTextContent('/transactions?q=ACME')
    })
  })

  it('returns undefined from peek for unvisited sections', async () => {
    renderProvider('/expenses/breakdown')

    await waitFor(() => {
      expect(screen.getByLabelText('unvisited-account')).toHaveTextContent('none')
    })
  })
})
