import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BalanceReviewQueue } from './BalanceReviewQueue'
import type { BalanceSnapshotReview } from '../../types/graphql'

const mocks = vi.hoisted(() => ({
  reexecuteQuery: vi.fn(),
  resolveReview: vi.fn(),
  useQuery: vi.fn(),
}))

vi.mock('urql', async () => (await import('../../test/urql')).mockUrql({
  useMutation: vi.fn(() => [{ fetching: false, error: null }, mocks.resolveReview]),
  useQuery: mocks.useQuery,
}))

vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

const review: BalanceSnapshotReview = {
  __typename: 'BalanceSnapshotReview',
  id: 'review-1',
  account: {
    __typename: 'Account',
    id: 'acct-1',
    owner: { __typename: 'Owner', id: 'owner-1', name: 'Owner' },
    name: 'Brokerage',
    type: 'INVESTMENT',
    subtype: 'brokerage',
    mask: '4012',
    notes: null,
    closed: false,
    hidden: false,
    needsReview: false,
    manual: false,
    typeLocked: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  firstFlaggedDate: '2026-06-14',
  latestFlaggedDate: '2026-06-19',
  flaggedSnapshotCount: 6,
  providerBalanceUSD: 71_987_143.66,
  carryForwardBalanceUSD: 110_108.92,
  flagReason: 'balance exceeded threshold',
  createdAt: '2026-06-19T16:00:00Z',
  updatedAt: '2026-06-19T16:00:00Z',
}

describe('BalanceReviewQueue', () => {
  beforeEach(() => {
    mocks.reexecuteQuery.mockClear()
    mocks.resolveReview.mockReset().mockResolvedValue({ data: { resolveBalanceReview: { success: true } }, error: null })
    mocks.useQuery.mockReset()
  })

  it('renders an empty state', () => {
    mocks.useQuery.mockReturnValue([{ data: { balanceSnapshotReviews: { items: [] } }, fetching: false, error: null }, mocks.reexecuteQuery])

    render(<BalanceReviewQueue />)

    expect(screen.getByText('No flagged balance snapshots to review.')).toBeTruthy()
  })

  it('shows a retryable error state', () => {
    mocks.useQuery.mockReturnValue([{ data: undefined, fetching: false, error: { message: 'network down' } }, mocks.reexecuteQuery])

    render(<BalanceReviewQueue />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(screen.getByText(/network down/i)).toBeTruthy()
    expect(mocks.reexecuteQuery).toHaveBeenCalledWith({ requestPolicy: 'network-only' })
  })

  it('closes the details modal without resolving', () => {
    const singleDayReview = { ...review, latestFlaggedDate: review.firstFlaggedDate, flaggedSnapshotCount: 1 }
    mocks.useQuery.mockReturnValue([{ data: { balanceSnapshotReviews: { items: [singleDayReview] } }, fetching: false, error: null }, mocks.reexecuteQuery])

    render(<BalanceReviewQueue />)
    fireEvent.click(screen.getByRole('button', { name: /Brokerage/i }))
    expect(screen.getByText('1 snapshot')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Close/i }))

    expect(mocks.resolveReview).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Approve Changes' })).toBeNull()
  })

  it('approves a balance review', async () => {
    mocks.useQuery.mockReturnValue([{ data: { balanceSnapshotReviews: { items: [review] } }, fetching: false, error: null }, mocks.reexecuteQuery])

    render(<BalanceReviewQueue />)
    fireEvent.click(screen.getByRole('button', { name: /Brokerage/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve Changes' }))

    await waitFor(() => expect(mocks.resolveReview).toHaveBeenCalledWith({ input: { id: 'review-1', action: 'APPROVE_CHANGES' } }))
    expect(mocks.reexecuteQuery).toHaveBeenCalledWith({ requestPolicy: 'network-only' })
  })

  it('requires confirmation before using provider data', async () => {
    mocks.useQuery.mockReturnValue([{ data: { balanceSnapshotReviews: { items: [review] } }, fetching: false, error: null }, mocks.reexecuteQuery])

    render(<BalanceReviewQueue />)
    fireEvent.click(screen.getByRole('button', { name: /Brokerage/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Use Provider' }))

    expect(mocks.resolveReview).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Use Provider' }))

    await waitFor(() => expect(mocks.resolveReview).toHaveBeenCalledWith({ input: { id: 'review-1', action: 'USE_PROVIDER' } }))
  })

  it('shows mutation errors without refetching', async () => {
    mocks.resolveReview.mockResolvedValueOnce({ error: { message: 'resolve failed' } })
    mocks.useQuery.mockReturnValue([{ data: { balanceSnapshotReviews: { items: [review] } }, fetching: false, error: null }, mocks.reexecuteQuery])

    render(<BalanceReviewQueue />)
    fireEvent.click(screen.getByRole('button', { name: /Brokerage/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve Changes' }))

    expect(await screen.findByText('resolve failed')).toBeTruthy()
    expect(mocks.reexecuteQuery).not.toHaveBeenCalled()
  })
})
