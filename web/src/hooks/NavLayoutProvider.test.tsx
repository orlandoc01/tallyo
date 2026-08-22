import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LayoutSection } from '../components/settings/LayoutSection'
import { NavLayoutProvider } from './NavLayoutProvider'
import { useNavLayout } from './useNavLayout'

vi.mock('./usePermissions', async () => (await import('../test/permissions')).allowAllPermissions())

const STORAGE_KEY = 'nav-layout-v1'

function LayoutProbe() {
  const { layout } = useNavLayout()

  return <output aria-label="layout">{JSON.stringify(layout)}</output>
}

describe('NavLayoutProvider', () => {
  it('removes stale items, deduplicates, and persists the repaired layout', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        navbar: ['transactions', 'removed-tab', 'transactions', 'institutions'],
        sidemenu: ['recurring', 'institutions', 'old-tab'],
      }),
    )

    render(
      <NavLayoutProvider>
        <LayoutProbe />
      </NavLayoutProvider>,
    )

    const expected = {
      navbar: ['transactions', 'accounts'],
      sidemenu: ['recurring', 'net-worth', 'portfolio', 'expenses', 'cash-flow', 'budgets', 'review'],
    }

    expect(screen.getByLabelText('layout')).toHaveTextContent(JSON.stringify(expected))
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(expected))
  })

  it('adds newly available items to the side menu', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ navbar: ['expenses'], sidemenu: ['transactions'] }),
    )

    render(
      <NavLayoutProvider>
        <LayoutProbe />
      </NavLayoutProvider>,
    )

    expect(JSON.parse(screen.getByLabelText('layout').textContent ?? '{}')).toEqual({
      navbar: ['expenses'],
      sidemenu: ['transactions', 'net-worth', 'portfolio', 'cash-flow', 'budgets', 'review', 'recurring', 'accounts'],
    })
  })

  it('resets corrupt layout storage', () => {
    localStorage.setItem(STORAGE_KEY, 'not-json')

    render(
      <NavLayoutProvider>
        <LayoutProbe />
      </NavLayoutProvider>,
    )

    const expected = {
      navbar: ['net-worth', 'portfolio', 'expenses', 'cash-flow'],
      sidemenu: ['transactions', 'review', 'budgets', 'recurring', 'accounts'],
    }

    expect(screen.getByLabelText('layout')).toHaveTextContent(JSON.stringify(expected))
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(expected))
  })

  it('moves extra navbar items to the side menu and removes cross-list duplicates', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        navbar: ['net-worth', 'expenses', 'cash-flow', 'transactions', 'review'],
        sidemenu: ['net-worth', 'budgets', 'recurring', 'accounts', 'rules', 'categories'],
      }),
    )

    render(
      <NavLayoutProvider>
        <LayoutProbe />
      </NavLayoutProvider>,
    )

    const expected = {
      navbar: ['net-worth', 'expenses', 'cash-flow', 'transactions'],
      sidemenu: ['review', 'budgets', 'recurring', 'accounts', 'portfolio'],
    }

    expect(screen.getByLabelText('layout')).toHaveTextContent(JSON.stringify(expected))
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(expected))
  })

  it('shows the renamed Accounts item in the mobile layout settings', () => {
    render(
      <NavLayoutProvider>
        <LayoutSection />
      </NavLayoutProvider>,
    )

    expect(screen.getByText('Accounts')).toBeInTheDocument()
    expect(screen.queryByText('Connections')).not.toBeInTheDocument()
    expect(screen.queryByText('Institutions')).not.toBeInTheDocument()
  })

  it('normalizes legacy connections ids from stored layouts', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        navbar: ['connections', 'transactions'],
        sidemenu: ['review', 'connections', 'categories'],
      }),
    )

    render(
      <NavLayoutProvider>
        <LayoutProbe />
      </NavLayoutProvider>,
    )

    const expected = {
      navbar: ['accounts', 'transactions'],
      sidemenu: ['review', 'net-worth', 'portfolio', 'expenses', 'cash-flow', 'budgets', 'recurring'],
    }

    expect(screen.getByLabelText('layout')).toHaveTextContent(JSON.stringify(expected))
    expect(localStorage.getItem(STORAGE_KEY)).toBe(JSON.stringify(expected))
  })
})
