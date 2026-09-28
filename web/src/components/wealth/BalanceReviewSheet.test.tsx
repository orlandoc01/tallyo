import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePermissions } from '../../hooks/usePermissions'
import { balanceReviews } from '../../mocks/fixtures'
import { allowAllPermissionResult } from '../../test/permissions'
import { captureMutation } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { BalanceReviewModal } from './BalanceReviewModal'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))
vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

afterEach(() => {
  vi.mocked(usePermissions).mockReturnValue(allowAllPermissionResult)
})

const review = balanceReviews[0]

describe('BalanceReviewSheet', () => {
  it('renders the hero, static rows and approves from the footer', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    const resolve = captureMutation<{ id: string; action: string }>('ResolveBalanceReview', { resolveBalanceReview: { __typename: 'ResolveBalanceReviewPayload', success: true } })
    render(<BalanceReviewModal onClose={vi.fn()} onResolved={onResolved} review={review} />, { wrapper: GraphqlTestProvider })

    const sheet = screen.getByRole('dialog', { name: 'Balance review' })
    expect(within(sheet).queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
    expect(within(sheet).getByText('Provider detected')).toBeInTheDocument()
    expect(within(sheet).getByText('System carry-forward')).toBeInTheDocument()
    expect(within(sheet).getByText('Flag reason')).toBeInTheDocument()
    expect(within(sheet).getByText('6')).toBeInTheDocument()

    await user.click(within(sheet).getByRole('button', { name: 'Approve changes' }))
    await waitFor(() => expect(resolve.input).toEqual({ id: review.id, action: 'APPROVE_CHANGES' }))
    expect(onResolved).toHaveBeenCalledOnce()
  })

  it('restores provider balances after a second tap', async () => {
    const user = userEvent.setup()
    const onResolved = vi.fn()
    const resolve = captureMutation<{ id: string; action: string }>('ResolveBalanceReview', { resolveBalanceReview: { __typename: 'ResolveBalanceReviewPayload', success: true } })
    render(<BalanceReviewModal onClose={vi.fn()} onResolved={onResolved} review={review} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: 'Use provider' }))
    expect(resolve.called).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Tap again to confirm' }))
    await waitFor(() => expect(resolve.input).toEqual({ id: review.id, action: 'USE_PROVIDER' }))
    expect(onResolved).toHaveBeenCalledOnce()
  })

  it('disables resolution without wealth write access', () => {
    vi.mocked(usePermissions).mockReturnValue({ canRead: () => true, canWrite: () => false, hasScope: () => true })
    render(<BalanceReviewModal onClose={vi.fn()} onResolved={vi.fn()} review={review} />, { wrapper: GraphqlTestProvider })

    expect(screen.getByText('You need account write access to resolve balance reviews.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve changes' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Use provider' })).toBeDisabled()
  })
})
