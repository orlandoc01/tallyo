import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createProvidersWrapper } from '../../test/renderWithProviders'
import { ConnectionReviewQueue } from './ConnectionReviewQueue'

const mocks = vi.hoisted(() => ({
  reexecuteQuery: vi.fn(),
  updateConnection: vi.fn(),
  deleteConnection: vi.fn(),
  startUpdateLink: vi.fn(),
  useConnections: vi.fn(),
  useMutation: vi.fn(),
  usePlaidLink: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router')
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  }
})

vi.mock('../../hooks/useEntityQueries', () => ({
  useConnections: mocks.useConnections,
}))

vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

vi.mock('../../hooks/usePlaidLink', () => ({
  usePlaidLink: mocks.usePlaidLink,
}))

vi.mock('urql', async () => (await import('../../test/urql')).mockUrql({
  useMutation: mocks.useMutation,
}))

const RouterWrapper = createProvidersWrapper()

describe('ConnectionReviewQueue', () => {
  beforeEach(() => {
    mocks.reexecuteQuery.mockReset()
    mocks.updateConnection.mockReset().mockResolvedValue({
      data: { updateConnection: { connection: reviewConnection() } },
      error: null,
    })
    mocks.deleteConnection.mockReset().mockResolvedValue({
      data: { deleteConnection: { success: true } },
      error: null,
    })
    mocks.startUpdateLink.mockReset()
    mocks.useConnections.mockReset()
    mocks.useMutation.mockReset()
    let mutationCall = 0
    mocks.useMutation.mockImplementation(() => {
      mutationCall += 1
      return mutationCall % 2 === 1 ? [{}, mocks.updateConnection] : [{}, mocks.deleteConnection]
    })
    mocks.usePlaidLink.mockReset().mockReturnValue({
      error: null,
      isLoading: false,
      startUpdateLink: mocks.startUpdateLink,
    })
  })

  it('renders an empty state when no connections need review', () => {
    mocks.useConnections.mockReturnValue({
      items: [{ __typename: 'Connection', id: 'conn-1', name: 'Chase', owner: { id: 'owner-1', name: 'Casey' }, isActive: true, provider: { __typename: 'PlaidItem', id: 'item-1', healthState: 'HEALTHY', credential: { label: 'Primary', clientId: 'client-1' }, accounts: [], createdAt: '2026-05-01T00:00:00Z' } }],
      fetching: false,
      error: null,
      refetch: mocks.reexecuteQuery,
    })

    render(<ConnectionReviewQueue />, { wrapper: RouterWrapper })

    expect(screen.getByText(/No connections need review/i)).toBeInTheDocument()
    expect(screen.getByText(/accounts needing a type review/i)).toBeInTheDocument()
  })

  it('shows only unhealthy plaid connections', () => {
    mocks.useConnections.mockReturnValue({
      items: [
        { __typename: 'Connection', id: 'conn-1', name: 'Chase', owner: { id: 'owner-1', name: 'Casey' }, isActive: true, provider: { __typename: 'PlaidItem', id: 'item-1', healthState: 'LINK_UPDATE_REQUIRED', credential: { label: 'Primary', clientId: 'client-1' }, accounts: [], createdAt: '2026-05-01T00:00:00Z' } },
        { __typename: 'Connection', id: 'conn-2', name: 'Fidelity', owner: { id: 'owner-1', name: 'Casey' }, isActive: true, provider: { __typename: 'PlaidItem', id: 'item-2', healthState: 'HEALTHY', credential: { label: 'Primary', clientId: 'client-1' }, accounts: [], createdAt: '2026-05-01T00:00:00Z' } },
        { __typename: 'Connection', id: 'conn-3', name: 'Morgan Stanley', owner: { id: 'owner-1', name: 'Casey' }, isActive: true, provider: { __typename: 'PlaidItem', id: 'item-3', healthState: 'SYNC_ERROR', credential: { label: 'Primary', clientId: 'client-1' }, accounts: [], createdAt: '2026-05-01T00:00:00Z' } },
      ],
      fetching: false,
      error: null,
      refetch: mocks.reexecuteQuery,
    })

    render(<ConnectionReviewQueue />, { wrapper: RouterWrapper })

    expect(screen.getByText('Chase')).toBeInTheDocument()
    expect(screen.getByText('Morgan Stanley')).toBeInTheDocument()
    expect(screen.queryByText('Fidelity')).not.toBeInTheDocument()
  })

  it('shows SimpleFIN connections with accounts needing type review', () => {
    mocks.useConnections.mockReturnValue({
      items: [simpleFinReviewConnection()],
      fetching: false,
      error: null,
      refetch: mocks.reexecuteQuery,
    })

    render(<ConnectionReviewQueue />, { wrapper: RouterWrapper })

    expect(screen.getByText('Chase Bank')).toBeInTheDocument()
    expect(screen.getByText('Mystery Account')).toBeInTheDocument()
    expect(screen.getByText('verify type')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Mystery Account/i }))
    expect(mocks.navigate).toHaveBeenCalledWith('/accounts/sfin-acct-1/info')
  })

  it('starts plaid update flow from the reused tile actions', () => {
    mocks.useConnections.mockReturnValue({
      items: [{ __typename: 'Connection', id: 'conn-1', name: 'Chase', owner: { id: 'owner-1', name: 'Casey' }, isActive: true, provider: { __typename: 'PlaidItem', id: 'item-1', healthState: 'LINK_UPDATE_REQUIRED', credential: { label: 'Primary', clientId: 'client-1' }, accounts: [], createdAt: '2026-05-01T00:00:00Z' } }],
      fetching: false,
      error: null,
      refetch: mocks.reexecuteQuery,
    })

    render(<ConnectionReviewQueue />, { wrapper: RouterWrapper })

    fireEvent.click(screen.getByRole('button', { name: /Open actions for Chase/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Update login' }))

    expect(mocks.startUpdateLink).toHaveBeenCalledWith('item-1')
  })

  it('disconnects review connections from the reused tile actions', async () => {
    mocks.updateConnection.mockResolvedValueOnce({
      data: { updateConnection: { connection: reviewConnection({ isActive: false }) } },
      error: null,
    })
    mocks.useConnections.mockReturnValue({
      items: [reviewConnection()],
      fetching: false,
      error: null,
      refetch: mocks.reexecuteQuery,
    })

    render(<ConnectionReviewQueue />, { wrapper: RouterWrapper })

    fireEvent.click(screen.getByRole('button', { name: /Open actions for Chase/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }))

    await waitFor(() => expect(mocks.updateConnection).toHaveBeenCalledWith({ input: { connectionId: 'conn-1', isActive: false } }))
    expect(await screen.findByText(/Chase disconnected/i)).toBeInTheDocument()
    expect(mocks.reexecuteQuery).not.toHaveBeenCalled()
  })

  it('deletes review connections after confirmation', async () => {
    mocks.useConnections.mockReturnValue({
      items: [reviewConnection()],
      fetching: false,
      error: null,
      refetch: mocks.reexecuteQuery,
    })

    render(<ConnectionReviewQueue />, { wrapper: RouterWrapper })

    fireEvent.click(screen.getByRole('button', { name: /Open actions for Chase/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))

    await waitFor(() => expect(mocks.deleteConnection).toHaveBeenCalledWith({ input: { connectionId: 'conn-1' } }))
    expect(await screen.findByText(/Connection deleted/i)).toBeInTheDocument()
    expect(mocks.reexecuteQuery).not.toHaveBeenCalled()
  })
})

function reviewConnection(overrides: { isActive?: boolean } = {}) {
  return {
    __typename: 'Connection' as const,
    id: 'conn-1',
    name: 'Chase',
    owner: { id: 'owner-1', name: 'Casey' },
    isActive: overrides.isActive ?? true,
    provider: {
      __typename: 'PlaidItem' as const,
      id: 'item-1',
      healthState: 'LINK_UPDATE_REQUIRED',
      credential: { label: 'Primary', clientId: 'client-1' },
      accounts: [],
      createdAt: '2026-05-01T00:00:00Z',
    },
  }
}

function simpleFinReviewConnection() {
  return {
    __typename: 'Connection' as const,
    id: 'sfin-conn-row',
    name: 'Chase Bank',
    owner: { id: 'owner-1', name: 'Casey' },
    isActive: true,
    provider: {
      __typename: 'SimpleFinConnection' as const,
      id: 'sfin-conn-1',
      accessToken: {
        id: 'token-1',
        label: 'Bridge',
        owner: { id: 'owner-1', name: 'Casey' },
        connections: [],
        syncCron: '0 6,18 * * *',
        createdAt: '2026-05-01T00:00:00Z',
      },
      orgDomain: 'chase.com',
      orgUrl: 'https://www.chase.com',
      accounts: [{
        __typename: 'Account' as const,
        id: 'sfin-acct-1',
        owner: { id: 'owner-1', name: 'Casey' },
        name: 'Mystery Account',
        type: 'CREDIT' as const,
        subtype: null,
        mask: '1111',
        notes: null,
        closed: false,
        hidden: false,
        needsReview: true,
        manual: false,
        typeLocked: false,
        createdAt: '2026-05-01T00:00:00Z',
        updatedAt: '2026-05-01T00:00:00Z',
      }],
      lastSyncedAt: '2026-05-21T11:00:00Z',
      createdAt: '2026-05-02T00:00:00Z',
      updatedAt: '2026-05-21T11:00:00Z',
    },
  }
}
