import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { accounts, owners } from '../../mocks/fixtures'
import { server } from '../../mocks/server'
import { captureMutation, mockGraphqlError } from '../../test/msw'
import { TestProviders } from '../../test/renderWithProviders'
import { AccountDetailModal } from './AccountDetailModal'

const permissionMocks = vi.hoisted(() => ({
  canRead: vi.fn<(resource: string) => boolean>(() => true),
  canWrite: vi.fn<(resource: string) => boolean>(() => true),
  hasScope: vi.fn<(scope: string) => boolean>(() => true),
}))

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => permissionMocks,
}))

const mockNavigate = vi.hoisted(() => vi.fn())
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router')
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  }
})

describe('AccountDetailModal', () => {
  beforeEach(() => {
    permissionMocks.canRead.mockReturnValue(true)
    permissionMocks.canWrite.mockReturnValue(true)
    permissionMocks.hasScope.mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockNavigate.mockReset()
  })

  it('renders account details and pre-fills form fields', async () => {
    const onClose = vi.fn()
    render(
      <AccountDetailModal account={{ ...accounts[0], notes: 'Used for household bills' }} onClose={onClose} />,
      { wrapper: InstitutionProvider },
    )

    expect(screen.getByRole('dialog', { name: /details for checking/i })).toBeInTheDocument()
    expect(screen.getByText('Checking (...9625)')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Checking')
    expect(await screen.findByDisplayValue('alex')).toBeInTheDocument()
    expect(screen.getByLabelText('Type')).toHaveValue('DEPOSITORY')
    expect(screen.getByLabelText('Closed')).not.toBeChecked()
    expect(screen.getByLabelText('Hidden')).not.toBeChecked()
    expect(screen.getByLabelText('Notes')).toHaveValue('Used for household bills')
    expect(screen.getByText('American Express')).toBeInTheDocument()
  })

  it('falls back to info-only without holding valuation scope', async () => {
    permissionMocks.canRead.mockImplementation((resource) => resource !== 'holdings')

    render(<AccountDetailModal account={accounts[0]} activeTab="valuation" onClose={vi.fn()} />, { wrapper: InstitutionProvider })

    expect(screen.getByRole('link', { name: 'Info' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Valuation' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Checking')
    expect(screen.queryByRole('heading', { name: 'Balance' })).not.toBeInTheDocument()
  })

  it('pre-fills closed and hidden for a closed account', () => {
    render(
      <AccountDetailModal account={accounts[1]} onClose={vi.fn()} />,
      { wrapper: InstitutionProvider },
    )

    expect(screen.getByLabelText('Closed')).toBeChecked()
    expect(screen.getByLabelText('Hidden')).not.toBeChecked()
  })

  it('pre-fills hidden for a hidden account', () => {
    render(
      <AccountDetailModal account={accounts[2]} onClose={vi.fn()} />,
      { wrapper: InstitutionProvider },
    )

    expect(screen.getByLabelText('Closed')).not.toBeChecked()
    expect(screen.getByLabelText('Hidden')).toBeChecked()
  })

  it('save button is disabled when no changes have been made', () => {
    render(
      <AccountDetailModal account={accounts[0]} onClose={vi.fn()} />,
      { wrapper: InstitutionProvider },
    )

    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
  })

  it('confirms an unchanged reviewed type and clears the review flag', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const account = { ...accounts[0], type: 'CREDIT' as const, subtype: 'credit card', needsReview: true }
    const updateAccount = captureMutation<{ id: string; type?: string }>('UpdateAccount', { updateAccount: { __typename: 'UpdateAccountPayload', account: { ...account, needsReview: false } } })

    render(<AccountDetailModal account={account} onClose={vi.fn()} onUpdate={onUpdate} />, { wrapper: InstitutionProvider })

    expect(screen.getByText(/Verify this account type/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save/i })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(updateAccount.input).toEqual({ id: account.id, type: 'CREDIT' }))
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ needsReview: false }))
  })

  it('saves name, owner, type changes and calls onUpdate', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    server.use(
      graphql.link('/query').mutation<Record<string, unknown>, { input: { id: string; name?: string; ownerId?: string; type?: string } }>('UpdateAccount', ({ variables }) => {
        const input = variables.input
        const owner = input.ownerId ? (owners.find((o) => o.id === input.ownerId) ?? accounts[0].owner) : accounts[0].owner
        return HttpResponse.json({
          data: { updateAccount: { __typename: 'UpdateAccountPayload', account: { ...accounts[0], name: input.name ?? accounts[0].name, owner, type: input.type ?? accounts[0].type } } },
        })
      }),
    )

    render(
      <AccountDetailModal account={accounts[0]} onClose={vi.fn()} onUpdate={onUpdate} />,
      { wrapper: InstitutionProvider },
    )

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'My Checking')
    await screen.findByRole('option', { name: 'sam' })
    await user.selectOptions(screen.getByLabelText('Owner'), 'sam')
    await user.selectOptions(screen.getByLabelText('Type'), 'CREDIT')

    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Checking', owner: expect.objectContaining({ id: 'owner-2', name: 'sam' }), type: 'CREDIT' }))
    })
  })

  it('saves closed and hidden changes', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    render(
      <AccountDetailModal account={accounts[0]} onClose={vi.fn()} onUpdate={onUpdate} />,
      { wrapper: InstitutionProvider },
    )

    await user.click(screen.getByLabelText('Closed'))
    await user.click(screen.getByLabelText('Hidden'))
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ closed: true, hidden: true }))
    })
  })

  it('saves notes changes', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    render(
      <AccountDetailModal account={{ ...accounts[0], notes: null }} onClose={vi.fn()} onUpdate={onUpdate} />,
      { wrapper: InstitutionProvider },
    )

    await user.type(screen.getByLabelText('Notes'), 'Documentation note')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ notes: 'Documentation note' }))
    })
  })

  it('shows error and does not call onUpdate when mutation fails', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    mockGraphqlError('UpdateAccount', 'Something went wrong', { kind: 'mutation', status: 500 })

    render(
      <AccountDetailModal account={accounts[0]} onClose={vi.fn()} onUpdate={onUpdate} />,
      { wrapper: InstitutionProvider },
    )

    await user.click(screen.getByLabelText('Closed'))
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument()
    })
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('updates account details and EVM chains together', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const account = accounts.find((item) => item.id === 'acct-evm')!
    let connectionInput: { connectionId: string; chainIds: string[] } | undefined

    server.use(
      graphql.link('/query').mutation<Record<string, unknown>, { input: { connectionId: string; chainIds: string[] } }>('UpdateConnection', ({ variables }) => {
        connectionInput = variables.input
        return HttpResponse.json({
          data: {
            updateConnection: {
              __typename: 'UpdateConnectionPayload',
              connection: {
                ...account.connection,
                provider: { ...account.connection?.provider, chainIds: connectionInput.chainIds },
              },
            },
          },
        })
      }),
    )

    render(<AccountDetailModal account={account} onClose={vi.fn()} onUpdate={onUpdate} />, { wrapper: InstitutionProvider })

    expect(await screen.findByRole('button', { name: 'Remove Ethereum' })).toBeInTheDocument()
    expect(screen.getByText('Chains').compareDocumentPosition(screen.getByLabelText('Notes'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    expect(screen.queryByRole('searchbox', { name: /search chains/i })).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Treasury Wallet')
    await user.click(screen.getByRole('button', { name: /\+ chain/i }))
    await user.click(await screen.findByRole('button', { name: /^Avalanche/i }))
    expect(screen.queryByRole('searchbox', { name: /search chains/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(connectionInput).toEqual({
      connectionId: 'conn-evm',
      chainIds: ['arb', 'base', 'eth', 'matic', 'monad', 'op', 'avax'],
    }))
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Treasury Wallet',
      connection: expect.objectContaining({ provider: expect.objectContaining({ chainIds: connectionInput?.chainIds }) }),
    }))
  })

  it('surfaces an EVM chain update error', async () => {
    const user = userEvent.setup()
    const account = accounts.find((item) => item.id === 'acct-evm')!
    mockGraphqlError('UpdateConnection', 'Could not update wallet chains', { kind: 'mutation', status: 500 })

    render(<AccountDetailModal account={account} onClose={vi.fn()} />, { wrapper: InstitutionProvider })

    await screen.findByRole('button', { name: 'Remove Ethereum' })
    await user.click(screen.getByRole('button', { name: /\+ chain/i }))
    await user.click(await screen.findByRole('button', { name: /^Avalanche/i }))
    await user.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText(/Could not update wallet chains/)).toBeInTheDocument()
  })

  it('navigates to transactions page when view transactions button is clicked', async () => {
    const { onClose, user } = renderAccountDetails()

    await user.click(screen.getByRole('button', { name: /view transactions/i }))

    expect(onClose).toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalledWith('/transactions?account_ids=acct-1')
  })

  it('closes when the X button is clicked', async () => {
    const { onClose, user } = renderAccountDetails()

    await user.click(screen.getByRole('button', { name: /close details for checking/i }))

    expect(onClose).toHaveBeenCalled()
  })

  it('closes when backdrop is clicked', async () => {
    const { onClose, user } = renderAccountDetails()

    await user.click(screen.getByRole('presentation'))

    expect(onClose).toHaveBeenCalled()
  })
})

function InstitutionProvider({ children }: { children: ReactNode }) {
  return <TestProviders initialEntries={['/accounts/acct-1/info']} withGraphql>{children}</TestProviders>
}

function renderAccountDetails() {
  const user = userEvent.setup()
  const onClose = vi.fn()
  render(<AccountDetailModal account={accounts[0]} onClose={onClose} />, { wrapper: InstitutionProvider })
  return { onClose, user }
}
