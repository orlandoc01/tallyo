import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { accounts } from '../../mocks/fixtures'
import { graphql, HttpResponse } from 'msw'
import { server } from '../../mocks/server'
import { captureMutation, deferred } from '../../test/msw'
import { TestProviders } from '../../test/renderWithProviders'
import { LinkEVMWalletModal } from './LinkEVMWalletModal'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))
vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

function Providers({ children }: { children: ReactNode }) {
  return <TestProviders withGraphql>{children}</TestProviders>
}

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678'

describe('LinkEVMWalletSheet', () => {
  it('renders the rows and keeps the footer disabled until the form is valid', async () => {
    render(<LinkEVMWalletModal onClose={vi.fn()} onLinked={vi.fn()} />, { wrapper: Providers })

    const sheet = screen.getByRole('dialog', { name: 'Link crypto wallet' })
    expect(within(sheet).queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^wallet address/i })).toBeInTheDocument()
    expect(await within(sheet).findByRole('button', { name: /^chains/i })).toHaveTextContent('Ethereum')
    expect(within(sheet).getByRole('button', { name: 'Link wallet' })).toBeDisabled()
  })

  it('links a wallet with a picked owner and chains', async () => {
    const user = userEvent.setup()
    const onLinked = vi.fn()
    const connection = { __typename: 'Connection', id: 'evm-1', isActive: true, provider: { __typename: 'EVMWallet', address: ADDRESS, chainIds: ['eth', 'base'] } }
    const linkWallet = captureMutation<{ address: string; ownerId: string; label: string | null; chainIds: string[] }>('LinkEVMWallet', {
      linkEVMWallet: { __typename: 'LinkEVMWalletPayload', connection, account: { ...accounts[0], id: 'evm-account', connection } },
    })
    render(<LinkEVMWalletModal onClose={vi.fn()} onLinked={onLinked} />, { wrapper: Providers })

    await user.click(screen.getByRole('button', { name: /^wallet address/i }))
    const address = screen.getByRole('textbox', { name: 'Wallet address' })
    expect(address).toHaveClass('font-mono')
    await user.type(address, ADDRESS)
    await user.click(screen.getByRole('button', { name: /^label/i }))
    await user.type(screen.getByRole('textbox', { name: 'Label' }), 'Main wallet')
    await user.click(screen.getByRole('button', { name: /^owner/i }))
    await user.click(await screen.findByRole('radio', { name: 'sam' }))
    await user.click(screen.getByRole('button', { name: /^chains/i }))
    await user.click(await screen.findByRole('checkbox', { name: 'Base' }))
    await user.click(screen.getByRole('button', { name: 'Link wallet' }))

    await waitFor(() => expect(linkWallet.input).toEqual({ address: ADDRESS, ownerId: 'owner-2', label: 'Main wallet', chainIds: ['eth', 'base'] }))
    await waitFor(() => expect(onLinked).toHaveBeenCalledWith(expect.objectContaining({ account: expect.objectContaining({ id: 'evm-account' }) })))
  })

  it('keeps the footer disabled for an invalid address and enables it once the form is complete', async () => {
    const user = userEvent.setup()
    render(<LinkEVMWalletModal onClose={vi.fn()} onLinked={vi.fn()} />, { wrapper: Providers })

    await user.click(screen.getByRole('button', { name: /^owner/i }))
    await user.click(await screen.findByRole('radio', { name: 'sam' }))
    await user.click(screen.getByRole('button', { name: /^wallet address/i }))
    const address = screen.getByRole('textbox', { name: 'Wallet address' })
    await user.type(address, '0xnope')
    expect(screen.getByRole('button', { name: 'Link wallet' })).toBeDisabled()

    await user.clear(address)
    await user.type(address, ADDRESS)
    expect(screen.getByRole('button', { name: 'Link wallet' })).toBeEnabled()
  })

  it('cannot be dismissed while the link is in flight', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const linkWallet = deferred()
    server.use(graphql.link('/query').mutation('LinkEVMWallet', async () => {
      await linkWallet.wait()
      return HttpResponse.json({ data: { linkEVMWallet: { __typename: 'LinkEVMWalletPayload', connection: null, account: { ...accounts[0], id: 'evm-account' } } } })
    }))
    render(<LinkEVMWalletModal onClose={onClose} onLinked={vi.fn()} />, { wrapper: Providers })

    await user.click(screen.getByRole('button', { name: /^wallet address/i }))
    await user.type(screen.getByRole('textbox', { name: 'Wallet address' }), ADDRESS)
    await user.click(screen.getByRole('button', { name: /^owner/i }))
    await user.click(await screen.findByRole('radio', { name: 'sam' }))
    await user.click(screen.getByRole('button', { name: 'Link wallet' }))

    expect(screen.getByRole('button', { name: 'Linking…' })).toBeDisabled()
    await user.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Link crypto wallet' })).toBeInTheDocument()
    linkWallet.resolve()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Link wallet' })).toBeInTheDocument())
  })
})
