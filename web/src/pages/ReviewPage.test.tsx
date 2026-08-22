import { fireEvent, screen } from '@testing-library/react'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { absoluteRoutePath, REVIEW_PATHS } from '../routes'
import { renderWithProviders } from '../test/renderWithProviders'
import { ReviewPage } from './ReviewPage'

const mockPermissions = vi.hoisted(() => ({
  canWriteAccounts: true,
  canWriteAssets: true,
  canWriteTransactions: true,
  canWriteWealth: true,
}))

vi.mock('../hooks/useEntityQueries', () => ({
  useConnections: () => ({
    items: [{ __typename: 'Connection', id: 'conn-1', isActive: true, provider: { __typename: 'PlaidItem', id: 'item-1', healthState: 'LINK_UPDATE_REQUIRED' } }],
  }),
}))

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    disableTransactionTracking: false,
    disableWealthTracking: false,
    hideOwners: false,
  }),
}))

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    canRead: () => true,
    canWrite: (resource: string) => {
      if (resource === 'accounts') return mockPermissions.canWriteAccounts
      if (resource === 'assets') return mockPermissions.canWriteAssets
      if (resource === 'transactions') return mockPermissions.canWriteTransactions
      if (resource === 'wealth') return mockPermissions.canWriteWealth
      return true
    },
    hasScope: () => true,
  }),
}))

vi.mock('urql', async () => (await import('../test/urql')).mockUrql({
    gql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => (
      strings.reduce((source, part, index) => `${source}${part}${values[index] ?? ''}`, '')
    )),
    useQuery: vi.fn(({ query }: { query?: string }) => {
      if (query?.includes('query Assets')) {
        return [{ data: { assets: { items: [{ id: 'asset-1', priceConnectivity: 'NOT_FOUND', investmentConnectivity: 'HEALTHY' }] } } }, vi.fn()]
      }
      if (query?.includes('query BalanceReviews')) {
        return [{ data: { balanceSnapshotReviews: { items: [{ id: 'review-1' }] } } }, vi.fn()]
      }
      if (query?.includes('query Transactions')) {
        return [{ data: { transactions: { edges: [], pageInfo: {}, totalCount: 1 } } }, vi.fn()]
      }
      return [{ data: { balanceSnapshotReviews: { items: [{ id: 'review-1' }] } } }, vi.fn()]
    }),
}))

vi.mock('../components/transactions/UncategorizedQueue', () => ({
  UncategorizedQueue: () => <div>Transactions queue</div>,
}))

vi.mock('../components/wealth/AssetReviewQueue', () => ({
  AssetReviewQueue: () => <div>Assets queue</div>,
}))

vi.mock('../components/wealth/BalanceReviewQueue', () => ({
  BalanceReviewQueue: () => <div>Balances queue</div>,
}))

vi.mock('../components/institutions/ConnectionReviewQueue', () => ({
  ConnectionReviewQueue: () => <div>Connections queue</div>,
}))

vi.mock('../components/institutions/connectionReview', () => ({
  needsConnectionReview: () => true,
}))

describe('ReviewPage', () => {
  afterEach(() => {
    mockPermissions.canWriteAccounts = true
    mockPermissions.canWriteAssets = true
    mockPermissions.canWriteTransactions = true
    mockPermissions.canWriteWealth = true
  })

  it('shows review counts and switches tabs', () => {
    renderReviewPage()

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Transactions!',
      'Accounts1',
      'Balances1',
      'Assets1',
    ])

    expect(screen.getByText('Transactions queue')).toBeTruthy()
    expect(screen.getAllByText('1')).toHaveLength(3)
    expect(screen.getByText('!')).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: /Accounts/i }))

    expect(screen.getByText('Connections queue')).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: /Balances/i }))

    expect(screen.getByText('Balances queue')).toBeTruthy()

    fireEvent.click(screen.getByRole('link', { name: /Assets/i }))

    expect(screen.getByText('Assets queue')).toBeTruthy()
  })

  it('hides transaction review without transaction write scope', () => {
    mockPermissions.canWriteTransactions = false

    renderReviewPage('/review/transactions')

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Accounts1',
      'Balances1',
      'Assets1',
    ])
    expect(screen.getByText('Connections queue')).toBeTruthy()
    expect(screen.queryByText('Transactions queue')).not.toBeInTheDocument()
  })

  it('hides account review tabs without account write scope', () => {
    mockPermissions.canWriteAccounts = false
    mockPermissions.canWriteAssets = false
    mockPermissions.canWriteWealth = false

    renderReviewPage()

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Transactions!'])
    expect(screen.getByText('Transactions queue')).toBeTruthy()
    expect(screen.queryByText('Connections queue')).not.toBeInTheDocument()
  })

  it('shows wealth review tabs without account write scope', () => {
    mockPermissions.canWriteAccounts = false

    renderReviewPage('/review/balances')

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Transactions!',
      'Balances1',
      'Assets1',
    ])
    expect(screen.getByText('Balances queue')).toBeTruthy()
    expect(screen.queryByText('Connections queue')).not.toBeInTheDocument()
  })

  it('shows only balance review with wealth write scope', () => {
    mockPermissions.canWriteAccounts = false
    mockPermissions.canWriteAssets = false
    mockPermissions.canWriteTransactions = false

    renderReviewPage('/review/assets')

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Balances1'])
    expect(screen.getByText('Balances queue')).toBeTruthy()
    expect(screen.queryByText('Assets queue')).not.toBeInTheDocument()
  })

  it('shows only asset review with assets write scope', () => {
    mockPermissions.canWriteAccounts = false
    mockPermissions.canWriteTransactions = false
    mockPermissions.canWriteWealth = false

    renderReviewPage('/review/balances')

    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Assets1'])
    expect(screen.getByText('Assets queue')).toBeTruthy()
    expect(screen.queryByText('Balances queue')).not.toBeInTheDocument()
  })

  it('renders the assets queue for an asset deep link', () => {
    renderReviewPage('/review/assets/asset-1')

    expect(screen.getByText('Assets queue')).toBeTruthy()
  })
})

function renderReviewPage(initialRoute = '/review/transactions') {
  renderWithProviders(
    <Routes>
      {REVIEW_PATHS.map((path) => <Route element={<ReviewPage />} key={path} path={absoluteRoutePath(path)} />)}
    </Routes>,
    { initialEntries: [initialRoute] },
  )
}
