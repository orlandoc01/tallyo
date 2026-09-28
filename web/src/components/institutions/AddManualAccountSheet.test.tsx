import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePermissions } from '../../hooks/usePermissions'
import { allowAllPermissionResult } from '../../test/permissions'
import { accounts } from '../../mocks/fixtures'
import { captureMutation, mockQuery } from '../../test/msw'
import { TestProviders } from '../../test/renderWithProviders'
import { AddManualAccountModal } from './AddManualAccountModal'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))
vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

function Providers({ children }: { children: ReactNode }) {
  return <TestProviders withGraphql>{children}</TestProviders>
}

afterEach(() => {
  vi.mocked(usePermissions).mockReturnValue(allowAllPermissionResult)
})

describe('AddManualAccountSheet', () => {
  it('shows the no-owners banner when nobody can create owners', async () => {
    vi.mocked(usePermissions).mockReturnValue({ canRead: () => true, canWrite: (scope: string) => scope !== 'owners', hasScope: () => true })
    mockQuery('Owners', { owners: { __typename: 'OwnerList', items: [] } })
    render(<AddManualAccountModal connectionId="conn-1" institutionName="American Express" onClose={vi.fn()} onCreated={vi.fn()} />, { wrapper: Providers })

    expect(await screen.findByText(/No owners exist/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled()
  })

  it('renders the sheet rows with the first owner preselected', async () => {
    render(<AddManualAccountModal connectionId="conn-1" institutionName="American Express" onClose={vi.fn()} onCreated={vi.fn()} />, { wrapper: Providers })

    const sheet = screen.getByRole('dialog', { name: 'Add manual account' })
    expect(within(sheet).getByText('Under American Express')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^type/i })).toHaveTextContent('Depository')
    await waitFor(() => expect(within(sheet).getByRole('button', { name: /^owner/i })).toHaveTextContent('alex'))
    expect(within(sheet).getByRole('button', { name: 'Create account' })).toBeDisabled()
  })

  it('creates a new owner from the owner row and submits the account', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    const onClose = vi.fn()
    const createManualAccount = captureMutation<{ name: string; ownerId: string; type: string; closed: boolean; hidden: boolean }>('CreateManualAccount', {
      createManualAccount: { __typename: 'CreateManualAccountPayload', account: { ...accounts[0], id: 'manual-1', name: 'Old Amex Gold' } },
    })
    render(<AddManualAccountModal connectionId="conn-1" institutionName="American Express" onClose={onClose} onCreated={onCreated} />, { wrapper: Providers })

    await user.click(screen.getByRole('button', { name: /^account name/i }))
    await user.type(screen.getByRole('textbox', { name: 'Account name' }), 'Old Amex Gold')
    await user.click(screen.getByRole('button', { name: /^owner/i }))
    await user.click(await screen.findByRole('button', { name: '+ New owner' }))
    await user.type(screen.getByRole('textbox', { name: 'Owner name' }), 'jordan')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /^owner/i })).toHaveTextContent('jordan'))
    expect(screen.getByRole('button', { name: /^owner/i })).toHaveAttribute('aria-expanded', 'false')

    await user.click(screen.getByRole('button', { name: /^type/i }))
    await user.click(screen.getByRole('radio', { name: 'Credit' }))
    await user.click(screen.getByRole('switch', { name: 'Hidden' }))
    await user.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() => expect(createManualAccount.input).toEqual({ connectionId: 'conn-1', name: 'Old Amex Gold', ownerId: 'owner-new', type: 'CREDIT', closed: false, hidden: true }))
    expect(onCreated).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
