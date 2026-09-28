import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { captureMutation } from '../../test/msw'
import { TestProviders } from '../../test/renderWithProviders'
import { LinkRealEstateModal } from './LinkRealEstateModal'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))
vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

function Providers({ children }: { children: ReactNode }) {
  return <TestProviders withGraphql>{children}</TestProviders>
}

describe('LinkRealEstateSheet', () => {
  it('validates the valuation before linking', async () => {
    const user = userEvent.setup()
    render(<LinkRealEstateModal onClose={vi.fn()} onLinked={vi.fn()} />, { wrapper: Providers })

    const sheet = screen.getByRole('dialog', { name: 'Link home' })
    expect(within(sheet).queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^address/i })).toHaveTextContent('Add address')
    await user.click(within(sheet).getByRole('button', { name: 'Link home' }))
    expect(await within(sheet).findByText('Enter a positive valuation.')).toBeInTheDocument()
  })

  it('links a home from the address accordion, valuation and owner rows', async () => {
    const user = userEvent.setup()
    const onLinked = vi.fn()
    const linkRealEstate = captureMutation<Record<string, unknown>>('LinkRealEstate', {
      linkRealEstate: { __typename: 'LinkRealEstatePayload', connection: { __typename: 'Connection', id: 'home-1', name: 'Primary home', isActive: true, provider: null }, valuationUSD: 850000 },
    })
    render(<LinkRealEstateModal onClose={vi.fn()} onLinked={onLinked} />, { wrapper: Providers })

    await user.click(screen.getByRole('button', { name: /^address/i }))
    await user.type(screen.getByLabelText(/street/i), '673 Guerrero St')
    await user.type(screen.getByLabelText(/city/i), 'San Francisco')
    await user.click(screen.getByRole('button', { name: /^address/i }))
    expect(screen.getByRole('button', { name: /^address/i })).toHaveTextContent('673 Guerrero St, San Francisco')
    await user.click(screen.getByRole('button', { name: /^manual valuation usd/i }))
    await user.type(screen.getByRole('spinbutton', { name: 'Manual valuation USD' }), '850000')
    await user.click(screen.getByRole('button', { name: /^owner/i }))
    await user.click(await screen.findByRole('radio', { name: 'alex' }))
    await user.click(screen.getByRole('button', { name: 'Link home' }))

    await waitFor(() => expect(linkRealEstate.input).toEqual({ street: '673 Guerrero St', city: 'San Francisco', state: null, zip: null, ownerId: 'owner-1', label: null, manualValuationUSD: 850000 }))
    await waitFor(() => expect(onLinked).toHaveBeenCalledWith(expect.objectContaining({ valuationUSD: 850000 })))
  })
})
