import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { accountSnapshots, accounts, assets } from '../../mocks/fixtures'
import { accountSnapshotsConnection } from '../../mocks/handlers'
import { server } from '../../mocks/server'
import { captureMutation, mockQuery } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import type { Account, AccountSnapshotsInput } from '../../types/graphql'
import { USD_ASSET_ID } from './accountSnapshotLines'
import { AccountSnapshotEditor } from './AccountSnapshotEditor'

vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

function manualAccount() {
  const account = accounts.find((item) => item.id === 'manual-company-equity')
  if (!account) throw new Error('manual-company-equity fixture missing')
  return account
}

function manualLoanAccount() {
  const account = accounts.find((item) => item.id === 'manual-loan')
  if (!account) throw new Error('manual-loan fixture missing')
  return account
}

describe('AccountSnapshotEditor', () => {
  it('loads the latest snapshot in read-only mode and enables controls after Edit', async () => {
    const user = userEvent.setup()
    render(<AccountSnapshotEditor account={accounts[0]} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    const dateInput = await screen.findByLabelText('Snapshot date')
    expect(dateInput).toHaveValue('2026-05-21')
    expect(dateInput).toBeEnabled()
    expect(screen.getByRole('heading', { name: 'History' })).toBeInTheDocument()
    expect(screen.queryByText('Snapshot')).not.toBeInTheDocument()
    expect(screen.queryByText('Snapshot date')).not.toBeInTheDocument()
    expect(screen.queryByText('Snapshot total')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Balance' })).toBeInTheDocument()
    expect(screen.getByLabelText('Valuation for US Dollar')).toHaveTextContent('450')
    expect(screen.getByLabelText('Valuation for VTI')).toHaveTextContent('4')
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^edit$/i }))

    expect(screen.getByLabelText('Snapshot date')).toBeEnabled()
    expect(screen.getByLabelText('Cash balance for US Dollar')).toBeEnabled()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
  })

  it('shows and preserves provider-valued holdings without invented quantity or price', async () => {
    const user = userEvent.setup()
    const latestSnapshot = accountSnapshots[0]
    const [firstHolding, secondHolding] = latestSnapshot.holdings ?? []
    const projectName = 'Moo Aero msUSD-USDC'
    const account: Account = {
      ...accounts[0],
      latestSnapshot: {
        ...latestSnapshot,
        balanceUSD: 77_164.93,
        holdings: [
          {
            ...secondHolding,
            asset: { ...assets[2], name: projectName },
            quantity: null,
            valueUSD: 76_714.93,
          },
          firstHolding,
        ],
      },
    }
    const changeSnapshot = captureMutation<{ holdings: { assetId: string; quantity?: number | null; valueUSD: number }[] }>('ChangeAccountSnapshot', {
      changeAccountSnapshot: { __typename: 'ChangeAccountSnapshotPayload', snapshot: account.latestSnapshot, account },
    })

    render(<AccountSnapshotEditor account={account} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    await screen.findByDisplayValue('2026-05-21')
    expect(screen.getByText(projectName)).toBeInTheDocument()
    expect(screen.getByLabelText(`Valuation for ${projectName}`)).toHaveTextContent('$76,714.93')
    expect(screen.queryByLabelText(`Quantity for ${projectName}`)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Price /)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    const valuationInput = screen.getByLabelText(`Valuation for ${projectName}`)
    expect(valuationInput).toBeEnabled()
    expect(screen.queryByLabelText(`Quantity for ${projectName}`)).not.toBeInTheDocument()
    await user.clear(valuationInput)
    await user.type(valuationInput, '80000')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(changeSnapshot.input?.holdings).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: assets[2].id, quantity: null, valueUSD: 80_000 }),
    ])))
  })

  it('editing a holding valuation recomputes its quantity from the held price', async () => {
    const user = userEvent.setup()
    const account = accounts[0]
    const changeSnapshot = captureMutation<{ holdings: { assetId: string; quantity?: number | null; valueUSD: number }[] }>('ChangeAccountSnapshot', {
      changeAccountSnapshot: { __typename: 'ChangeAccountSnapshotPayload', snapshot: account.latestSnapshot, account },
    })

    render(<AccountSnapshotEditor account={account} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    await screen.findByDisplayValue('2026-05-21')
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    await user.clear(screen.getByLabelText('Valuation for VTI'))
    await user.type(screen.getByLabelText('Valuation for VTI'), '1250')

    expect(screen.getByLabelText('Quantity for VTI')).toHaveValue(5)

    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(changeSnapshot.input?.holdings).toEqual(expect.arrayContaining([
      { assetId: assets[1].id, quantity: 5, valueUSD: 1250 },
    ])))
  })

  it('editing a quantity and cash line updates the computed balance and enables Save', async () => {
    const user = userEvent.setup()
    render(<AccountSnapshotEditor account={accounts[0]} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    await screen.findByDisplayValue('2026-05-21')
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    await user.clear(screen.getByLabelText('Quantity for VTI'))
    await user.type(screen.getByLabelText('Quantity for VTI'), '5')
    await user.clear(screen.getByLabelText('Cash balance for US Dollar'))
    await user.type(screen.getByLabelText('Cash balance for US Dollar'), '500')

    expect(screen.getByLabelText('Valuation for VTI')).toHaveValue(1250)
    expect(screen.getByLabelText('Cash balance for US Dollar')).toHaveValue(500)
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled()
  })

  it('loads history with one paginated query and skips empty days', async () => {
    const requestedInputs: AccountSnapshotsInput[] = []
    server.use(
      graphql.query<Record<string, unknown>, { input: AccountSnapshotsInput }>('AccountSnapshots', ({ variables }) => {
        const input = variables.input
        requestedInputs.push(input)
        return HttpResponse.json({ data: { accountSnapshots: accountSnapshotsConnection(input) } })
      }),
    )

    render(<AccountSnapshotEditor account={accounts[0]} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    await waitFor(() => {
      expect(requestedInputs).toEqual([{ accountId: 'acct-1', first: 5 }])
    })
    expect(await screen.findByRole('checkbox', { name: 'Select 05/17/2026 snapshot' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Select 05/18/2026 snapshot' })).not.toBeInTheDocument()
  })

  it('selects loaded history and keeps the arbitrary date jump query', async () => {
    const user = userEvent.setup()
    const requestedDates: string[] = []
    server.use(
      graphql.query<Record<string, unknown>, { input: { accountId?: string | null; date?: string | null } }>('AccountSnapshot', ({ variables }) => {
        const input = variables.input
        requestedDates.push(input.date ?? '')
        const snapshot = accountSnapshots.find((item) => item.accountId === input.accountId && item.date === input.date) ?? null
        return HttpResponse.json({ data: { accountSnapshot: snapshot } })
      }),
    )

    render(<AccountSnapshotEditor account={accounts[0]} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    const may20 = await screen.findByRole('checkbox', { name: 'Select 05/20/2026 snapshot' })
    expect(may20.parentElement).toHaveTextContent('$1,200.00')
    await user.click(may20)

    expect(screen.getByLabelText('Snapshot date')).toHaveValue('2026-05-20')
    expect(screen.getByText('Flagged')).toBeInTheDocument()
    expect(screen.getByLabelText('Valuation for US Dollar')).toHaveTextContent('200')

    await user.clear(screen.getByLabelText('Snapshot date'))
    await user.type(screen.getByLabelText('Snapshot date'), '2026-05-18')

    expect(screen.getByLabelText('Snapshot date')).toHaveValue('2026-05-18')
    expect(await screen.findByText('No snapshot for this day.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeDisabled()
    expect(requestedDates).toContain('2026-05-18')
  })

  it('loads more snapshots and appends older history', async () => {
    const user = userEvent.setup()
    render(<AccountSnapshotEditor account={accounts[0]} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    expect(await screen.findByRole('checkbox', { name: 'Select 05/16/2026 snapshot' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Select 05/15/2026 snapshot' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /load more/i }))

    expect(await screen.findByRole('checkbox', { name: 'Select 05/15/2026 snapshot' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select 05/14/2026 snapshot' })).toBeInTheDocument()
  })

  it('titles investment snapshots as holdings', async () => {
    render(<AccountSnapshotEditor account={{ ...accounts[0], type: 'INVESTMENT' }} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    await screen.findByDisplayValue('2026-05-21')

    expect(screen.getByRole('heading', { name: 'Holdings' })).toBeInTheDocument()
  })

  it('shows snapshot balance for balance-only accounts without holdings', async () => {
    render(
      <AccountSnapshotEditor
        account={{
          ...accounts[0],
          type: 'CREDIT',
          latestSnapshot: {
            ...accountSnapshots[0],
            balanceUSD: 1234.56,
            holdings: [],
          },
        }}
        onAccountUpdate={vi.fn()}
      />,
      { wrapper: GraphqlTestProvider },
    )

    await screen.findByDisplayValue('2026-05-21')

    expect(screen.getByRole('heading', { name: 'Balance' })).toBeInTheDocument()
    expect(screen.getByLabelText('Snapshot balance')).toHaveTextContent('$1,234.56')
  })

  it('edits the balance directly on a manual loan account with an empty snapshot', async () => {
    const user = userEvent.setup()
    const account = manualLoanAccount()
    const changeSnapshot = captureMutation<{ snapshotId: string; holdings: { assetId: string; quantity?: number | null; valueUSD: number }[] }>('ChangeAccountSnapshot', {
      changeAccountSnapshot: { __typename: 'ChangeAccountSnapshotPayload', snapshot: account.latestSnapshot, account },
    })
    mockQuery('Assets', { assets: { __typename: 'AssetList', items: [{ ...assets[0], id: USD_ASSET_ID }] } })

    render(<AccountSnapshotEditor account={account} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    await screen.findByDisplayValue('2026-05-21')
    expect(screen.getByLabelText('Snapshot balance')).toHaveTextContent('$18,500.00')

    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    const balanceInput = screen.getByLabelText('Snapshot balance')
    await waitFor(() => expect(balanceInput).toBeEnabled())
    expect(screen.queryByRole('button', { name: 'Add holding' })).not.toBeInTheDocument()
    await user.clear(balanceInput)
    await user.type(balanceInput, '18000')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(changeSnapshot.input?.holdings).toEqual([{ assetId: USD_ASSET_ID, quantity: 18000, valueUSD: 18000 }])
    })
  })

  it('edits the existing cash line on a manual credit account without holdings UI', async () => {
    const user = userEvent.setup()
    const cashHolding = { ...accountSnapshots[0].holdings![0], quantity: -450, valueUSD: -450 }
    const snapshot = {
      ...accountSnapshots[0],
      id: 'snapshot-manual-credit',
      accountId: 'manual-credit',
      balanceUSD: 450,
      netContributionUSD: -450,
      holdings: [cashHolding],
    }
    const account: Account = { ...manualAccount(), id: 'manual-credit', type: 'CREDIT', latestSnapshot: snapshot }
    const changeSnapshot = captureMutation<{ snapshotId: string; holdings: { assetId: string; quantity?: number | null; valueUSD: number }[] }>('ChangeAccountSnapshot', {
      changeAccountSnapshot: { __typename: 'ChangeAccountSnapshotPayload', snapshot, account },
    })

    render(<AccountSnapshotEditor account={account} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    await screen.findByDisplayValue('2026-05-21')
    expect(screen.queryByLabelText('Cash balance for US Dollar')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Snapshot balance')).toHaveTextContent('$450.00')

    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    expect(screen.getByLabelText('Snapshot balance')).toHaveValue(450)
    await user.clear(screen.getByLabelText('Snapshot balance'))
    await user.type(screen.getByLabelText('Snapshot balance'), '1200')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(changeSnapshot.input?.holdings).toEqual([{ assetId: 'asset-usd', quantity: 1200, valueUSD: 1200 }])
    })
  })

  it('saves with the cached snapshot id and bubbles the refreshed account', async () => {
    const user = userEvent.setup()
    const onAccountUpdate = vi.fn()
    let submitted: { snapshotId: string; holdings: { valueUSD: number }[] } | null = null
    server.use(
      graphql.mutation<Record<string, unknown>, { input: { snapshotId: string; holdings: { valueUSD: number }[] } }>('ChangeAccountSnapshot', ({ variables }) => {
        submitted = variables.input
        const balanceUSD = submitted.holdings.reduce((sum, holding) => sum + holding.valueUSD, 0)
        return HttpResponse.json({
          data: {
            changeAccountSnapshot: {
              __typename: 'ChangeAccountSnapshotPayload',
              snapshot: { ...accountSnapshots[0], balanceUSD, flagged: false },
              account: { ...accounts[0], latestSnapshot: { ...accountSnapshots[0], balanceUSD, netContributionUSD: balanceUSD } },
            },
          },
        })
      }),
    )

    render(<AccountSnapshotEditor account={accounts[0]} onAccountUpdate={onAccountUpdate} />, { wrapper: GraphqlTestProvider })

    await screen.findByDisplayValue('2026-05-21')
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    await user.clear(screen.getByLabelText('Cash balance for US Dollar'))
    await user.type(screen.getByLabelText('Cash balance for US Dollar'), '550')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(submitted).toEqual(expect.objectContaining({ snapshotId: 'snapshot-1' }))
      expect(submitted?.holdings.reduce((sum, holding) => sum + holding.valueUSD, 0)).toBe(1550)
      expect(onAccountUpdate).toHaveBeenCalled()
    })
  })

  it('shows manual badges for manual snapshot holdings', async () => {
    render(<AccountSnapshotEditor account={manualAccount()} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    await screen.findByDisplayValue('2026-05-21')

    expect(screen.getByLabelText('Manual holding')).toBeInTheDocument()
  })

  it('adds an existing asset holding on manual accounts', async () => {
    const user = userEvent.setup()
    const account = manualAccount()
    const changeSnapshot = captureMutation<{ holdings: { assetId: string; quantity?: number | null; valueUSD: number }[] }>('ChangeAccountSnapshot', {
      changeAccountSnapshot: { __typename: 'ChangeAccountSnapshotPayload', snapshot: account.latestSnapshot, account },
    })

    render(<AccountSnapshotEditor account={account} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    await screen.findByDisplayValue('2026-05-21')
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    await user.click(screen.getByRole('button', { name: 'Add holding' }))
    expect(screen.queryByText('Add Holding')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Quantity for new holding')).toHaveValue(0)
    await user.click(await screen.findByRole('checkbox', { name: 'Add BND' }))
    expect(screen.getByLabelText('Quantity for BND')).toHaveValue(0)
    await user.clear(screen.getByLabelText('Quantity for BND'))
    await user.type(screen.getByLabelText('Quantity for BND'), '2')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(changeSnapshot.input?.holdings).toEqual(expect.arrayContaining([
        expect.objectContaining({ assetId: 'asset-bnd', quantity: 2, valueUSD: 144.36 }),
      ]))
    })
  })

  it('allows removing all holdings from a holding-backed manual snapshot', async () => {
    const user = userEvent.setup()
    const account = manualAccount()
    const snapshot = account.latestSnapshot
    if (!snapshot) throw new Error('manual account snapshot fixture missing')
    const changeSnapshot = captureMutation<{ holdings: { assetId: string }[] }>('ChangeAccountSnapshot', {
      changeAccountSnapshot: { __typename: 'ChangeAccountSnapshotPayload', snapshot: { ...snapshot, holdings: [] }, account: { ...account, latestSnapshot: { ...snapshot, holdings: [] } } },
    })

    render(<AccountSnapshotEditor account={account} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    await screen.findByDisplayValue('2026-05-21')
    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    await user.click(screen.getByRole('button', { name: 'Remove ACME' }))
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(changeSnapshot.input?.holdings).toEqual([]))
  })

  it('date changes refetch the selected day and disable Save when no snapshot exists', async () => {
    const user = userEvent.setup()
    render(<AccountSnapshotEditor account={accounts[0]} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    await screen.findByDisplayValue('2026-05-21')
    await user.clear(screen.getByLabelText('Snapshot date'))

    expect(screen.getByText('No snapshot for this day.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Cash balance for US Dollar')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Snapshot date'), '2026-05-18')

    expect(await screen.findByText('No snapshot for this day.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()
  })

  it('shows historical snapshots read-only until Edit is clicked', async () => {
    const user = userEvent.setup()
    render(<AccountSnapshotEditor account={accounts[0]} onAccountUpdate={vi.fn()} />, { wrapper: GraphqlTestProvider })

    await screen.findByDisplayValue('2026-05-21')
    await user.clear(screen.getByLabelText('Snapshot date'))
    await user.type(screen.getByLabelText('Snapshot date'), '2026-05-20')

    expect(await screen.findByText('Flagged')).toBeInTheDocument()
    expect(screen.getByLabelText('Valuation for US Dollar')).toHaveTextContent('200')
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^edit$/i }))

    expect(screen.getByLabelText('Cash balance for US Dollar')).toBeEnabled()
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled()
  })
})
