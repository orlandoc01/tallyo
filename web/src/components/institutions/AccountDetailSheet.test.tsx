import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePermissions } from '../../hooks/usePermissions'
import { accounts } from '../../mocks/fixtures'
import { allowAllPermissionResult } from '../../test/permissions'
import { captureMutation, mockGraphqlError } from '../../test/msw'
import { TestProviders } from '../../test/renderWithProviders'
import { AccountDetailModal } from './AccountDetailModal'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))
vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

const mockNavigate = vi.hoisted(() => vi.fn())
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router')
  return { ...actual, useNavigate: () => mockNavigate }
})

afterEach(() => {
  mockNavigate.mockReset()
  vi.mocked(usePermissions).mockReturnValue(allowAllPermissionResult)
})

function Providers({ children }: { children: ReactNode }) {
  return <TestProviders initialEntries={['/accounts/acct-1/info']} withGraphql>{children}</TestProviders>
}

describe('AccountDetailSheet', () => {
  it('renders the hero, meta, sticky tabs and info rows on mobile', async () => {
    render(<AccountDetailModal account={{ ...accounts[0], notes: 'Household bills' }} onClose={vi.fn()} />, { wrapper: Providers })

    const sheet = screen.getByRole('dialog', { name: 'Account' })
    expect(sheet).toHaveClass('bg-overlay')
    expect(within(sheet).getByText('Checking (...9625)')).toBeInTheDocument()
    expect(within(sheet).getAllByText('American Express').length).toBeGreaterThan(0)
    expect(within(sheet).getByRole('navigation', { name: 'Account detail sections' })).toHaveClass('sticky')
    expect(within(sheet).getByRole('link', { name: 'Valuation' })).toHaveAttribute('href', '/accounts/acct-1/valuation')
    expect(within(sheet).getByRole('button', { name: /^name/i })).toHaveTextContent('Checking')
    expect(within(sheet).getByRole('button', { name: /^type/i })).toHaveTextContent('Depository')
    expect(within(sheet).getByRole('button', { name: /^notes/i })).toHaveTextContent('Household bills')
    expect(within(sheet).getByText('Mark this account as closed while keeping its history.')).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(within(sheet).queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
  })

  it('stages name and owner picks, saves them together and closes', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const onClose = vi.fn()
    const updateAccount = captureMutation<{ id: string; name?: string; ownerId?: string }>('UpdateAccount', {
      updateAccount: { __typename: 'UpdateAccountPayload', account: { ...accounts[0], name: 'My Checking' } },
    })
    render(<AccountDetailModal account={accounts[0]} onClose={onClose} onUpdate={onUpdate} />, { wrapper: Providers })

    await user.click(screen.getByRole('button', { name: /^name/i }))
    const nameInput = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(nameInput)
    await user.type(nameInput, 'My Checking')

    await user.click(screen.getByRole('button', { name: /^owner/i }))
    await user.click(await screen.findByRole('radio', { name: 'sam' }))
    expect(screen.getByRole('button', { name: /^owner/i })).toHaveTextContent('sam')
    expect(updateAccount.called).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateAccount.input).toEqual({ id: 'acct-1', name: 'My Checking', ownerId: 'owner-2' }))
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ name: 'My Checking' }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('stays open when the save fails', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    mockGraphqlError('UpdateAccount', 'Name taken', { kind: 'mutation' })
    render(<AccountDetailModal account={accounts[0]} onClose={onClose} />, { wrapper: Providers })

    await user.click(screen.getByRole('switch', { name: 'Closed' }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/Name taken/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('navigates to the account transactions from the footer', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<AccountDetailModal account={accounts[0]} onClose={onClose} />, { wrapper: Providers })

    await user.click(screen.getByRole('button', { name: 'View transactions' }))

    expect(onClose).toHaveBeenCalled()
    expect(mockNavigate).toHaveBeenCalledWith('/transactions?account_ids=acct-1')
  })

  it('removes a manual account through the two-step title action', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    const account = accounts.find((item) => item.id === 'manual-company-equity')!
    const removeAccount = captureMutation<{ id: string }>('RemoveManualAccount', { removeManualAccount: { __typename: 'RemoveManualAccountPayload', success: true } })
    render(<AccountDetailModal account={account} onClose={vi.fn()} onDelete={onDelete} />, { wrapper: Providers })

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await user.click(screen.getByRole('button', { name: 'Confirm remove' }))

    await waitFor(() => expect(removeAccount.input).toEqual({ id: account.id }))
    expect(onDelete).toHaveBeenCalledWith(account)
  })

  it('clears a subtype that no longer fits the picked type', async () => {
    const user = userEvent.setup()
    render(<AccountDetailModal account={accounts[0]} onClose={vi.fn()} />, { wrapper: Providers })

    expect(screen.getByRole('button', { name: /^subtype/i })).toHaveTextContent('Checking')
    await user.click(screen.getByRole('button', { name: /^type/i }))
    await user.click(screen.getByRole('radio', { name: 'Credit' }))

    expect(screen.getByRole('button', { name: /^type/i })).toHaveTextContent('Credit')
    expect(screen.getByRole('button', { name: /^subtype/i })).toHaveTextContent('None')
    await user.click(screen.getByRole('button', { name: /^subtype/i }))
    expect(screen.getByRole('radio', { name: 'Credit Card' })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: 'Checking' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('offers a mismatched saved subtype as unsupported and flags a type review', async () => {
    const user = userEvent.setup()
    render(<AccountDetailModal account={{ ...accounts[0], subtype: 'brokerage', needsReview: true }} onClose={vi.fn()} />, { wrapper: Providers })

    expect(screen.getByText('Verify this account type and save to clear it from review.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: /^subtype/i }))
    expect(screen.getByRole('radio', { name: 'Brokerage (unsupported)' })).toHaveAttribute('aria-checked', 'true')
  })

  it('edits a property address inside the Address accordion', async () => {
    const user = userEvent.setup()
    const account = accounts.find((item) => item.id === 'acct-real-estate')!
    render(<AccountDetailModal account={account} onClose={vi.fn()} />, { wrapper: Providers })

    const address = screen.getByRole('button', { name: /^address/i })
    expect(address).toHaveTextContent('673 Guerrero St, San Francisco, CA, 94110')
    expect(screen.queryByRole('button', { name: /^subtype/i })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Sold' })).toBeInTheDocument()
    await user.click(address)
    await user.clear(screen.getByLabelText('City'))
    await user.type(screen.getByLabelText('City'), 'Oakland')

    expect(address).toHaveTextContent('673 Guerrero St, Oakland, CA, 94110')
    expect(within(address).getByText(/Oakland/)).toHaveClass('text-accent')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'View transactions' })).not.toBeInTheDocument()
  })

  it('picks wallet chains and disables Save once none remain', async () => {
    const user = userEvent.setup()
    const account = accounts.find((item) => item.id === 'acct-evm')!
    render(<AccountDetailModal account={account} onClose={vi.fn()} />, { wrapper: Providers })

    const chains = screen.getByRole('button', { name: /^chains/i })
    await user.click(chains)
    expect(await screen.findByRole('checkbox', { name: 'Ethereum' })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('checkbox', { name: 'Avalanche' }))
    expect(chains).toHaveTextContent('Avalanche')
    expect(within(chains).getByText(/Avalanche/)).toHaveClass('text-accent')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()

    for (const name of ['Arbitrum', 'Base', 'Ethereum', 'Polygon', 'Monad', 'Optimism', 'Avalanche']) {
      await user.click(screen.getByRole('checkbox', { name }))
    }
    expect(chains).toHaveTextContent('Select at least one chain')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('renders static rows and a Done button without write access', async () => {
    vi.mocked(usePermissions).mockReturnValue({ canRead: () => true, canWrite: () => false, hasScope: () => true })
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<AccountDetailModal account={accounts[0]} onClose={onClose} />, { wrapper: Providers })

    expect(screen.queryByRole('button', { name: /^name/i })).not.toBeInTheDocument()
    expect(screen.getAllByText('Checking', { selector: 'span.text-text-2' })).toHaveLength(2)
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
