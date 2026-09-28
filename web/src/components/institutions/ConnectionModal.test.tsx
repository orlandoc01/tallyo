import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TestProviders } from '../../test/renderWithProviders'
import { ConnectionModal } from './ConnectionModal'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))
vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

function Providers({ children }: { children: ReactNode }) {
  return <TestProviders withGraphql>{children}</TestProviders>
}

describe('ConnectionModal on mobile', () => {
  it('switches between the Plaid and SimpleFIN forms with sheet tabs', async () => {
    const user = userEvent.setup()
    render(<ConnectionModal onClose={vi.fn()} onPlaidLinked={vi.fn()} onSimpleFinLinked={vi.fn()} />, { wrapper: Providers })

    const sheet = screen.getByRole('dialog', { name: 'Link connection' })
    expect(within(sheet).queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('tablist', { name: 'Bank data providers' })).toHaveClass('sticky')
    expect(within(sheet).getByText('Use Plaid Link for bank and brokerage accounts.')).toBeInTheDocument()
    expect(within(sheet).queryByLabelText('Setup Token')).not.toBeInTheDocument()

    await user.click(within(sheet).getByRole('tab', { name: 'SimpleFIN' }))
    expect(within(sheet).getByText('Claim a SimpleFIN Bridge setup token.')).toBeInTheDocument()
    expect(within(sheet).getByLabelText('Setup Token')).toBeInTheDocument()
  })

  it('ignores the scrim and Escape but closes from a form Cancel', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ConnectionModal initialTab="simplefin" onClose={onClose} onPlaidLinked={vi.fn()} onSimpleFinLinked={vi.fn()} />, { wrapper: Providers })

    await user.click(screen.getByRole('dialog'))
    await user.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Link connection' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
