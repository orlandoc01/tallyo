import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { graphql, http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { setMasterPassword, setTokens } from './auth/tokenStore'
import { server } from './mocks/server'
import type { SpendingByCategoryReport } from './types/graphql'

const writerScopes = [
  'read:transactions',
  'write:transactions',
  'read:accounts',
  'write:accounts',
  'read:rules',
  'write:rules',
  'read:categories',
  'write:categories',
  'read:spending',
  'read:cashflow',
  'read:owners',
  'read:assets',
  'write:assets',
  'read:wealth',
  'write:wealth',
  'read:holdings',
  'read:portfolio',
  'read:budgets',
  'write:budgets',
  'read:tags',
  'write:tags',
]

const writerToken = createTestToken(writerScopes)

function createTestToken(scopes: string[]) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'none' }))
  const payload = base64UrlEncode(JSON.stringify({ scope: scopes.join(' ') }))
  return `${header}.${payload}.sig`
}

function base64UrlEncode(value: string) {
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function overflowSpendingReport(): SpendingByCategoryReport {
  const categories = Array.from({ length: 12 }, (_, index) => {
    const totalAmount = 120 - index * 10
    const category = {
      __typename: 'Category' as const,
      id: `overflow-${index + 1}`,
      name: `Overflow ${index + 1}`,
      emoji: '•',
      groupName: `Overflow group ${index + 1}`,
      groupEmoji: '•',
      kind: 'EXPENSE' as const,
      sortOrder: index,
      plaidPFC2Codes: [],
    }

    return {
      __typename: 'CategorySpendingAggregate' as const,
      category,
      totalAmount,
      transactionCount: 1,
      percentOfTotal: 0,
      periods: [],
    }
  })
  const totalAmount = categories.reduce((total, category) => total + category.totalAmount, 0)

  return {
    __typename: 'SpendingByCategoryReport',
    totalAmount,
    transactionCount: categories.length,
    periods: [{ __typename: 'SpendingAggregatePeriod', periodLabel: '2026-05', periodStart: '2026-05-01', periodEnd: '2026-05-31', totalAmount, transactionCount: categories.length }],
    categories,
  }
}

async function openTransactionFilters(user: { click: (element: Element) => Promise<void> }) {
  await user.click(screen.getByRole('button', { name: /^filters$/i }))
}

async function renderReportsPage() {
  const user = userEvent.setup()
  setTokens(writerToken, 'test-refresh-token')
  render(<App />)
  await screen.findByRole('tab', { name: 'Breakdown' })
  return user
}

async function renderTransactionsPage() {
  const user = userEvent.setup()
  setTokens(writerToken, 'test-refresh-token')
  render(<App />)
  await screen.findByRole('button', { name: /expand sidebar/i })
  await user.click(screen.getAllByRole('link', { name: /transactions/i })[0])
  expect((await screen.findAllByRole('heading', { name: 'Transactions' }))[0]).toBeInTheDocument()
  return user
}

describe('App integration', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-05-21T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.history.replaceState({}, '', '/')
  })

  it('renders the reports dashboard when a master password is stored', async () => {
    setMasterPassword('test-master-password')

    render(<App />)

    expect(await screen.findByRole('tab', { name: 'Breakdown' })).toBeInTheDocument()
  })

  it('redirects incomplete installs into the setup wizard', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('/auth/config', () => HttpResponse.json({
        master_password_status: 'ENABLED',
        email_auth_enabled: false,
        google_auth_enabled: false,
        webauthn_enabled: false,
        disable_all_auth: true,
        setup_complete: false,
        scopes: [],
      })),
    )
    window.history.pushState({}, '', '/transactions')

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Welcome to Tallyo' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: /get started/i }))
    await screen.findByRole('button', { name: /single password/i })
    await user.click(screen.getByRole('button', { name: /continue/i }))
    await user.type(await screen.findByLabelText(/^master password$/i), 'master-password')
    await user.type(screen.getByLabelText(/^confirm master password$/i), 'master-password')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByRole('heading', { name: 'Who owns the accounts?' })).toBeInTheDocument()
  })

  it('shows uncategorized and categorized transactions on review page', async () => {
    const user = userEvent.setup()
    setTokens(writerToken, 'test-refresh-token')

    render(<App />)

    expect(await screen.findByRole('tab', { name: 'Breakdown' })).toBeInTheDocument()
    expect(await screen.findAllByText(/Restaurants & Bars/)).not.toHaveLength(0)
    expect(await screen.findAllByText('Transactions')).not.toHaveLength(0)

    // Settings is visible to all authenticated users; Access management inside it remains scope-gated.
    await user.click(screen.getByRole('button', { name: /open menu/i }))
    expect(screen.getAllByRole('link', { name: /settings/i })).not.toHaveLength(0)
    await user.click(screen.getByRole('button', { name: /close menu/i }))
  })

  it('logs out and returns to auth gate', async () => {
    const user = userEvent.setup()
    setTokens(writerToken, 'test-refresh-token')

    render(<App />)

    await screen.findByRole('tab', { name: 'Breakdown' })

    await user.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument())
  })

  it('shows auth callback page and error on invalid callback', async () => {
    const originalLocation = window.location
    // @ts-expect-error — replacing location for test
    delete window.location
    // @ts-expect-error — search property spread conflict with Location type
    window.location = { ...originalLocation, pathname: '/auth/callback', search: '?code=code&state=wrong' }

    render(<App />)

    expect(await screen.findByText(/state/i)).toBeInTheDocument()

    // @ts-expect-error — restoring location
    window.location = originalLocation
  })

  it('collapses and expands the sidebar', async () => {
    const user = userEvent.setup()
    setTokens(writerToken, 'test-refresh-token')

    render(<App />)

    await screen.findByRole('tab', { name: 'Breakdown' })

    expect(screen.getByRole('button', { name: /expand sidebar/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /expand sidebar/i }))
    expect(screen.getByRole('button', { name: /collapse sidebar/i })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /transactions/i })).not.toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /collapse sidebar/i }))
    expect(screen.getByRole('button', { name: /expand sidebar/i })).toBeInTheDocument()
  })

  it('filters report transactions when focusing a breakdown category', async () => {
    const user = await renderReportsPage()
    expect(await screen.findAllByText('Target')).not.toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /Restaurants & Bars.*\$150\.00/ }))

    expect(await screen.findByRole('button', { name: /Clear filter/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryAllByText('Target')).toHaveLength(0))

    await user.click(screen.getByRole('button', { name: /Clear filter/ }))

    expect(await screen.findAllByText('Target')).not.toHaveLength(0)
  })

  it('filters report transactions from the Everything else breakdown bar', async () => {
    const graphqlApi = graphql.link('/query')
    const transactionCategoryFilters: Array<string[] | undefined> = []
    server.use(
      graphqlApi.query('SpendingByCategory', () => HttpResponse.json({
        data: { spendingByCategory: overflowSpendingReport() },
      })),
      graphqlApi.query('Transactions', ({ variables }) => {
        const input = variables.input as { filter?: { categoryIds?: string[] } }
        transactionCategoryFilters.push(input.filter?.categoryIds)
        return HttpResponse.json({
          data: {
            transactions: {
              __typename: 'TransactionConnection',
              edges: [],
              pageInfo: { __typename: 'PageInfo', hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null },
              totalCount: 0,
            },
          },
        })
      }),
    )

    const user = await renderReportsPage()
    await user.click(await screen.findByRole('button', { name: /Everything else.*\$30\.00/ }))

    await waitFor(() => expect(transactionCategoryFilters).toContainEqual(['overflow-11', 'overflow-12']))
  })

  it('filters reports and report transactions from the global category dropdown', async () => {
    const user = await renderReportsPage()
    expect(await screen.findAllByText('Target')).not.toHaveLength(0)

    await openReportCategoryFilters(user)
    await user.click(screen.getByLabelText(/Restaurants & Bars/))
    await waitFor(() => expect(screen.getByRole('button', { name: /filters: 1 selected/i })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /filters: 1 selected/i }))

    expect(await screen.findByRole('button', { name: /Restaurants & Bars.*\$150\.00/ })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Target')).not.toBeInTheDocument())

    await user.click(screen.getByRole('tab', { name: 'Trends' }))

    expect(screen.getAllByText(/Restaurants & Bars/)).not.toHaveLength(0)
    expect(screen.queryByText(/Groceries/)).not.toBeInTheDocument()
  }, 10000)

  it('toggles all and grouped categories from the reports dropdown', async () => {
    const user = await renderReportsPage()

    await openReportCategoryFilters(user)
    await user.click(screen.getByLabelText(/select all/i))
    expect(screen.getByRole('button', { name: /filters: 9 selected/i })).toBeInTheDocument()

    await user.click(screen.getByLabelText(/Food/i))
    expect(screen.getByRole('button', { name: /filters: 7 selected/i })).toBeInTheDocument()
  }, 10000)

  it('filters categories inside the reports dropdown search without narrowing select-all', async () => {
    const user = await renderReportsPage()

    await openReportCategoryFilters(user)
    await user.type(screen.getByLabelText(/category search/i), 'bars')

    expect(screen.getByLabelText(/restaurants & bars/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/groceries/i)).not.toBeInTheDocument()

    await user.click(screen.getByLabelText(/select all/i))
    expect(screen.getByRole('button', { name: /filters: 9 selected/i })).toBeInTheDocument()
  })

  it('switches report tabs and group-by mode', async () => {
    const user = await renderReportsPage()

    await user.click(screen.getByRole('tab', { name: 'Trends' }))

    await user.click(screen.getByRole('radio', { name: /By group/i }))
    expect(screen.getByText(/Food/)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /By category/i }))
    expect(await screen.findAllByText(/Restaurants & Bars/)).not.toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /^filters$/i }))
    fireEvent.change(screen.getByLabelText(/start date/i, { selector: 'input' }), { target: { value: '2026-05-01' } })

    const mobileQuarterlyButton = screen.getAllByRole('button', { name: 'Quarterly' }).at(-1)
    if (mobileQuarterlyButton) {
      await user.click(mobileQuarterlyButton)
    }
  })

  async function openReportCategoryFilters(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: /^filters$/i }))
    await user.click(screen.getByRole('button', { name: /categories all/i }))
  }

  it('navigates through the main app pages', async () => {
    const user = userEvent.setup()
    setTokens(writerToken, 'test-refresh-token')

    render(<App />)

    await screen.findByRole('tab', { name: 'Breakdown' })

    await user.click(screen.getAllByRole('link', { name: /portfolio/i })[0])
    expect(await screen.findByRole('heading', { name: 'Allocation' })).toBeInTheDocument()

    await user.click(screen.getAllByRole('link', { name: /cash flow/i })[0])
    expect(await screen.findAllByText('Income')).not.toHaveLength(0)

    await user.click(screen.getAllByRole('link', { name: /transactions/i })[0])
    expect((await screen.findAllByRole('heading', { name: 'Transactions' }))[0]).toBeInTheDocument()
    expect(await screen.findAllByText('Target')).not.toHaveLength(0)

    await user.click(screen.getAllByRole('link', { name: /review/i })[0])
    expect(await screen.findByRole('link', { current: 'page', name: 'Transactions' })).toBeInTheDocument()
    expect(await screen.findAllByText('Cloudflare')).not.toHaveLength(0)

    await user.click(screen.getAllByRole('link', { name: /recurring/i })[0])
    expect(await screen.findByText('Netflix')).toBeInTheDocument()
    expect(await screen.findByText('Netflix')).toBeInTheDocument()

    await user.click(screen.getAllByRole('link', { name: /settings/i })[0])
    await user.click(await screen.findByRole('link', { name: /rules/i }))
    expect(await screen.findAllByRole('button', { name: /^add$/i })).not.toHaveLength(0)

    await user.click(screen.getAllByRole('link', { name: /accounts/i })[0])
    expect(await screen.findByRole('button', { name: /link connection/i })).toBeInTheDocument()
    expect(await screen.findByText('American Express')).toBeInTheDocument()
  }, 10000)

  it('toggles portfolio amount visibility without resetting filters and remembers it in sticky nav', async () => {
    const user = userEvent.setup()
    setTokens(writerToken, 'test-refresh-token')
    window.history.pushState({}, '', '/portfolio?view=sectors&owners=owner-1')

    render(<App />)

    expect(await screen.findByText('Technology')).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: 'Hide amounts' })[0])

    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe('/portfolio?view=sectors&owners=owner-1&hide_amounts=true')
    })
    expect(screen.getAllByRole('button', { name: 'Show amounts' }).length).toBeGreaterThan(0)

    await user.click(screen.getAllByRole('link', { name: /cash flow/i })[0])
    expect(await screen.findAllByText('Income')).not.toHaveLength(0)

    await user.click(screen.getAllByRole('link', { name: /portfolio/i })[0])

    await waitFor(() => {
      expect(window.location.pathname + window.location.search).toBe('/portfolio?view=sectors&owners=owner-1&hide_amounts=true')
    })
  }, 10000)

  it('opens the mobile hamburger menu and signs out from it', async () => {
    const user = userEvent.setup()
    // Token with read:users so the Settings link renders in the hamburger
    const token = `eyJhbGciOiJub25lIn0.${'eyJzY29wZSI6InJlYWQ6dXNlcnMgcmVhZDp0cmFuc2FjdGlvbnMgd3JpdGU6dHJhbnNhY3Rpb25zIHJlYWQ6YWNjb3VudHMgd3JpdGU6YWNjb3VudHMgcmVhZDpydWxlcyB3cml0ZTpydWxlcyByZWFkOmNhdGVnb3JpZXMgd3JpdGU6Y2F0ZWdvcmllcyByZWFkOnNwZW5kaW5nIHJlYWQ6Y2FzaGZsb3cifQ'}.sig`
    setTokens(token, 'test-refresh-token')
    window.history.pushState({}, '', '/')
    render(<App />)

    await screen.findByRole('tab', { name: 'Breakdown' })

    // Open hamburger
    await user.click(screen.getByRole('button', { name: /open menu/i }))
    expect(screen.getByRole('button', { name: /close menu/i })).toBeInTheDocument()

    // Settings link is pinned in the hamburger's bottom section (dual-view: both desktop sidebar + hamburger render in JSDOM)
    expect(screen.getAllByRole('link', { name: /settings/i }).length).toBeGreaterThanOrEqual(2)

    // Sign out via the hamburger panel's button (last "Sign out" in DOM order)
    const signOutButtons = screen.getAllByRole('button', { name: /sign out/i })
    await user.click(signOutButtons[signOutButtons.length - 1])

    await waitFor(() => expect(screen.getByRole('button', { name: /sign in with google/i })).toBeInTheDocument())
  })

  it('renders the Access settings page with user management when signed in as admin', async () => {
    const user = userEvent.setup()
    // header.{"scope":"write:users read:users"}.sig — lets canWrite('users') return true
    const adminToken = `eyJhbGciOiJub25lIn0.eyJzY29wZSI6IndyaXRlOnVzZXJzIHJlYWQ6dXNlcnMifQ.sig`
    setTokens(adminToken, 'test-refresh-token')
    window.history.pushState({}, '', '/settings/access')
    render(<App />)

    expect(await screen.findByRole('link', { name: /access/i })).toBeInTheDocument()
    expect(await screen.findByText('alice@example.com')).toBeInTheDocument()

    // Open invite form
    await user.click(screen.getByRole('button', { name: /\+ add user/i }))
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument()

    // Cancel invite form
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument()

    window.history.pushState({}, '', '/')
  })

  it('shows next expected date on the recurring page', async () => {
    const user = userEvent.setup()
    setTokens(writerToken, 'test-refresh-token')

    render(<App />)

    await user.click(screen.getAllByRole('link', { name: /recurring/i })[0])
    expect(await screen.findByText('Netflix')).toBeInTheDocument()
    expect(await screen.findByText('Netflix')).toBeInTheDocument()
    expect(screen.getByText(/Next expected/)).toBeInTheDocument()
  })

  it('filters and sorts the transactions page', async () => {
    const user = await renderTransactionsPage()
    expect((await screen.findAllByText('Target'))[0]).toBeInTheDocument()
    expect(screen.queryByText('+$52.12')).not.toBeInTheDocument()

    await openTransactionFilters(user)
    await user.click(screen.getByRole('switch', { name: /include hidden/i }))

    expect((await screen.findAllByText('+$52.12'))[0]).toBeInTheDocument()

    await user.selectOptions(screen.getAllByLabelText(/sort/i)[0], 'AMOUNT:ASC')

    await waitFor(() => {
      const credit = screen.getAllByText('+$52.12')[0]
      const debits = screen.getAllByText('$62.30')
      const debit = debits[debits.length - 1]
      expect(credit.compareDocumentPosition(debit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    await user.click(screen.getByRole('button', { name: 'Date range' }))
    fireEvent.change(screen.getByLabelText(/start date/i, { selector: 'input' }), { target: { value: '2026-05-16' } })
    fireEvent.change(screen.getByLabelText(/end date/i, { selector: 'input' }), { target: { value: '2026-05-31' } })

    expect((await screen.findAllByText('No transactions found'))[0]).toBeInTheDocument()
    expect(screen.getAllByText('Import / Export')).not.toHaveLength(0)
  })

  it('opens and applies the mobile transaction filters overlay', async () => {
    const user = await renderTransactionsPage()

    await user.click(screen.getByRole('button', { name: /open filters/i }))
    // Mobile overlay has a unique "Close filters" button not present in the desktop sidebar
    expect(screen.getByRole('button', { name: /close filters/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^apply$/i }))
    expect(screen.queryByRole('button', { name: /close filters/i })).not.toBeInTheDocument()
  })

  it('dismisses the mobile transaction filters overlay via the X button', async () => {
    const user = await renderTransactionsPage()

    await user.click(screen.getByRole('button', { name: /open filters/i }))
    expect(screen.getByRole('button', { name: /close filters/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /close filters/i }))
    expect(screen.queryByRole('button', { name: /close filters/i })).not.toBeInTheDocument()
  })

  it('clears mobile transaction filters from the overlay', async () => {
    const user = await renderTransactionsPage()

    await user.click(screen.getByRole('button', { name: /open filters/i }))
    let dialog = screen.getByRole('dialog', { name: /filters/i })
    expect(within(dialog).getByRole('button', { name: /close filters/i })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Owner' }))
    await user.click(within(dialog).getByRole('checkbox', { name: 'sam' }))
    await user.click(within(dialog).getByRole('button', { name: /^apply$/i }))

    await waitFor(() => expect(window.location.search).toBe('?owner_ids=owner-2'))

    await user.click(screen.getByRole('button', { name: /open filters/i }))
    dialog = screen.getByRole('dialog', { name: /filters/i })

    await user.click(within(dialog).getByRole('button', { name: /^clear all$/i }))
    expect(screen.queryByRole('button', { name: /close filters/i })).not.toBeInTheDocument()
    await waitFor(() => expect(window.location.search).toBe(''))

    await user.click(screen.getByRole('button', { name: /open filters/i }))
    dialog = screen.getByRole('dialog', { name: /filters/i })
    await user.click(within(dialog).getByRole('button', { name: /^apply$/i }))

    expect(window.location.search).toBe('')
  })

  it('navigates to the categories page', async () => {
    const user = userEvent.setup()
    setTokens(writerToken, 'test-refresh-token')
    window.history.pushState({}, '', '/')

    render(<App />)

    await screen.findByRole('button', { name: /expand sidebar/i })
    await user.click(screen.getByRole('link', { name: /settings/i }))
    await user.click(await screen.findByRole('link', { name: /categories/i }))

    expect(await screen.findByText('Food')).toBeInTheDocument()
    expect(await screen.findByText('Food')).toBeInTheDocument()

    window.history.pushState({}, '', '/')
  })

  it('searches transactions with the global full-text search box', async () => {
    const user = await renderTransactionsPage()

    const searchInput = screen.getByRole('textbox', { name: /search transactions/i })
    await user.type(searchInput, 'ACME')

    expect(searchInput).toHaveValue('ACME')
    await waitFor(() => {
      expect(screen.getAllByText('Employer Direct Deposit')).not.toHaveLength(0)
      expect(screen.queryAllByText('Target')).toHaveLength(0)
      expect(screen.queryAllByText('Cloudflare')).toHaveLength(0)
    }, { timeout: 3000 })
  })

  it('filters transactions immediately while pushing one global search session', async () => {
    await renderTransactionsPage()

    expect(await screen.findAllByText('Target')).not.toHaveLength(0)
    expect(await screen.findAllByText('Cloudflare')).not.toHaveLength(0)
    const historyLengthBeforeSearch = window.history.length

    const searchInput = screen.getByRole('textbox', { name: /search transactions/i })
    fireEvent.change(searchInput, { target: { value: 'AC' } })
    fireEvent.change(searchInput, { target: { value: 'ACME' } })

    expect(searchInput).toHaveValue('ACME')
    await waitFor(() => {
      expect(window.location.search).toBe('?q=ACME')
    })
    expect(window.history.length).toBe(historyLengthBeforeSearch + 1)
  })

  it('initializes transaction global search from q', async () => {
    setTokens(writerToken, 'test-refresh-token')
    window.history.pushState({}, '', '/transactions?q=ACME')

    render(<App />)

    const searchInput = await screen.findByRole('textbox', { name: /search transactions/i })
    expect(searchInput).toHaveValue('ACME')
    await waitFor(() => {
      expect(screen.getAllByText('Employer Direct Deposit')).not.toHaveLength(0)
      expect(screen.queryAllByText('Target')).toHaveLength(0)
      expect(screen.queryAllByText('Cloudflare')).toHaveLength(0)
    })
  })

  it('clears transaction global search when clearing filters', async () => {
    const user = userEvent.setup()
    setTokens(writerToken, 'test-refresh-token')
    window.history.pushState({}, '', '/transactions?q=ACME&owner_ids=owner-2')

    render(<App />)

    const searchInput = await screen.findByRole('textbox', { name: /search transactions/i })
    expect(searchInput).toHaveValue('ACME')

    await openTransactionFilters(user)
    await user.click(screen.getByRole('button', { name: /clear filters/i }))

    expect(searchInput).toHaveValue('')
    expect(window.location.search).toBe('')
  })

  it('filters transactions immediately while pushing one transaction text session', async () => {
    const user = await renderTransactionsPage()

    expect(await screen.findAllByText('Target')).not.toHaveLength(0)
    expect(await screen.findAllByText('Cloudflare')).not.toHaveLength(0)
    const historyLengthBeforeSearch = window.history.length

    await openTransactionFilters(user)
    await user.click(screen.getByRole('button', { name: 'Text' }))
    fireEvent.change(screen.getByPlaceholderText(/merchant name/i), { target: { value: 'Cloud' } })

    await waitFor(() => {
      expect(screen.queryAllByText('Target')).toHaveLength(0)
      expect(screen.getAllByText('Cloudflare')).not.toHaveLength(0)
    })
    expect(window.location.search).toBe('?merchant_prefix=Cloud')
    expect(window.history.length).toBe(historyLengthBeforeSearch + 1)

    fireEvent.change(screen.getByPlaceholderText(/merchant name/i), { target: { value: '' } })
    fireEvent.change(screen.getByPlaceholderText(/original name/i), { target: { value: 'TARGET STORE' } })

    await waitFor(() => {
      expect(screen.getAllByText('Target')).not.toHaveLength(0)
      expect(screen.queryAllByText('Cloudflare')).toHaveLength(0)
    })
    expect(window.location.search).toBe('?original_prefix=TARGET+STORE')
    expect(window.history.length).toBe(historyLengthBeforeSearch + 2)
  })

  it('pushes one transaction search text session before another filter pushes history', async () => {
    const user = await renderTransactionsPage()

    const historyLengthBeforeSearch = window.history.length

    await openTransactionFilters(user)
    await user.click(screen.getByRole('button', { name: 'Text' }))
    await user.click(screen.getByRole('button', { name: 'Owner' }))
    await user.type(screen.getByPlaceholderText(/merchant name/i), 'Tar')
    await waitFor(() => {
      expect(window.location.search).toBe('?merchant_prefix=Tar')
    })
    expect(window.history.length).toBe(historyLengthBeforeSearch + 1)

    await user.click(screen.getByRole('checkbox', { name: 'sam' }))

    await waitFor(() => {
      expect(window.location.search).toContain('merchant_prefix=Tar')
      expect(window.location.search).toContain('owner_ids=owner-2')
    })
    expect(window.history.length).toBe(historyLengthBeforeSearch + 2)
  })

  // -------------------------------------------------------------------------
  // Mobile bottom nav positioning — regression test.
  //
  // This bug has been reported and "fixed" four times (issues #17, #52, #62,
  // #78), always with the same symptom: on mobile, scrolling makes the nav
  // bar drift up into the page instead of staying pinned to the viewport
  // bottom, so it appears to "float to the center" of the screen. Each prior
  // fix patched one failure mode but left another reachable; together, the
  // four invariants below describe every condition the production CSS+JSX
  // must satisfy to keep the nav pinned. If any one slips, the bug returns.
  //
  //   1. The nav is portaled to <body> (no descendant containing block can
  //      catch its `position: fixed`).
  //   2. The nav has inline positioning styles (`position`, `bottom`, `left`,
  //      `right`, `top: auto`, `margin: 0`) — they survive a class refactor.
  //   3. The nav carries the `mobile-bottom-nav` class, which re-declares the
  //      same positioning with `!important` (defends against any third-party
  //      or future stylesheet whose rule beats the inline declaration).
  //   4. No ancestor of <body> has `transform`/`filter`/`perspective`/etc.
  //      set inline (any of those would establish a containing block).
  //
  // The test runs on every authenticated route — including deep routes like
  // `/transactions/:id` and `/accounts/:id/info` — because the bug has historically
  // surfaced one route at a time when a page added its own layout chrome.
  // -------------------------------------------------------------------------
  describe.each([
    '/expenses',
    '/net-worth',
    '/net-worth/accounts/acct-1/valuation',
    '/net-worth/assets/asset-usd',
    '/portfolio',
    '/cash-flow',
    '/budgets',
    '/transactions',
    '/transactions/txn-1',
    '/review',
    '/review/transactions',
    '/review/accounts',
    '/review/balances',
    '/review/assets',
    '/recurring',
    '/accounts',
    '/accounts/acct-1',
    '/accounts/acct-1/info',
    '/accounts/acct-1/valuation',
    '/settings/rules',
    '/settings/rules/rule-1',
    '/settings/categories',
    '/settings/assets/asset-usd/tracking',
    '/settings',
  ])('mobile bottom nav positioning on %s', (route) => {
    it('is portaled to <body> with viewport-fixed positioning and no duplicates', async () => {
      setTokens(writerToken, 'test-refresh-token')
      window.history.pushState({}, '', route)

      const { container } = render(<App />)

      const nav = await screen.findByRole('navigation', { name: 'Mobile navigation' })

      // Invariant 1 — portal target: must be a direct child of <body> so that
      // no ancestor's `transform`, `filter`, `perspective`, or `contain` can
      // create a new containing block that breaks `position: fixed`.
      expect(nav.parentElement).toBe(document.body)
      expect(container).not.toContainElement(nav)

      // Invariant 2 — inline positioning survives class refactors. Tailwind
      // utilities can be stripped or renamed in a sweep; inline `style={...}`
      // can't be lost without an explicit code change to this file.
      expect(nav.style.position).toBe('fixed')
      expect(nav.style.bottom).toBe('0px')
      expect(nav.style.left).toBe('0px')
      expect(nav.style.right).toBe('0px')
      expect(nav.style.width).toBe('100vw')
      expect(nav.style.maxWidth).toBe('none')
      // `top: auto` prevents an outside rule that sets `top: …` from
      // stretching the bar to fill the viewport (visually: "floats up").
      expect(nav.style.top).toBe('auto')
      // `margin: 0` prevents a global margin rule from offsetting the bar.
      // React serializes the inline `margin: 0` as `"0px"` for each side.
      expect(nav.style.margin === '0px' || nav.style.margin === '0').toBe(true)

      // Invariant 3 — the `mobile-bottom-nav` class is present. The class
      // re-declares the positioning with `!important` in styles/index.css,
      // so any future external CSS that tries to override the inline styles
      // still loses (browsers compare specificity, not source order, for
      // `!important` declarations against inline styles).
      expect(nav.className).toContain('mobile-bottom-nav')

      // The nav must stay hidden on desktop. Tailwind's `lg:hidden` is the
      // only intended hide mechanism; assert it is still in the class list.
      expect(nav.className).toContain('lg:hidden')

      // Invariant 4 — no ancestor of <body> has any inline style that would
      // introduce a containing block. The companion CSS rule
      // `html, body { transform: none !important; ... }` blocks the same
      // properties from being added via a class.
      for (let ancestor: HTMLElement | null = document.body; ancestor; ancestor = ancestor.parentElement) {
        expect(ancestor.style.transform === '' || ancestor.style.transform === 'none').toBe(true)
        expect(ancestor.style.filter === '' || ancestor.style.filter === 'none').toBe(true)
        expect(ancestor.style.perspective === '' || ancestor.style.perspective === 'none').toBe(true)
      }

      // Exactly one mobile nav — guards against an accidental second copy
      // (e.g., a page rendering its own bottom nav alongside the shell).
      expect(screen.getAllByRole('navigation', { name: 'Mobile navigation' })).toHaveLength(1)
      expect(nav.querySelectorAll('a')).toHaveLength(4)

      window.history.pushState({}, '', '/')
    })
  })

  // The css rule above (`html, body { transform: none !important; ... }`) is
  // the only thing that catches a containing-block regression introduced via
  // a CSS class on <html>/<body> — and JSDOM doesn't apply external CSS, so
  // we assert the rule's text directly from the imported stylesheet instead.
  it('keeps containing-block-creating properties off <html> and <body> via index.css', async () => {
    const cssModule = await import('./styles/index.css?raw')
    const css = cssModule.default

    // The rule that prevents any class on html/body from creating a new
    // containing block for the portaled nav.
    expect(css).toMatch(/html\s*,\s*body\s*\{[^}]*transform:\s*none\s*!important/)
    expect(css).toMatch(/html\s*,\s*body\s*\{[^}]*filter:\s*none\s*!important/)
    expect(css).toMatch(/html\s*,\s*body\s*\{[^}]*perspective:\s*none\s*!important/)

    // The class that re-declares the nav's positioning with !important so
    // external CSS cannot win against the inline styles.
    expect(css).toMatch(/\.mobile-bottom-nav\s*\{[^}]*position:\s*fixed\s*!important/)
    expect(css).toMatch(/\.mobile-bottom-nav\s*\{[^}]*bottom:\s*0\s*!important/)
    expect(css).toMatch(/\.mobile-bottom-nav\s*\{[^}]*left:\s*0\s*!important/)
    expect(css).toMatch(/\.mobile-bottom-nav\s*\{[^}]*right:\s*0\s*!important/)
    expect(css).toMatch(/\.mobile-bottom-nav\s*\{[^}]*top:\s*auto\s*!important/)
    expect(css).toMatch(/\.mobile-bottom-nav\s*\{[^}]*width:\s*100vw\s*!important/)
    expect(css).toMatch(/\.mobile-bottom-nav\s*\{[^}]*max-width:\s*none\s*!important/)
  })
})
