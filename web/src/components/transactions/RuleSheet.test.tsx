import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { accounts, categoryGroups, rules } from '../../mocks/fixtures'
import { graphql, HttpResponse } from 'msw'
import { server } from '../../mocks/server'
import { captureMutation, deferred } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { CreateRuleModal } from './CreateRuleModal'
import { EditRuleModal } from './EditRuleModal'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))
vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

describe('RuleSheet', () => {
  it('creates a rule from the Filters and Changes tabs', async () => {
    const user = userEvent.setup()
    const onCreated = vi.fn()
    const onClose = vi.fn()
    const createRule = captureMutation<Record<string, unknown>>('CreateRule', { createRule: { __typename: 'CreateRulePayload', rule: rules[0] } })
    render(<CreateRuleModal accounts={accounts} categoryGroups={categoryGroups} filter={{ merchantPrefix: 'Target' }} onClose={onClose} onCreated={onCreated} />, { wrapper: GraphqlTestProvider })

    const sheet = screen.getByRole('dialog', { name: 'Create rule' })
    expect(within(sheet).queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^merchant pattern/i })).toHaveTextContent('Target')
    expect(within(sheet).queryByRole('button', { name: /^priority/i })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Submit rule' })).toBeDisabled()

    await user.click(within(sheet).getByRole('button', { name: /^accounts/i }))
    await user.click(within(sheet).getByRole('checkbox', { name: /^checking/i }))
    expect(within(sheet).getByRole('button', { name: /^accounts/i })).toHaveTextContent('1 selected')

    await user.click(within(sheet).getByRole('tab', { name: 'Changes' }))
    expect(within(sheet).queryByRole('button', { name: /^merchant pattern/i })).not.toBeInTheDocument()
    await user.click(within(sheet).getByRole('button', { name: /^category/i }))
    await user.click(within(sheet).getByRole('radio', { name: 'Groceries' }))
    await user.click(within(sheet).getByRole('button', { name: /^tags/i }))
    await user.click(await within(sheet).findByRole('checkbox', { name: 'Travel' }))
    await user.click(within(sheet).getByRole('switch', { name: 'Apply retroactively' }))
    await user.click(within(sheet).getByRole('button', { name: 'Submit rule' }))

    await waitFor(() => expect(createRule.input).toEqual({
      applyRetroactively: true,
      merchantPattern: 'Target',
      accountIds: [accounts[0].id],
      changes: { categoryId: '1', tagIds: ['tag-2'] },
    }))
    expect(onCreated).toHaveBeenCalledOnce()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('edits a rule with priority and deletes it after a second tap', async () => {
    const user = userEvent.setup()
    const onUpdated = vi.fn()
    const onDeleted = vi.fn()
    const onClose = vi.fn()
    const updateRule = captureMutation<Record<string, unknown>>('UpdateRule', { updateRule: { __typename: 'UpdateRulePayload', rule: rules[0] } })
    const deleteRule = captureMutation('DeleteRule', { deleteRule: { __typename: 'DeleteRulePayload', success: true } })
    render(<EditRuleModal onClose={onClose} onDeleted={onDeleted} onUpdated={onUpdated} rule={rules[0]} />, { wrapper: GraphqlTestProvider })

    const sheet = screen.getByRole('dialog', { name: 'Edit rule' })
    expect(within(sheet).getByRole('button', { name: /^priority/i })).toHaveTextContent('10')
    await user.click(within(sheet).getByRole('button', { name: /^priority/i }))
    const priority = within(sheet).getByRole('spinbutton', { name: 'Priority' })
    await user.clear(priority)
    await user.type(priority, '5')
    await user.click(within(sheet).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(updateRule.input).toMatchObject({ id: '7', priority: 5, applyRetroactively: false, changes: { categoryId: '1' } }))
    expect(onUpdated).toHaveBeenCalledOnce()

    await user.click(within(sheet).getByRole('button', { name: 'Delete rule' }))
    expect(deleteRule.called).toBe(false)
    await user.click(within(sheet).getByRole('button', { name: 'Tap again to confirm' }))
    await waitFor(() => expect(deleteRule.variables).toEqual({ id: '7' }))
    expect(onDeleted).toHaveBeenCalledOnce()
  })

  it('locks Save changes while a delete is in flight', async () => {
    const user = userEvent.setup()
    const deleteRule = deferred()
    server.use(graphql.link('/query').mutation('DeleteRule', async () => {
      await deleteRule.wait()
      return HttpResponse.json({ data: { deleteRule: { __typename: 'DeleteRulePayload', success: true } } })
    }))
    const onDeleted = vi.fn()
    render(<EditRuleModal onClose={vi.fn()} onDeleted={onDeleted} rule={rules[0]} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: 'Delete rule' }))
    await user.click(screen.getByRole('button', { name: 'Tap again to confirm' }))
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled()
    deleteRule.resolve()
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce())
  })
})
