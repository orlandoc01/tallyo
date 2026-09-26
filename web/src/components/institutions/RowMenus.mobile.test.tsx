import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { accounts, plaidItems } from '../../mocks/fixtures'
import { captureMutation } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import type { EVMWallet } from '../../types/graphql'
import { EVMWalletRow } from './EVMWalletRow'
import { InstitutionRow } from './InstitutionRow'
import { RealEstateRow } from './RealEstateRow'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))

const connection = { id: 'conn-1', name: 'American Express', owner: { __typename: 'Owner' as const, id: 'owner-1', name: 'alex' }, isActive: true, provider: plaidItems[0] }

describe('row action menus on mobile', () => {
  it('keeps the institution sheet open through the two-step delete', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(<InstitutionRow accounts={[]} connection={connection} plaidItem={plaidItems[0]} onAccountClick={vi.fn()} onDelete={onDelete} onUpdateLogin={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: /open actions for american express/i }))
    const sheet = screen.getByRole('dialog', { name: 'Connection' })
    expect(within(sheet).getByText(/accounts · /)).toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: 'Delete' }))

    expect(screen.getByRole('dialog', { name: 'Connection' })).toBeInTheDocument()
    expect(onDelete).not.toHaveBeenCalled()
    await user.click(within(sheet).getByRole('button', { name: 'Confirm delete' }))

    expect(onDelete).toHaveBeenCalledWith(connection)
    expect(screen.queryByRole('dialog', { name: 'Connection' })).not.toBeInTheDocument()
  })

  it('runs a plain item and closes the wallet sheet, confirming delete in two taps', async () => {
    const user = userEvent.setup()
    const onDisconnect = vi.fn()
    const onDelete = vi.fn()
    const wallet = accounts.find((item) => item.id === 'acct-evm')!.connection!.provider as EVMWallet
    render(<EVMWalletRow isActive wallet={wallet} onDelete={onDelete} onDisconnect={onDisconnect} />)

    await user.click(screen.getByRole('button', { name: 'Open wallet actions' }))
    let sheet = screen.getByRole('dialog', { name: 'Wallet' })
    await user.click(within(sheet).getByRole('button', { name: 'Disconnect' }))
    expect(onDisconnect).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: 'Wallet' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open wallet actions' }))
    sheet = screen.getByRole('dialog', { name: 'Wallet' })
    await user.click(within(sheet).getByRole('button', { name: 'Delete' }))
    expect(onDelete).not.toHaveBeenCalled()
    await user.click(within(sheet).getByRole('button', { name: 'Confirm delete' }))
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('removes a home only after confirming in the property sheet', async () => {
    const user = userEvent.setup()
    const onUnlink = vi.fn()
    const unlink = captureMutation('UnlinkRealEstate', { unlinkRealEstate: true })
    const account = accounts.find((item) => item.id === 'acct-real-estate')!
    render(<RealEstateRow account={account} accountWealthProperty={account.accountWealthProperty} connectionId="conn-home" onUnlink={onUnlink} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: 'Open home actions' }))
    const sheet = screen.getByRole('dialog', { name: 'Property' })
    await user.click(within(sheet).getByRole('button', { name: 'Remove' }))
    expect(unlink.called).toBe(false)
    await user.click(within(sheet).getByRole('button', { name: 'Confirm remove' }))

    await waitFor(() => expect(unlink.called).toBe(true))
    expect(onUnlink).toHaveBeenCalledWith('conn-home')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Property' })).not.toBeInTheDocument())
  })
})
