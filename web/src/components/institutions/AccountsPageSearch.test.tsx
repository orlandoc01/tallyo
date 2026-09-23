import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { AccountsPage } from '../../pages/AccountsPage'
import { ACCOUNTS_PATHS, absoluteRoutePath } from '../../routes'
import { LocationDisplay, TestProviders } from '../../test/renderWithProviders'
import { InstitutionRow } from './InstitutionRow'
import { plaidItems } from '../../mocks/fixtures'

vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

function renderAccountsPage(initialEntry = '/accounts') {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <TestProviders initialEntries={[initialEntry]} probes={<LocationDisplay />} withGraphql withMobileHeader>
        <Routes>{ACCOUNTS_PATHS.map((path) => <Route element={children} key={path} path={absoluteRoutePath(path)} />)}</Routes>
      </TestProviders>
    )
  }
  return render(<AccountsPage />, { wrapper: Wrapper })
}

describe('AccountsPage search and privacy', () => {
  it('narrows the cards by account name, updates the URL and clears through the empty state', async () => {
    const user = userEvent.setup()
    renderAccountsPage()

    await screen.findByRole('heading', { name: 'American Express' })
    expect(screen.getByRole('heading', { name: 'Manual accounts' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('Search accounts'), 'Quicksilver')
    expect(screen.getByTestId('location')).toHaveTextContent('/accounts?q=Quicksilver')
    expect(screen.getByRole('heading', { name: 'Capital One' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'American Express' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Manual accounts' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /quicksilver/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /venture x/i })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Search accounts'), 'zzz')
    expect(screen.getByText('No accounts match')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/accounts')
    expect(await screen.findByRole('heading', { name: 'American Express' })).toBeInTheDocument()
  })

  it('carries the search params through the detail route and masks balances under hide_amounts', async () => {
    const user = userEvent.setup()
    renderAccountsPage('/accounts?hide_amounts=true&q=wallet')

    const row = await screen.findByRole('button', { name: /main wallet/i })
    expect(within(row).getByText('$•,•••.••')).toBeInTheDocument()

    await user.click(row)
    expect(await screen.findByRole('dialog', { name: /details for main wallet/i })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/accounts/acct-evm/info?hide_amounts=true&q=wallet')

    await user.click(screen.getByRole('button', { name: /close details for main wallet/i }))
    expect(screen.getByTestId('location')).toHaveTextContent('/accounts?hide_amounts=true&q=wallet')
  })
})

describe('InstitutionRow actions menu', () => {
  const plaidItem = plaidItems[0]
  const connection = { id: 'conn-1', name: 'American Express', owner: { __typename: 'Owner' as const, id: 'owner-1', name: 'alex' }, isActive: true, provider: plaidItem }

  function renderRow() {
    return render(<InstitutionRow accounts={plaidItem.accounts} connection={connection} onAccountClick={vi.fn()} onDelete={vi.fn()} plaidItem={plaidItem} />)
  }

  it('shows the credential label in the meta line', () => {
    renderRow()
    expect(screen.getByText(/5 accounts · Primary · Connected/)).toBeInTheDocument()
  })

  it('dismisses on Escape and outside pointerdown, resetting the delete confirmation', async () => {
    const user = userEvent.setup()
    renderRow()
    const trigger = screen.getByRole('button', { name: /open actions for american express/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    await user.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(screen.getByRole('button', { name: /confirm delete/i })).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: /confirm delete/i })).not.toBeInTheDocument()

    await user.click(trigger)
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument()

    await user.pointer({ keys: '[MouseLeft>]', target: document.body })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })
})
