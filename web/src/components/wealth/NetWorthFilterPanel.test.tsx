import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Account } from '../../types/graphql'
import { renderWithProviders } from '../../test/renderWithProviders'
import { NetWorthFilterPanel } from './NetWorthFilterPanel'

function account(id: string, name: string, institution: string | null): Account {
  return { id, name, type: 'DEPOSITORY', owner: { id: 'owner', name: 'Alex' }, closed: false, hidden: false, needsReview: false, manual: institution === null, typeLocked: false, createdAt: '', updatedAt: '', connection: institution ? { id: institution, name: institution, owner: { id: 'owner', name: 'Alex' }, isActive: true, provider: null } : null }
}

const chaseAccounts = Array.from({ length: 6 }, (_, index) => account(`chase-${index}`, `Chase ${index}`, 'Chase'))
const allyAccounts = Array.from({ length: 3 }, (_, index) => account(`ally-${index}`, `Ally ${index}`, 'Ally'))
const accounts = [...chaseAccounts, ...allyAccounts, account('manual', 'Cash jar', null)]

function renderPanel(accountIds: string[] = [], onAccountChange = vi.fn(), hideOwners = false) {
  renderWithProviders(
    <NetWorthFilterPanel accounts={accounts} accountGroupIds={[]} accountIds={accountIds} owners={[{ id: 'owner', name: 'Alex' }]} ownerIds={[]} range="YTD" showAccountFilters onAccountChange={onAccountChange} onAccountGroupChange={vi.fn()} onClear={vi.fn()} onOwnerChange={vi.fn()} onRangeChange={vi.fn()} />,
    { auth: { hideOwners } },
  )
  return onAccountChange
}

describe('NetWorthFilterPanel owner chip', () => {
  it('is hidden when owners are hidden', () => {
    renderPanel([], vi.fn(), true)
    expect(screen.queryByRole('button', { name: 'Owner' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Account type' })).toBeInTheDocument()
  })
})

describe('NetWorthFilterPanel account dropdown', () => {
  it('searches accounts by name or institution when there are more than eight', async () => {
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Account' }))
    const search = screen.getByRole('textbox', { name: 'Account search' })

    await userEvent.type(search, 'ally')
    expect(screen.getAllByRole('checkbox', { name: /^Ally \d$/ })).toHaveLength(3)
    expect(screen.queryByRole('checkbox', { name: 'Chase 0' })).not.toBeInTheDocument()

    await userEvent.clear(search)
    await userEvent.type(search, 'nothing here')
    expect(screen.getByText('No accounts found.')).toBeInTheDocument()
  })

  it('toggles a whole institution and reflects partial selection as indeterminate', async () => {
    const onAccountChange = renderPanel(['ally-0'])
    await userEvent.click(screen.getByRole('button', { name: 'Account Ally 0' }))

    const allyGroup = screen.getByRole('checkbox', { name: 'Ally' })
    expect(allyGroup).not.toBeChecked()
    expect((allyGroup as HTMLInputElement).indeterminate).toBe(true)

    await userEvent.click(allyGroup)
    expect(onAccountChange).toHaveBeenCalledWith(['ally-0', 'ally-1', 'ally-2'])
  })

  it('selects and clears every account from the select-all row', async () => {
    const onAccountChange = renderPanel()
    await userEvent.click(screen.getByRole('button', { name: 'Account' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all accounts' }))
    expect(onAccountChange).toHaveBeenCalledWith(accounts.map((item) => item.id))

    onAccountChange.mockClear()
    const chaseGroup = screen.getByRole('checkbox', { name: 'Chase' })
    await userEvent.click(chaseGroup)
    expect(onAccountChange).toHaveBeenCalledWith(chaseAccounts.map((item) => item.id))
    expect(within(screen.getByRole('button', { name: 'Account' }).parentElement as HTMLElement).getByText('Manual')).toBeInTheDocument()
  })
})
