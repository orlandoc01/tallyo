import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { accountSnapshots, accounts } from '../../mocks/fixtures'
import { accountSnapshotsConnection } from '../../mocks/handlers'
import { server } from '../../mocks/server'
import { captureMutation, mockGraphqlError, mockQuery } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import type { AccountSnapshotsInput } from '../../types/graphql'
import { AccountValuationSheet } from './AccountValuationSheet'
import { groupSnapshotsByMonth, snapshotSource, sparklineLabels, trailingYearPoints } from './accountValuation'

vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

function trackHistoryRequests() {
  const inputs: AccountSnapshotsInput[] = []
  server.use(
    graphql.query<Record<string, unknown>, { input: AccountSnapshotsInput }>('AccountSnapshots', ({ variables }) => {
      inputs.push(variables.input)
      return HttpResponse.json({ data: { accountSnapshots: accountSnapshotsConnection({ ...variables.input, first: 3 }) } })
    }),
  )
  return inputs
}

describe('accountValuation helpers', () => {
  it('groups newest-first snapshots by month with the net change', () => {
    const groups = groupSnapshotsByMonth(accountSnapshots.filter((snapshot) => snapshot.accountId === 'acct-1'))
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('May 2026')
    expect(groups[0].snapshots).toHaveLength(7)
    expect(groups[0].changeUSD).toBe(750)
  })

  it('labels the snapshot source by provider and flags', () => {
    expect(snapshotSource(accounts[0], accountSnapshots[0])).toEqual({ label: 'Plaid sync', tone: 'sync' })
    expect(snapshotSource(accounts[0], accountSnapshots[1])).toEqual({ label: 'Flagged', tone: 'flagged' })
    expect(snapshotSource({ ...accounts[0], manual: true, connection: null }, accountSnapshots[0])).toEqual({ label: 'Manual', tone: 'manual' })
  })

  it('builds oldest-first sparkline points within the trailing year', () => {
    const points = trailingYearPoints(accountSnapshots.filter((snapshot) => snapshot.accountId === 'acct-1'), new Date(2026, 5, 1))
    expect(points[0].date).toBe('2026-05-14')
    expect(points[points.length - 1].value).toBe(1450)
    expect(sparklineLabels(points)).toHaveLength(5)
    expect(trailingYearPoints(accountSnapshots, new Date(2028, 0, 1))).toEqual([])
  })
})

describe('AccountValuationSheet', () => {
  it('loads a 31-day first page and lists snapshots grouped by month', async () => {
    const inputs = trackHistoryRequests()
    render(<AccountValuationSheet account={accounts[0]} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    await waitFor(() => expect(inputs).toEqual([{ accountId: 'acct-1', first: 31 }]))
    const may = await screen.findByRole('region', { name: 'May 2026' })
    expect(may).toHaveTextContent(/3 snapshots/)
    expect(screen.getByRole('heading', { name: /Snapshots · 7/ })).toBeInTheDocument()
    expect(within(may).getByRole('button', { name: /Thu, May 21/ })).toHaveTextContent('Plaid sync')
    expect(screen.getByRole('img', { name: 'Balance history' })).toBeInTheDocument()
  })

  it('expands a snapshot in place to show its holdings and loads older pages', async () => {
    const user = userEvent.setup()
    const inputs = trackHistoryRequests()
    render(<AccountValuationSheet account={accounts[0]} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    const row = await screen.findByRole('button', { name: /Thu, May 21/ })
    await user.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Holdings on Thu, May 21')).toBeInTheDocument()
    expect(screen.getByText('US Dollar')).toBeInTheDocument()
    expect(screen.getAllByText('VTI').length).toBeGreaterThan(0)
    expect(screen.getByText('69.0%')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Load 4 older snapshots' }))
    await waitFor(() => expect(inputs).toHaveLength(2))
    expect(inputs[1]).toEqual({ accountId: 'acct-1', first: 20, after: '2026-05-19' })
    expect(await screen.findByRole('button', { name: /Sun, May 17/ })).toBeInTheDocument()
  })

  it('edits a manual snapshot inside the expanded panel', async () => {
    const user = userEvent.setup()
    const account = accounts.find((item) => item.id === 'manual-company-equity')!
    const snapshot = accountSnapshots.find((item) => item.accountId === account.id)!
    const changeSnapshot = captureMutation<{ snapshotId: string; holdings: Array<{ assetId: string; valueUSD: number }> }>('ChangeAccountSnapshot', {
      changeAccountSnapshot: { __typename: 'ChangeAccountSnapshotPayload', snapshot: { ...snapshot, balanceUSD: 2000 }, account },
    })
    const onAccountUpdate = vi.fn()
    render(<AccountValuationSheet account={account} onAccountUpdate={onAccountUpdate} />, { wrapper: GraphqlTestProvider })

    await user.click(await screen.findByRole('button', { name: /Thu, May 21/ }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const valuation = screen.getByLabelText(/^Valuation for/)
    await user.clear(valuation)
    await user.type(valuation, '2000')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(changeSnapshot.input?.snapshotId).toBe(snapshot.id))
    expect(changeSnapshot.input?.holdings[0].valueUSD).toBe(2000)
    expect(onAccountUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: account.id }))
  })

  it('shows the history error line and an empty state', async () => {
    mockGraphqlError('AccountSnapshots', 'history offline')
    const { unmount } = render(<AccountValuationSheet account={{ ...accounts[0], latestSnapshot: null }} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    expect(await screen.findByText(/Could not load history: .*history offline/)).toBeInTheDocument()
    unmount()

    mockQuery('AccountSnapshots', { accountSnapshots: { __typename: 'AccountSnapshotConnection', edges: [], pageInfo: { __typename: 'PageInfo', hasNextPage: false, endCursor: null }, totalCount: 0 } })
    render(<AccountValuationSheet account={{ ...accounts[0], latestSnapshot: null }} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    expect(await screen.findByText('No snapshot history yet.')).toBeInTheDocument()
    expect(screen.getByText('Not enough history for a chart yet.')).toBeInTheDocument()
  })

  it('cancels an edit back to the saved lines and surfaces save errors', async () => {
    const user = userEvent.setup()
    const account = accounts.find((item) => item.id === 'manual-company-equity')!
    mockGraphqlError('ChangeAccountSnapshot', 'snapshot locked', { kind: 'mutation' })
    render(<AccountValuationSheet account={account} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    await user.click(await screen.findByRole('button', { name: /Thu, May 21/ }))
    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const valuation = screen.getByLabelText(/^Valuation for/)
    await user.clear(valuation)
    await user.type(valuation, '2000')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getAllByText('$1,500.00').length).toBeGreaterThan(1)
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await user.clear(screen.getByLabelText(/^Valuation for/))
    await user.type(screen.getByLabelText(/^Valuation for/), '2000')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/Could not save snapshot: .*snapshot locked/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('lists a single statement balance line for balance-only manual accounts', async () => {
    const user = userEvent.setup()
    const account = accounts.find((item) => item.id === 'manual-loan')!
    render(<AccountValuationSheet account={account} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    await user.click(await screen.findByRole('button', { name: /Thu, May 21/ }))

    expect(screen.getByText('Statement balance')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText('Manual')).toBeInTheDocument()
  })
})
