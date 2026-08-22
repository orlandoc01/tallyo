import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_QUERY } from '../../graphql/queries'
import { AccountsPage } from '../../pages/AccountsPage'
import { usePermissions } from '../../hooks/usePermissions'
import { accounts, plaidItems, simpleFinConnections } from '../../mocks/fixtures'
import { server } from '../../mocks/server'
import { ACCOUNTS_PATHS, absoluteRoutePath } from '../../routes'
import { captureMutation, mockMutation, mockQuery } from '../../test/msw'
import { allowAllPermissionResult } from '../../test/permissions'
import { MobileHeaderActionsHost, TestProviders } from '../../test/renderWithProviders'
import { AccountDetailModal } from './AccountDetailModal'
import { AddManualAccountModal } from './AddManualAccountModal'
import { EVMWalletRow } from './EVMWalletRow'
import { InstitutionRow } from './InstitutionRow'
import { LinkEVMWalletModal } from './LinkEVMWalletModal'
import { LinkRealEstateModal } from './LinkRealEstateModal'
import { RealEstateRow } from './RealEstateRow'
import type { Account, EVMWallet, PlaidItem } from '../../types/graphql'

vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

vi.mock('react-plaid-link', () => ({
  usePlaidLink: ({ onSuccess, token }: { onSuccess: (publicToken: string, metadata: { institution: { institution_id: string; name: string } }) => void; token: string | null }) => ({
    open: () => onSuccess('public-token', { institution: { institution_id: 'ins_10', name: 'American Express' } }),
    ready: Boolean(token),
  }),
}))

function renderAccountsPage() {
  return render(<AccountsPage />, { wrapper: InstitutionProviderWithRouter })
}

describe('AccountsPage', () => {
  afterEach(() => {
    vi.mocked(usePermissions).mockReturnValue(allowAllPermissionResult)
    vi.restoreAllMocks()
  })

  it('requests EVM wallet provider fields for account detail editing', () => {
    const query = ACCOUNT_QUERY.loc?.source.body ?? ''

    expect(query).toContain('provider')
    expect(query).toContain('... on EVMWallet')
    expect(query).toContain('chainIds')
  })

  it('renders connections with separate primary actions', async () => {
    renderAccountsPage()

    expect(await screen.findByRole('button', { name: /link connection/i })).toBeInTheDocument()
    expect(await screen.findByText('American Express')).toBeInTheDocument()
    expect(await screen.findAllByText('5 accounts')).toHaveLength(4)
    expect(screen.getByRole('button', { name: /link connection/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^add$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /refresh all/i })).not.toBeInTheDocument()
  })

  it('opens account modals from compact mobile header actions', async () => {
    const user = userEvent.setup()
    render(
      <>
        <MobileHeaderActionsHost />
        <AccountsPage />
      </>,
      { wrapper: InstitutionProviderWithRouter },
    )

    await screen.findByText('American Express')
    const mobileActions = within(screen.getByTestId('mobile-header-actions'))
    await user.click(mobileActions.getByRole('button', { name: 'Link account' }))
    expect(screen.getByRole('heading', { name: 'Link Connection' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Close' }))

    await user.click(mobileActions.getByRole('button', { name: /add account/i }))
    expect(screen.getByRole('heading', { name: 'Add account' })).toBeInTheDocument()
  })

  it('requests and renders inactive connections', async () => {
    let includeInactive: boolean | undefined
    const inactivePlaid: PlaidItem = {
      ...plaidItems[0],
      accounts: [],
      isActive: false,
    }
    server.use(
      graphql.link('/query').query<Record<string, unknown>, { input?: { includeInactive?: boolean } }>('Connections', ({ variables }) => {
        const input = variables.input
        includeInactive = input?.includeInactive
        return HttpResponse.json({
          data: {
            connections: {
              __typename: 'ConnectionList',
              items: [{ __typename: 'Connection', id: 'conn-inactive', name: 'Old Bank', owner: { __typename: 'Owner', id: 'owner-1', name: 'alex' }, isActive: false, provider: inactivePlaid }],
            },
          },
        })
      }),
    )

    renderAccountsPage()

    expect(await screen.findByText('Old Bank')).toBeInTheDocument()
    expect(screen.getByText('Disconnected')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Old Bank' })).toBeInTheDocument()
    await waitFor(() => expect(includeInactive).toBe(true))
  })

  it('keeps update login in the actions menu for healthy items', async () => {
    const user = userEvent.setup()

    renderAccountsPage()

    const institutionName = await screen.findByText('American Express')
    const section = institutionName.closest('section')
    expect(section).toHaveClass('overflow-visible')
    await user.click(screen.getByRole('button', { name: /open actions for american express/i }))
    expect(screen.getByRole('button', { name: /update login/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reset sync/i })).not.toBeInTheDocument()
    expect(section ? within(section).queryByRole('button', { name: /remove/i }) : null).not.toBeInTheDocument()
  })

  it('updates Plaid sync settings', async () => {
    const user = userEvent.setup()
    let input: { connectionId: string; syncCron: string; recurringSyncCron: string } | undefined
    server.use(
      graphql.link('/query').mutation<Record<string, unknown>, { input: { connectionId: string; syncCron: string; recurringSyncCron: string } }>('UpdateConnection', ({ variables }) => {
        input = variables.input
        return HttpResponse.json({
          data: {
            updateConnection: {
              __typename: 'UpdateConnectionPayload',
              connection: {
                __typename: 'Connection',
                id: 'conn-1',
                name: 'American Express',
                owner: { __typename: 'Owner', id: 'owner-1', name: 'alex' },
                isActive: true,
                provider: {
                ...plaidItems[0],
                syncCron: input.syncCron,
                recurringSyncCron: input.recurringSyncCron,
                nextSyncAt: '2026-05-21T20:00:00Z',
                nextRecurringSyncAt: '2026-05-25T12:00:00Z',
                },
              },
            },
          },
        })
      }),
    )

    renderAccountsPage()

    await screen.findByText('American Express')
    await user.click(screen.getByRole('button', { name: /open actions for american express/i }))
    await user.click(screen.getByRole('button', { name: /sync settings/i }))

    const transactionSyncInput = screen.getByLabelText(/transaction sync cron/i)
    await user.clear(transactionSyncInput)
    await user.type(transactionSyncInput, '0 */2 * * *')
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    expect(await screen.findByText(/Updated sync settings for American Express/i)).toBeInTheDocument()
    expect(input).toEqual({ connectionId: 'conn-1', syncCron: '0 */2 * * *', recurringSyncCron: '0 12 * * 0' })
  })

  it('disconnects and reconnects Plaid connections through updateConnection', async () => {
    const user = userEvent.setup()
    const inputs: Array<{ connectionId: string; isActive?: boolean }> = []
    server.use(
      graphql.link('/query').mutation<Record<string, unknown>, { input: { connectionId: string; isActive?: boolean } }>('UpdateConnection', ({ variables }) => {
        const input = variables.input
        inputs.push(input)
        return HttpResponse.json({ data: { updateConnection: { __typename: 'UpdateConnectionPayload', connection: { __typename: 'Connection', id: input.connectionId, name: 'American Express', owner: { __typename: 'Owner', id: 'owner-1', name: 'alex' }, isActive: input.isActive ?? true, provider: { ...plaidItems[0], isActive: input.isActive ?? true } } } } })
      }),
    )

    renderAccountsPage()

    await screen.findByText('American Express')
    await user.click(screen.getByRole('button', { name: /open actions for american express/i }))
    await user.click(screen.getByRole('button', { name: /disconnect/i }))
    expect(await screen.findByText(/American Express disconnected/i)).toBeInTheDocument()

    const inactiveConn = { __typename: 'Connection' as const, id: 'conn-1', name: 'American Express', owner: { __typename: 'Owner' as const, id: 'owner-1', name: 'alex' }, isActive: false }
    mockQuery('Connections', { connections: { __typename: 'ConnectionList', items: [{ ...inactiveConn, provider: { ...plaidItems[0], isActive: false } }] } })
    mockQuery('Accounts', { accounts: { __typename: 'AccountList', items: accounts.map(a => ({ ...a, connection: inactiveConn })) } })
    renderAccountsPage()
    await screen.findByText('Disconnected')
    await user.click(screen.getAllByRole('button', { name: /open actions for american express/i }).at(-1)!)
    await user.click(screen.getByRole('button', { name: /reconnect/i }))
    expect(inputs).toEqual(expect.arrayContaining([{ connectionId: 'conn-1', isActive: false }, { connectionId: 'conn-1', isActive: true }]))
  })

  it('deletes Plaid connections after confirmation', async () => {
    const user = userEvent.setup()
    const deleteConnection = captureMutation<{ connectionId: string }>('DeleteConnection', { deleteConnection: { __typename: 'DeleteConnectionPayload', success: true } })

    renderAccountsPage()

    await screen.findByText('American Express')
    await user.click(screen.getByRole('button', { name: /open actions for american express/i }))
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    await user.click(screen.getByRole('button', { name: /confirm delete/i }))

    expect(await screen.findByText(/Connection deleted/i)).toBeInTheDocument()
    expect(deleteConnection.input).toEqual({ connectionId: 'conn-1' })
  })

  it('hides Plaid update login for inactive items', async () => {
    const user = userEvent.setup()
    const inactivePlaid: PlaidItem = {
      ...plaidItems[0],
      isActive: false,
    }
    const inactiveConn = { id: 'conn-inactive', name: 'Old Bank', owner: { __typename: 'Owner' as const, id: 'owner-1', name: 'alex' }, isActive: false, provider: inactivePlaid }

    render(
      <InstitutionRow
        connection={inactiveConn}
        plaidItem={inactivePlaid}
        onAccountClick={vi.fn()}
        onUpdateLogin={vi.fn()}
        onAddManualAccount={vi.fn()}
        onReconnect={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: /open actions for old bank/i }))
    expect(screen.queryByRole('button', { name: /update login/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add manual account/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reconnect/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
  })

  it('adds an account through credential and owner selection', async () => {
    const user = userEvent.setup()
    const createLinkToken = deferred()
    server.use(
      graphql.link('/query').mutation('CreateLinkToken', async () => {
        await createLinkToken.wait()
        return HttpResponse.json({ data: { createLinkToken: { __typename: 'CreateLinkTokenPayload', linkToken: 'link-sandbox-token', expiration: '2026-05-21T12:00:00Z' } } })
      }),
    )

    renderAccountsPage()

    await user.click(await screen.findByRole('button', { name: /link connection/i }))
    await user.click(await screen.findByRole('button', { name: /bank \/ brokerage/i }))
    await user.click(await screen.findByRole('button', { name: /overflow/i }))
    await screen.findByRole('option', { name: 'sam' })
    await user.selectOptions(screen.getByLabelText(/owner/i), 'sam')
    await user.click(screen.getByRole('button', { name: /continue to plaid/i }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Linking connection…')
    expect(screen.queryByRole('button', { name: /overflow/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/owner/i)).not.toBeInTheDocument()

    createLinkToken.resolve()

    expect(await screen.findByText(/Connected American Express with 5 accounts/i)).toBeInTheDocument()
  })

  it('links to settings when Plaid has no credentials', async () => {
    const user = userEvent.setup()
    mockQuery('PlaidCredentials', { plaidCredentials: { __typename: 'PlaidCredentialList', items: [] } })

    renderAccountsPage()

    await user.click(await screen.findByRole('button', { name: /link connection/i }))
    await user.click(await screen.findByRole('button', { name: /bank \/ brokerage/i }))

    expect(await screen.findByText(/please configure a plaid credential in/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute('href', '/settings/connections?provider=plaid')
    expect(screen.queryByRole('button', { name: /continue to plaid/i })).not.toBeInTheDocument()
  })

  it('renders SimpleFIN connections in the account list', async () => {
    mockQuery('Connections', { connections: { __typename: 'ConnectionList', items: [{ __typename: 'Connection', id: 'sfin-conn-row', name: 'Chase Bank', owner: { __typename: 'Owner', id: 'owner-1', name: 'alex' }, isActive: true, provider: simpleFinConnections[0] }] } })

    renderAccountsPage()

    expect(await screen.findByText('Chase Bank')).toBeInTheDocument()
    expect(screen.getByText('SimpleFIN')).toBeInTheDocument()
    expect(screen.getByText('https://www.chase.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /mystery account/i })).toBeInTheDocument()
  })

  it('links SimpleFIN from the provider chooser', async () => {
    const user = userEvent.setup()
    let input: { setupToken: string; ownerId: string; label?: string | null } | undefined
    const createAccessToken = deferred()
    server.use(
      graphql.link('/query').mutation<Record<string, unknown>, { input: { setupToken: string; ownerId: string; label?: string | null } }>('CreateSimpleFinAccessToken', async ({ variables }) => {
        input = variables.input
        await createAccessToken.wait()
        return HttpResponse.json({ data: { createSimpleFinAccessToken: { __typename: 'CreateSimpleFinAccessTokenPayload', accessToken: { __typename: 'SimpleFinAccessToken', id: '2', label: input.label, owner: { __typename: 'Owner', id: input.ownerId, name: 'sam' }, syncCron: '0 6,18 * * *', lastSyncedAt: null, nextSyncAt: null, createdAt: '2026-05-22T00:00:00Z' }, connections: simpleFinConnections, accounts: simpleFinConnections.flatMap((connection) => connection.accounts) } } })
      }),
    )

    renderAccountsPage()

    await user.click(await screen.findByRole('button', { name: /link connection/i }))
    await user.click(await screen.findByRole('button', { name: /bank \/ brokerage/i }))
    await user.click(screen.getByRole('tab', { name: /simplefin/i }))
    await user.type(screen.getByLabelText(/setup token/i), 'c2V0dXAtdG9rZW4=')
    await user.type(screen.getByLabelText(/label/i), 'Bridge token')
    await screen.findByRole('option', { name: 'sam' })
    await user.selectOptions(screen.getByLabelText(/owner/i), 'owner-2')
    await user.click(screen.getByRole('button', { name: /^link$/i }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Linking connection…')
    expect(screen.queryByLabelText(/setup token/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/label/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/owner/i)).not.toBeInTheDocument()

    createAccessToken.resolve()

    expect(await screen.findByText(/Connected SimpleFIN with 1 connection and 1 account/i)).toBeInTheDocument()
    expect(input).toEqual({ setupToken: 'c2V0dXAtdG9rZW4=', ownerId: 'owner-2', label: 'Bridge token' })
  })

  it('links a home from the provider chooser', async () => {
    const user = userEvent.setup()
    mockMutation('LinkRealEstate', { linkRealEstate: { __typename: 'LinkRealEstatePayload', connection: { __typename: 'Connection', id: 'real-estate-1', name: 'Primary home', owner: { __typename: 'Owner', id: 'owner-2', name: 'sam' }, isActive: true, provider: null }, account: { ...accounts[0], id: 'home-account', name: 'Primary home' }, valuationUSD: 1450000 } })

    renderAccountsPage()

    await user.click(await screen.findByRole('button', { name: /^add$/i }))
    await user.click(screen.getByRole('button', { name: /add home/i }))
    await user.type(screen.getByLabelText(/street/i), '673 Guerrero St')
    await user.type(screen.getByLabelText(/city/i), 'San Francisco')
    await user.type(screen.getByLabelText(/state/i), 'CA')
    await user.type(screen.getByLabelText(/zip/i), '94110')
    await user.type(screen.getByLabelText(/manual valuation/i), '1450000')
    await screen.findByRole('option', { name: 'sam' })
    await user.selectOptions(screen.getByLabelText(/owner/i), 'sam')
    await user.click(screen.getByRole('button', { name: /link home/i }))

    expect(await screen.findByText(/Home linked and valuation saved/i)).toBeInTheDocument()
  })

  it('opens add manual account from the add account chooser', async () => {
    const user = userEvent.setup()

    renderAccountsPage()

    await user.click(await screen.findByRole('button', { name: /^add$/i }))
    await user.click(screen.getByRole('button', { name: /add manual account/i }))

    expect(await screen.findByRole('dialog', { name: /add manual account/i })).toBeInTheDocument()
    expect(screen.getByText(/under manual/i)).toBeInTheDocument()
  })

  it('updates and removes real estate from the connections page', async () => {
    const user = userEvent.setup()
    const homeAccount: Account = {
      ...accounts[0],
      id: 'home-account',
      connection: { __typename: 'Connection', id: 'real-estate-1', name: 'Primary home', owner: { __typename: 'Owner', id: 'owner-1', name: 'alex' }, isActive: true, provider: { __typename: 'EVMWallet', address: '0x0', chainIds: ['eth'] } },
      name: 'Primary home',
      type: 'PROPERTY',
      accountWealthProperty: { __typename: 'RealEstateAssetDetails', address: { __typename: 'Address', street: '673 Guerrero St', city: 'San Francisco', state: 'CA', zip: '94110', homeType: null } },
      latestSnapshot: { __typename: 'AccountSnapshot', id: 'snapshot-home', accountId: 'home-account', date: '2026-06-01', balanceUSD: 1450000, netContributionUSD: 1450000, holdings: [], flagged: false },
    }
    mockQuery('Connections', { connections: { __typename: 'ConnectionList', items: [] } })
    mockQuery('Accounts', { accounts: { __typename: 'AccountList', items: [homeAccount] } })
    mockMutation('UpdateRealEstate', { updateRealEstate: { __typename: 'UpdateRealEstatePayload', account: { ...homeAccount, latestSnapshot: { __typename: 'AccountSnapshot', id: 'snapshot-home-updated', accountId: homeAccount.id, date: '2026-06-01', balanceUSD: 1500000, netContributionUSD: 1500000, holdings: [], flagged: false } } } })
    mockMutation('UnlinkRealEstate', { unlinkRealEstate: true })

    renderAccountsPage()

    expect(await screen.findByText('Primary home')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /open home actions/i }))
    await user.click(screen.getByRole('button', { name: /update value/i }))
    await user.type(screen.getByLabelText(/manual valuation/i), '1500000')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    expect(await screen.findByText(/Home valuation updated/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /open home actions/i }))
    await user.click(screen.getByRole('button', { name: /remove/i }))
    await user.click(screen.getByRole('button', { name: /confirm remove/i }))
    expect(await screen.findByText(/Home removed/i)).toBeInTheDocument()
  })

  it('updates an existing item login and syncs immediately', async () => {
    const user = userEvent.setup()
    const unhealthyPlaid: PlaidItem = {
      ...plaidItems[0],
      healthState: 'LINK_UPDATE_REQUIRED' as const,
      healthErrorCode: 'ITEM_LOGIN_REQUIRED',
      healthErrorMessage: 'Login required',
    }
    mockQuery('Connections', { connections: { __typename: 'ConnectionList', items: [{ __typename: 'Connection', id: 'conn-1', name: 'American Express', owner: { __typename: 'Owner', id: 'owner-1', name: 'alex' }, isActive: true, provider: unhealthyPlaid }] } })

    renderAccountsPage()

    expect(await screen.findByText('Update required')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /open actions for american express/i }))
    await user.click(screen.getByRole('button', { name: /update login/i }))

    expect(await screen.findByText(/American Express was reconnected and synced/i)).toBeInTheDocument()
  })

  it('shows sync errors and keeps update login available', async () => {
    const onUpdateLogin = vi.fn()
    const onAccountClick = vi.fn()
    const plaidItem: PlaidItem = {
      ...plaidItems[0],
      healthState: 'SYNC_ERROR',
      healthErrorCode: 'PRODUCT_NOT_READY',
      healthErrorMessage: null,
    }
    const conn = { id: 'conn-1', name: 'American Express', owner: { __typename: 'Owner' as const, id: 'owner-1', name: 'alex' }, isActive: true, provider: plaidItem }

    render(
      <InstitutionRow
        connection={conn}
        plaidItem={plaidItem}
        onAccountClick={onAccountClick}
        onUpdateLogin={onUpdateLogin}
        onAddManualAccount={vi.fn()}
      />,
    )

    expect(screen.getByText('Sync error')).toBeInTheDocument()
    expect(screen.getByText('PRODUCT_NOT_READY')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /open actions for american express/i }))
    await userEvent.click(screen.getByRole('button', { name: /update login/i }))
    expect(onUpdateLogin).toHaveBeenCalledWith(expect.objectContaining({ id: plaidItems[0].id }))
  })

  it('shows (CLOSED) and (HIDDEN) labels on accounts and makes them clickable', async () => {
    const onAccountClick = vi.fn()
    const plaidItem: PlaidItem = {
      ...plaidItems[0],
      accounts: [
        { ...plaidItems[0].accounts[0], type: 'CREDIT', subtype: 'credit card', closed: true, hidden: false, latestSnapshot: { __typename: 'AccountSnapshot', id: 'snapshot-credit', accountId: plaidItems[0].accounts[0].id, date: '2026-06-01', balanceUSD: 1234.56, netContributionUSD: -1234.56, holdings: [], flagged: false } } as Account,
      ],
    }
    const conn = { id: 'conn-1', name: 'American Express', owner: { __typename: 'Owner' as const, id: 'owner-1', name: 'alex' }, isActive: true, provider: plaidItem }

    render(
      <InstitutionRow
        connection={conn}
        plaidItem={plaidItem}
        onAccountClick={onAccountClick}
        onUpdateLogin={vi.fn()}
        onAddManualAccount={vi.fn()}
      />,
    )

    expect(screen.getByText('(CLOSED)')).toBeInTheDocument()
    expect(screen.queryByText('-$1,234.56')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /checking/i }))
    expect(onAccountClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'acct-1', closed: true }))
  })

  it('orders accounts by active, hidden, then closed within an institution', () => {
    const plaidItem = plaidItems[0]
    const conn = { id: 'conn-1', name: 'American Express', owner: { __typename: 'Owner' as const, id: 'owner-1', name: 'alex' }, isActive: true, provider: plaidItem }

    render(
      <InstitutionRow
        connection={conn}
        plaidItem={plaidItem}
        onAccountClick={vi.fn()}
        onUpdateLogin={vi.fn()}
        onAddManualAccount={vi.fn()}
      />,
    )

    const accountLabels = screen
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((text) => text?.includes('••••'))

    expect(accountLabels).toEqual([
      expect.stringContaining('Checking'),
      expect.stringContaining('Blue Cash Preferred'),
      expect.stringContaining('Gold Card'),
      expect.stringContaining('Secret Fund'),
      expect.stringContaining('Savings'),
    ])
  })

  it('opens add manual account modal from actions menu and creates an account', async () => {
    const user = userEvent.setup()

    renderAccountsPage()

    await screen.findByText('American Express')
    await user.click(screen.getByRole('button', { name: /open actions for american express/i }))
    await user.click(screen.getByRole('button', { name: /add manual account/i }))

    const dialog = await screen.findByRole('dialog', { name: /add manual account/i })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText(/under american express/i)).toBeInTheDocument()

    await user.type(screen.getByLabelText(/account name/i), 'Old Amex Gold')
    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(screen.queryByRole('dialog', { name: /add manual account/i })).not.toBeInTheDocument()
  })

  it('creates a manual account through the modal', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    const onClose = vi.fn()

    render(
      <AddManualAccountModal connectionId="conn-1" institutionName="American Express" onClose={onClose} onCreated={onCreated} />,
      { wrapper: InstitutionProvider },
    )

    await user.type(screen.getByLabelText(/account name/i), 'Old Amex Gold')
    await screen.findByRole('option', { name: 'sam' })
    await user.selectOptions(screen.getByLabelText(/owner/i), 'sam')
    expect(screen.getByRole('option', { name: 'Crypto Wallet' })).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Type'), 'CREDIT')
    await user.click(screen.getByLabelText('Closed'))
    await user.click(screen.getByLabelText('Hidden'))

    await user.click(screen.getByRole('button', { name: /create account/i }))

    expect(onCreated).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('disables the create button when name is empty', () => {
    render(
      <AddManualAccountModal connectionId="conn-1" institutionName="American Express" onClose={vi.fn()} onCreated={vi.fn()} />,
      { wrapper: InstitutionProvider },
    )

    expect(screen.getByRole('button', { name: /create account/i })).toBeDisabled()
  })

  it('opens account detail modal from connection row', async () => {
    const user = userEvent.setup()

    renderAccountsPage()

    expect(await screen.findByText('American Express')).toBeInTheDocument()

    const accountButton = screen.getAllByRole('button', { name: /checking/i })[0]
    await user.click(accountButton)

    expect(await screen.findByRole('dialog', { name: /details for checking/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /close details for checking/i }))
    expect(screen.queryByRole('dialog', { name: /details for checking/i })).not.toBeInTheDocument()
  })

  it('opens account detail modal from an EVM wallet row', async () => {
    const user = userEvent.setup()

    renderAccountsPage()

    await user.click(await screen.findByRole('button', { name: /main wallet/i }))

    expect(await screen.findByRole('dialog', { name: /details for main wallet/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /info/i })).toHaveAttribute('href', '/accounts/acct-evm/info')
    expect(screen.getByRole('link', { name: /valuation/i })).toHaveAttribute('href', '/accounts/acct-evm/valuation')
    expect(await screen.findByRole('button', { name: 'Remove Ethereum' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\+ chain/i })).toBeInTheDocument()
    expect(screen.queryByRole('searchbox', { name: /search chains/i })).not.toBeInTheDocument()
  })

  it('hides EVM wallet actions for read-only users', async () => {
    vi.mocked(usePermissions).mockReturnValue({
      canRead: () => true,
      canWrite: (resource) => resource !== 'accounts',
      hasScope: () => true,
    })

    renderAccountsPage()

    const heading = await screen.findByRole('heading', { name: 'Main Wallet' })
    const section = heading.closest('section')
    if (!section) throw new Error('Expected EVM wallet row section')
    expect(within(section).queryByRole('button', { name: /open wallet actions/i })).not.toBeInTheDocument()
  })

  it('opens account detail modal from a real estate row', async () => {
    const user = userEvent.setup()

    renderAccountsPage()

    const accountButton = await screen.findByRole('button', { name: /primary home/i })
    expect(accountButton.closest('section')).toHaveClass('overflow-visible')
    expect(screen.getByRole('button', { name: /open home actions/i })).toBeInTheDocument()
    await user.click(accountButton)

    expect(await screen.findByRole('dialog', { name: /details for primary home/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /info/i })).toHaveAttribute('href', '/accounts/acct-real-estate/info')
    expect(screen.getByRole('link', { name: /valuation/i })).toHaveAttribute('href', '/accounts/acct-real-estate/valuation')
  })

  it('edits an account subtype through the detail modal', async () => {
    const user = userEvent.setup()
    const account: Account = { ...accounts[0], connection: null }
    const onUpdate = vi.fn()

    render(
      <AccountDetailModal account={account} onClose={vi.fn()} onUpdate={onUpdate} />,
      { wrapper: InstitutionProviderWithRouter },
    )

    const subtypeSelect = screen.getByLabelText('Subtype')
    expect(subtypeSelect).toHaveValue('checking')
    expect(screen.getByRole('option', { name: 'money market' })).toBeInTheDocument()

    await user.selectOptions(subtypeSelect, 'money market')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ subtype: 'money market' })
  })

  it('only offers subtypes valid for the selected type and clears a mismatched one on type change', async () => {
    const user = userEvent.setup()
    const account: Account = { ...accounts[0], connection: null }

    render(
      <AccountDetailModal account={account} onClose={vi.fn()} onUpdate={vi.fn()} />,
      { wrapper: InstitutionProviderWithRouter },
    )

    // A depository account offers depository subtypes, not credit ones.
    expect(screen.getByRole('option', { name: 'checking' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'credit card' })).not.toBeInTheDocument()

    // Switching to CREDIT drops the (now invalid) "checking" subtype and offers credit subtypes.
    await user.selectOptions(screen.getByLabelText('Type'), 'CREDIT')
    expect(screen.getByLabelText('Subtype')).toHaveValue('')
    expect(screen.queryByRole('option', { name: 'checking' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'credit card' })).toBeInTheDocument()
  })

  it('renders PROPERTY account type as read-only label in AccountDetailModal', () => {
    const reAccount: Account = {
      id: 'real-1',
      connection: null,
      owner: { __typename: 'Owner', id: 'owner-1', name: 'alex' },
      name: 'Primary Home',
      type: 'PROPERTY',
      subtype: null,
      mask: null,
      closed: false,
      hidden: false,
      needsReview: false,
      manual: false,
      typeLocked: true,
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    }

    render(
      <AccountDetailModal account={reAccount} onClose={vi.fn()} />,
      { wrapper: InstitutionProviderWithRouter },
    )

    expect(screen.getByLabelText('Type')).toHaveValue('PROPERTY')
    expect(screen.getByLabelText('Type')).toBeDisabled()
  })

  it('edits a linked property address when none exists yet', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    const connection = {
      __typename: 'Connection' as const,
      id: 'real-estate-1',
      name: 'Primary home',
      owner: { __typename: 'Owner' as const, id: 'owner-1', name: 'alex' },
      isActive: true,
      provider: { __typename: 'EVMWallet' as const, address: '0x1234567890abcdef1234567890abcdef12345678', chainIds: ['eth'] },
    }
    const propertyAccount: Account = {
      __typename: 'Account',
      id: 're-empty-address',
      connection,
      owner: { __typename: 'Owner', id: 'owner-1', name: 'alex' },
      name: 'Primary home',
      type: 'PROPERTY',
      subtype: null,
      mask: null,
      notes: null,
      accountWealthProperty: null,
      latestSnapshot: null,
      lastSyncedAt: null,
      closed: false,
      hidden: false,
      needsReview: false,
      manual: false,
      typeLocked: true,
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    }
    const updateRealEstate = captureMutation<{ connectionId: string; street?: string }>('UpdateRealEstate', { updateRealEstate: { __typename: 'UpdateRealEstatePayload', account: propertyAccount } })

    render(
      <AccountDetailModal account={propertyAccount} onClose={vi.fn()} onUpdate={onUpdate} />,
      { wrapper: InstitutionProviderWithRouter },
    )

    expect(screen.getByLabelText('Street')).toHaveValue('')

    await user.type(screen.getByLabelText('Street'), '673 Guerrero St')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(updateRealEstate.input).toMatchObject({ connectionId: 'real-estate-1', street: '673 Guerrero St' }))
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: propertyAccount.id, type: 'PROPERTY' }))
  })

  it('renders CRYPTO_WALLET account type as read-only label', () => {
    const cwAccount: Account = {
      id: 'cw-1',
      connection: { id: 'conn-2', name: 'My Wallet', owner: { __typename: 'Owner' as const, id: 'owner-1', name: 'alex' }, isActive: true, provider: { __typename: 'EVMWallet', address: '0x1234567890abcdef1234567890abcdef12345678', chainIds: ['eth'] } },
      owner: { __typename: 'Owner', id: 'owner-1', name: 'alex' },
      name: 'My Wallet',
      type: 'CRYPTO_WALLET',
      subtype: null,
      mask: null,
      closed: false,
      hidden: false,
      needsReview: false,
      manual: false,
      typeLocked: true,
      createdAt: '2026-05-01T00:00:00Z',
      updatedAt: '2026-05-01T00:00:00Z',
    }

    render(
      <AccountDetailModal account={cwAccount} onClose={vi.fn()} />,
      { wrapper: InstitutionProviderWithRouter },
    )

    expect(screen.getByLabelText('Type')).toHaveValue('CRYPTO_WALLET')
    expect(screen.getByLabelText('Type')).toBeDisabled()
    expect(screen.queryByLabelText('Subtype')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /view transactions/i })).toBeInTheDocument()
    expect(screen.queryByText('Institution')).not.toBeInTheDocument()
  })

  it('edits a manual account type to crypto wallet', async () => {
    const user = userEvent.setup()
    const onUpdate = vi.fn()

    render(
      <AccountDetailModal account={{ ...accounts[0], manual: true, connection: null, type: 'OTHER', subtype: null }} onClose={vi.fn()} onUpdate={onUpdate} />,
      { wrapper: InstitutionProviderWithRouter },
    )

    expect(screen.getByLabelText('Type')).toHaveValue('OTHER')
    expect(screen.getByLabelText('Type')).toBeEnabled()

    await user.selectOptions(screen.getByLabelText('Type'), 'CRYPTO_WALLET')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(onUpdate).toHaveBeenCalled())
    expect(onUpdate.mock.calls[0][0]).toMatchObject({ type: 'CRYPTO_WALLET' })
  })

  it('renders standalone rows in account order: plaid, wallet, home, manual', async () => {
    const walletConnection = {
      id: 'evm-1',
      name: 'My Wallet',
      owner: { __typename: 'Owner' as const, id: 'owner-1', name: 'alex' },
      isActive: true,
      provider: { __typename: 'EVMWallet' as const, address: '0x1234567890abcdef1234567890abcdef12345678', chainIds: ['eth'] },
    }
    mockQuery('Connections', {
      connections: {
        __typename: 'ConnectionList',
        items: [{ __typename: 'Connection', ...walletConnection }, { __typename: 'Connection', id: 'conn-1', name: 'American Express', owner: { __typename: 'Owner', id: 'owner-1', name: 'alex' }, isActive: true, provider: plaidItems[0] }],
      },
    })
    mockQuery('Accounts', {
      accounts: {
        __typename: 'AccountList',
        items: [
          { __typename: 'Account', id: 'home-1', connection: { __typename: 'Connection', id: 'real-estate-1', name: 'Primary home', owner: { __typename: 'Owner', id: 'owner-1', name: 'alex' }, isActive: true }, owner: { __typename: 'Owner', id: 'owner-1', name: 'alex' }, name: 'Primary home', type: 'PROPERTY', subtype: null, mask: null, notes: null, closed: false, hidden: false, needsReview: false, manual: false, typeLocked: true, accountWealthProperty: { __typename: 'RealEstateAssetDetails', address: { __typename: 'Address', street: '673 Guerrero St', city: 'San Francisco', state: 'CA', zip: '94110', homeType: null } }, latestSnapshot: { __typename: 'AccountSnapshot', id: 'snapshot-home', accountId: 'home-1', date: '2026-06-01', balanceUSD: 750000, netContributionUSD: 750000, holdings: [], flagged: false }, lastSyncedAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
          { __typename: 'Account', id: 'manual-1', connection: null, owner: { __typename: 'Owner', id: 'owner-1', name: 'alex' }, name: 'Cash Wallet', type: 'OTHER', subtype: null, mask: null, notes: null, closed: false, hidden: false, needsReview: false, manual: true, typeLocked: false, accountWealthProperty: null, latestSnapshot: { __typename: 'AccountSnapshot', id: 'snapshot-manual', accountId: 'manual-1', date: '2026-06-01', balanceUSD: 250, netContributionUSD: 250, holdings: [], flagged: false }, lastSyncedAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        ],
      },
    })

    renderAccountsPage()

    expect(await screen.findByText('American Express')).toBeInTheDocument()
    expect(screen.getByTitle('0x1234567890abcdef1234567890abcdef12345678')).toBeInTheDocument()
    expect(screen.getByText('Primary home')).toBeInTheDocument()
    expect(screen.getByText('Cash Wallet')).toBeInTheDocument()
    expect(screen.queryByText('$250.00')).not.toBeInTheDocument()
    expect(screen.queryByText('$750,000.00')).not.toBeInTheDocument()
    expect(screen.getAllByLabelText('Manual account')).toHaveLength(1)

    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(headings).toEqual(['American Express', '0x1234567890abcdef1234567890abcdef12345678', 'Primary home', 'Cash Wallet'])
  })

  it('removes a manual account from the details modal', async () => {
    const user = userEvent.setup()
    mockQuery('Accounts', {
      accounts: {
        __typename: 'AccountList',
        items: [
          { __typename: 'Account', id: 'manual-1', connection: null, owner: { __typename: 'Owner', id: 'owner-1', name: 'alex' }, name: 'Cash Wallet', type: 'OTHER', subtype: null, mask: null, notes: null, closed: false, hidden: false, needsReview: false, manual: true, typeLocked: false, accountWealthProperty: null, latestSnapshot: { __typename: 'AccountSnapshot', id: 'snapshot-manual', accountId: 'manual-1', date: '2026-06-01', balanceUSD: 250, netContributionUSD: 250, holdings: [], flagged: false }, lastSyncedAt: null, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
        ],
      },
    })
    const removeManualAccount = captureMutation<{ id: string }>('RemoveManualAccount', { removeManualAccount: { __typename: 'RemoveManualAccountPayload', success: true } })

    renderAccountsPage()

    await user.click(await screen.findByRole('button', { name: /cash wallet/i }))
    expect(await screen.findByRole('dialog', { name: /details for cash wallet/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^remove$/i }))
    await user.click(screen.getByRole('button', { name: /confirm remove/i }))

    expect(await screen.findByText(/manual account removed/i)).toBeInTheDocument()
    expect(removeManualAccount.input?.id).toBe('manual-1')
  })

  it('links an EVM wallet after validating the address', async () => {
    const user = userEvent.setup()
    const onLinked = vi.fn()
    const linkEVMWallet = deferred()
    let linkInput: { address: string; ownerId: string; label: string | null; chainIds: string[] } | undefined
    server.use(
      graphql.link('/query').mutation<Record<string, unknown>, { input: { address: string; ownerId: string; label: string | null; chainIds: string[] } }>('LinkEVMWallet', async ({ variables }) => {
        const input = variables.input
        linkInput = input
        const connection = { __typename: 'Connection' as const, id: 'evm-1', name: input.label || 'Wallet', owner: { __typename: 'Owner' as const, id: input.ownerId, name: 'sam' }, isActive: true, provider: { __typename: 'EVMWallet' as const, address: input.address, chainIds: input.chainIds } }
        await linkEVMWallet.wait()
        return HttpResponse.json({
          data: {
            linkEVMWallet: {
              __typename: 'LinkEVMWalletPayload',
              connection,
              account: { ...accounts[0], id: 'evm-account', connection, name: input.label || 'Wallet', owner: { __typename: 'Owner', id: input.ownerId, name: 'sam' } },
            },
          },
        })
      }),
    )

    render(<LinkEVMWalletModal onClose={vi.fn()} onLinked={onLinked} />, { wrapper: InstitutionProvider })

    expect(screen.getByRole('button', { name: /link wallet/i })).toBeDisabled()
    expect(await screen.findByRole('button', { name: 'Remove Ethereum' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Arbitrum' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Base' })).not.toBeInTheDocument()
    expect(screen.queryByRole('searchbox', { name: /search chains/i })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/wallet address/i), '0x1234567890abcdef1234567890abcdef12345678')
    await user.type(screen.getByLabelText(/label/i), 'Main wallet')
    await user.click(screen.getByRole('button', { name: '+ Chain' }))
    await user.type(await screen.findByRole('searchbox', { name: /search chains/i }), 'Base')
    await user.click(await screen.findByRole('button', { name: /base/i }))
    expect(await screen.findByRole('button', { name: 'Remove Base' })).toBeInTheDocument()
    await screen.findByRole('option', { name: 'sam' })
    await user.selectOptions(screen.getByLabelText(/owner/i), 'sam')
    await user.click(screen.getByRole('button', { name: /link wallet/i }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Linking connection…')
    expect(screen.queryByLabelText(/wallet address/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/label/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/owner/i)).not.toBeInTheDocument()

    linkEVMWallet.resolve()

    await waitFor(() => expect(onLinked).toHaveBeenCalledWith(expect.objectContaining({ connection: expect.objectContaining({ id: 'evm-1' }) })))
    expect(linkInput?.chainIds).toEqual(['eth', 'base'])
  })

  it('hides EVM wallet actions when no callbacks are available', () => {
    const wallet: EVMWallet = { __typename: 'EVMWallet', address: '0x1234567890abcdef1234567890abcdef12345678', chainIds: ['eth'] }

    render(<EVMWalletRow isActive wallet={wallet} />, { wrapper: InstitutionProvider })

    expect(screen.queryByRole('button', { name: /open wallet actions/i })).not.toBeInTheDocument()
  })

  it('links real estate with manual valuation', async () => {
    const user = userEvent.setup()
    const onLinked = vi.fn()
    server.use(
      graphql.link('/query').mutation<Record<string, unknown>, { input: { manualValuationUSD: number; ownerId: string } }>('LinkRealEstate', ({ variables }) => {
        const input = variables.input
        return HttpResponse.json({
          data: {
            linkRealEstate: {
              __typename: 'LinkRealEstatePayload',
              connection: { __typename: 'Connection', id: 'real-estate-1', name: 'Primary home', owner: { __typename: 'Owner', id: input.ownerId, name: 'sam' }, isActive: true, provider: null },
              account: { ...accounts[0], id: 'home-account', name: 'Primary home', owner: { __typename: 'Owner', id: input.ownerId, name: 'sam' } },
              valuationUSD: input.manualValuationUSD,
            },
          },
        })
      }),
    )

    render(<LinkRealEstateModal onClose={vi.fn()} onLinked={onLinked} />, { wrapper: InstitutionProvider })

    await user.type(screen.getByLabelText(/street/i), '673 Guerrero St')
    await user.type(screen.getByLabelText(/city/i), 'San Francisco')
    await user.type(screen.getByLabelText(/state/i), 'CA')
    await user.type(screen.getByLabelText(/zip/i), '94110')
    await user.type(screen.getByLabelText(/manual valuation/i), '1450000')
    await screen.findByRole('option', { name: 'sam' })
    await user.selectOptions(screen.getByLabelText(/owner/i), 'sam')
    await user.click(screen.getByRole('button', { name: /link home/i }))

    await waitFor(() => expect(onLinked).toHaveBeenCalledWith(expect.objectContaining({ valuationUSD: 1450000 })))
  })

  it('updates and unlinks a real estate row', async () => {
    const user = userEvent.setup()
    const onUpdated = vi.fn()
    const onUnlink = vi.fn()
    const accountWealthProperty: Account['accountWealthProperty'] = {
      __typename: 'RealEstateAssetDetails',
      address: { __typename: 'Address', street: '673 Guerrero St', city: 'San Francisco', state: 'CA', zip: '94110', homeType: null },
    }
    mockMutation('UpdateRealEstate', { updateRealEstate: { __typename: 'UpdateRealEstatePayload', account: { ...accounts[0], id: 'real-estate-acc-1', name: 'Primary home', type: 'PROPERTY', latestSnapshot: { __typename: 'AccountSnapshot', id: 'snapshot-home-updated', accountId: 'real-estate-acc-1', date: '2026-06-01', balanceUSD: 1500000, netContributionUSD: 1500000, holdings: [], flagged: false } } } })
    mockMutation('UnlinkRealEstate', { unlinkRealEstate: true })

    render(<RealEstateRow account={{ ...accounts[0], name: 'Primary home', latestSnapshot: { __typename: 'AccountSnapshot', id: 'snapshot-home', accountId: accounts[0].id, date: '2026-06-01', balanceUSD: 1450000, netContributionUSD: 1450000, holdings: [], flagged: false } }} accountWealthProperty={accountWealthProperty} connectionId="real-estate-1" onUnlink={onUnlink} onUpdated={onUpdated} />, { wrapper: InstitutionProvider })

    expect(screen.queryByText('$1,450,000.00')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /open home actions/i }))
    await user.click(screen.getByRole('button', { name: /update value/i }))
    await user.type(screen.getByLabelText(/manual valuation/i), '1500000')
    await user.click(screen.getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(onUpdated).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: /open home actions/i }))
    await user.click(screen.getByRole('button', { name: /remove/i }))
    await user.click(screen.getByRole('button', { name: /confirm remove/i }))
    await waitFor(() => expect(onUnlink).toHaveBeenCalledWith('real-estate-1'))
  })

  it('shows real estate row empty states and validates manual valuation', async () => {
    const user = userEvent.setup()
    const onUpdated = vi.fn()
    const accountWealthProperty: Account['accountWealthProperty'] = {
      __typename: 'RealEstateAssetDetails',
      address: { __typename: 'Address', street: null, city: null, state: null, zip: null, homeType: null },
    }

    render(<RealEstateRow accountWealthProperty={accountWealthProperty} connectionId="real-estate-1" onUpdated={onUpdated} />, { wrapper: InstitutionProvider })

    expect(screen.getAllByText('Home')).toHaveLength(2)
    expect(screen.queryByText('Not valued')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /open home actions/i }))
    await user.click(screen.getByRole('button', { name: /update value/i }))
    await user.type(screen.getByLabelText(/manual valuation/i), '-1')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    expect(screen.getByText(/enter a positive valuation/i)).toBeInTheDocument()
    expect(onUpdated).not.toHaveBeenCalled()
  })

  it('hides real estate row actions when callbacks are absent', () => {
    const accountWealthProperty: Account['accountWealthProperty'] = {
      __typename: 'RealEstateAssetDetails',
      address: { __typename: 'Address', street: '673 Guerrero St', city: 'San Francisco', state: 'CA', zip: '94110', homeType: null },
    }

    render(<RealEstateRow accountWealthProperty={accountWealthProperty} connectionId="real-estate-1" />, { wrapper: InstitutionProvider })

    expect(screen.getAllByText('673 Guerrero St, San Francisco, CA, 94110')).toHaveLength(2)
    expect(screen.queryByRole('button', { name: /open home actions/i })).not.toBeInTheDocument()
  })
})

describe('AccountsPage account routes', () => {
  it('opens account info from /accounts/:account_id', async () => {
    render(<AccountsPage />, { wrapper: InstitutionProviderWithAccountRoute })

    expect(await screen.findByRole('button', { name: /link connection/i })).toBeInTheDocument()
    expect(await screen.findByRole('dialog', { name: /details for Checking/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^info$/i })).toHaveAttribute('href', '/accounts/acct-1/info')
    expect(screen.getByRole('link', { name: /^valuation$/i })).toHaveAttribute('href', '/accounts/acct-1/valuation')
    expect(screen.getByLabelText('Notes')).toHaveValue('Primary household operating account with bill-pay autopay notes.')
    expect(screen.queryByLabelText('Snapshot date')).not.toBeInTheDocument()
  })

  it('opens account valuation from /accounts/:account_id/valuation', async () => {
    render(<AccountsPage />, { wrapper: InstitutionProviderWithValuationRoute })

    expect(await screen.findByRole('dialog', { name: /details for Checking/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^valuation$/i })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    expect(await screen.findByLabelText('Snapshot date')).toHaveValue('2026-05-21')
    expect(await screen.findByRole('heading', { name: 'Balance' })).toBeInTheDocument()
    expect(screen.getByText('VTI')).toBeInTheDocument()
    expect(screen.getByText('Price $250.00')).toBeInTheDocument()
    expect(screen.getByLabelText('Valuation for VTI')).toHaveTextContent('4')
    expect(screen.getByText('$1,000.00')).toBeInTheDocument()
    expect(screen.queryByText('Qty 50')).not.toBeInTheDocument()
    expect(screen.queryByText('Vanguard Total Stock Market ETF')).not.toBeInTheDocument()
  })

  it('redirects an unknown tab segment to the Info tab', async () => {
    render(<AccountsPage />, { wrapper: InstitutionProviderWithUnknownTabRoute })

    expect(await screen.findByRole('dialog', { name: /details for Checking/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^info$/i })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('Name')).toHaveValue('Checking')
    expect(screen.queryByLabelText('Snapshot date')).not.toBeInTheDocument()
  })
})

function InstitutionProvider({ children }: { children: ReactNode }) {
  return <TestProviders withGraphql>{children}</TestProviders>
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })

  return {
    resolve,
    wait: () => promise,
  }
}

function InstitutionProviderWithRouter({ children }: { children: ReactNode }) {
  return (
    <TestProviders initialEntries={['/accounts']} withGraphql withMobileHeader>
      {accountRoutes(children)}
    </TestProviders>
  )
}

function InstitutionProviderWithAccountRoute({ children }: { children: ReactNode }) {
  return (
    <TestProviders initialEntries={['/accounts/acct-1']} withGraphql withMobileHeader>
      {accountRoutes(children)}
    </TestProviders>
  )
}

function InstitutionProviderWithValuationRoute({ children }: { children: ReactNode }) {
  return (
    <TestProviders initialEntries={['/accounts/acct-1/valuation']} withGraphql withMobileHeader>
      {accountRoutes(children)}
    </TestProviders>
  )
}

function InstitutionProviderWithUnknownTabRoute({ children }: { children: ReactNode }) {
  return (
    <TestProviders initialEntries={['/accounts/acct-1/not-a-tab']} withGraphql withMobileHeader>
      {accountRoutes(children)}
    </TestProviders>
  )
}

function accountRoutes(children: ReactNode) {
  return <Routes>{ACCOUNTS_PATHS.map((path) => <Route element={children} key={path} path={absoluteRoutePath(path)} />)}</Routes>
}
