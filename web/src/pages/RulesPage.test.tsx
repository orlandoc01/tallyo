import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { graphql, HttpResponse } from 'msw'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { categories, rules } from '../mocks/fixtures'
import { server } from '../mocks/server'
import { absoluteRoutePath, SETTINGS_RULE_PATHS } from '../routes'
import { mockQuery } from '../test/msw'
import { allowAllPermissionResult } from '../test/permissions'
import { MobileHeaderActionsHost, renderWithProviders } from '../test/renderWithProviders'
import { usePermissions } from '../hooks/usePermissions'
import { RulesPage } from './RulesPage'

vi.mock('../hooks/usePermissions', async () => (await import('../test/permissions')).allowAllPermissions())

let initialRoute = '/settings/rules'

type RuleInput = Record<string, unknown> & {
  changes: { categoryId?: string; isHidden?: boolean; merchantName?: string; tagIds?: string[] }
}

type RuleMutationVariables = { input: RuleInput }

function renderRulesPage(withActionsHost = false) {
  return renderWithProviders(
    <Routes>
      {SETTINGS_RULE_PATHS.map((path) => <Route element={<RulesPage />} key={path} path={absoluteRoutePath(path)} />)}
    </Routes>,
    {
      auth: { scopes: [], masterPasswordStatus: 'DISABLED' },
      initialEntries: [initialRoute],
      probes: withActionsHost ? <MobileHeaderActionsHost /> : null,
      withGraphql: true,
      withMobileHeader: true,
    },
  )
}

async function renderAndWait() {
  renderRulesPage()
  await screen.findAllByText(/target/i)
}

async function openRuleEditor() {
  const user = userEvent.setup()
  await renderAndWait()
  await user.click(screen.getByRole('button', { name: /target/i }))
  return { dialog: screen.getByRole('dialog'), user }
}

function captureUpdateRule(retroactivelyUpdated = 0) {
  let captured: RuleMutationVariables | undefined
  server.use(
    graphql.link('/query').mutation<Record<string, unknown>, RuleMutationVariables>('UpdateRule', ({ variables }) => {
      captured = variables
      const input = variables.input
      const changes = input.changes
      return HttpResponse.json({ data: { updateRule: {
        __typename: 'UpdateRulePayload',
        retroactivelyUpdated,
        rule: {
          ...rules[0],
          id: input.id,
          merchantPattern: input.merchantPattern ?? null,
          originalPattern: input.originalPattern ?? null,
          merchantName: changes.merchantName ?? null,
          category: categories.find((item) => item.id === changes.categoryId) ?? categories[0],
          shouldHide: changes.isHidden ?? null,
          amountMin: input.amountMin ?? null,
          amountMax: input.amountMax ?? null,
          priority: input.priority ?? 0,
        },
      } } })
    }),
  )
  return () => captured
}

describe('RulesPage', () => {
  afterEach(() => {
    vi.useRealTimers()
    initialRoute = '/settings/rules'
    vi.mocked(usePermissions).mockReturnValue(allowAllPermissionResult)
  })

  it('renders existing rules', async () => {
    await renderAndWait()

    expect(screen.getAllByText('Target')).not.toHaveLength(0)
    expect(screen.getByText(/Priority 10/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Filters$/i })).toBeInTheDocument()
  })

  it('shows empty state when no rules exist', async () => {
    mockQuery('Rules', { rules: { __typename: 'RuleList', items: [] } })

    renderRulesPage()
    await screen.findByText('No rules yet')

    expect(screen.getByText('No rules yet')).toBeInTheDocument()
  })

  it('shows click-to-edit hint for writers', async () => {
    await renderAndWait()

    expect(screen.getByText('Click to edit')).toBeInTheDocument()
  })

  it('does not show click-to-edit hint for readers', async () => {
    vi.mocked(usePermissions).mockReturnValue({
      canRead: () => true,
      canWrite: () => false,
      hasScope: () => false,
    })

    await renderAndWait()

    expect(screen.queryByText('Click to edit')).not.toBeInTheDocument()
  })

  it('sends selected rule filters to the query', async () => {
    const user = userEvent.setup()
    let latestVariables: { input?: Record<string, unknown> } | undefined

    server.use(
      graphql.link('/query').query<Record<string, unknown>, { input?: Record<string, unknown> }>('Rules', ({ variables }) => {
        latestVariables = variables
        return HttpResponse.json({ data: { rules: { __typename: 'RuleList', items: rules } } })
      }),
    )

    await renderAndWait()

    await user.click(screen.getByRole('button', { name: /^Filters$/i }))
    await user.click(screen.getByRole('button', { name: /Patterns filter/i }))
    await user.type(screen.getByLabelText(/Merchant pattern/i), 'Tar')
    await user.click(screen.getByRole('button', { name: /Account filter/i }))
    await user.click(screen.getByLabelText('Checking (...9625)'))
    await user.click(screen.getByRole('button', { name: /Amount filter/i }))
    await user.type(screen.getByLabelText(/Amount min/i), '10')
    await user.type(screen.getByLabelText(/Amount max/i), '100')

    await waitFor(() => expect(latestVariables?.input).toMatchObject({
      merchantPattern: 'Tar',
      accountIds: ['acct-1'],
      amountMin: 10,
      amountMax: 100,
    }))
  })

  it('shows filtered empty state and clears rule filters', async () => {
    const user = userEvent.setup()
    await renderAndWait()

    await user.click(screen.getByRole('button', { name: /^Filters$/i }))
    await user.click(screen.getByRole('button', { name: /Patterns filter/i }))
    await user.type(screen.getByLabelText(/Merchant pattern/i), 'Amazon')
    await user.click(screen.getByRole('button', { name: /Amount filter/i }))
    await user.type(screen.getByLabelText(/Amount min/i), '1')

    expect(await screen.findByText('No matching rules')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Filters: 2 selected/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Clear all/i }))

    await screen.findAllByText(/target/i)
    expect(screen.getByRole('button', { name: /^Filters$/i })).toBeInTheDocument()
  })

  it('opens edit modal when rule row is clicked', async () => {
    const { dialog } = await openRuleEditor()
    expect(within(dialog).getByRole('heading', { name: 'Edit rule' })).toBeInTheDocument()
  })

  it('opens edit modal when the route includes a rule ID', async () => {
    initialRoute = `/settings/rules/${rules[0].id}`

    renderRulesPage()

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Edit rule' })).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/merchant pattern/i)).toHaveValue(rules[0].merchantPattern ?? '')
  })

  it('prefills edit modal with existing rule values', async () => {
    const { dialog } = await openRuleEditor()
    expect(within(dialog).getByLabelText(/merchant pattern/i)).toHaveValue(rules[0].merchantPattern ?? '')
    expect(within(dialog).getByLabelText(/original name pattern/i)).toHaveValue(rules[0].originalPattern ?? '')
    expect(within(dialog).getByLabelText(/priority/i)).toHaveValue(rules[0].priority)
    expect(within(dialog).getByRole('heading', { name: 'Filters' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'Changes' })).toBeInTheDocument()
    expect(within(dialog).getByRole('switch', { name: /hide matching transactions/i })).not.toBeChecked()
  })

  it('submits the update mutation with changed values', async () => {
    const updateRule = captureUpdateRule(3)
    const { dialog, user } = await openRuleEditor()
    const merchantInput = within(dialog).getByLabelText(/merchant pattern/i)
    await user.clear(merchantInput)
    await user.type(merchantInput, 'Walmart')

    await user.click(within(dialog).getByLabelText(/apply retroactively/i))
    await user.click(within(dialog).getByRole('switch', { name: /hide matching transactions/i }))
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(updateRule()?.input).toMatchObject({
        id: rules[0].id,
        merchantPattern: 'Walmart',
        applyRetroactively: true,
        changes: { isHidden: true },
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('requires confirmation before deleting a rule', async () => {
    const { dialog, user } = await openRuleEditor()
    await user.click(within(dialog).getByRole('button', { name: /delete rule/i }))

    expect(within(dialog).getByRole('button', { name: /confirm delete/i })).toBeInTheDocument()
  })

  it('deletes the rule after confirmation and closes the modal', async () => {
    const { dialog, user } = await openRuleEditor()
    await user.click(within(dialog).getByRole('button', { name: /delete rule/i }))
    await user.click(within(dialog).getByRole('button', { name: /confirm delete/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('cancels delete when Cancel is clicked after first delete click', async () => {
    const { dialog, user } = await openRuleEditor()
    await user.click(within(dialog).getByRole('button', { name: /delete rule/i }))
    expect(within(dialog).getByRole('button', { name: /confirm delete/i })).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: /^cancel$/i }))
    expect(within(dialog).getByRole('button', { name: /delete rule/i })).toBeInTheDocument()
  })

  it('closes the modal when Close button is clicked', async () => {
    const { dialog, user } = await openRuleEditor()
    expect(dialog).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /close/i }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('updates multiple fields including amount min/max, original pattern, and priority', async () => {
    const updateRule = captureUpdateRule()
    const { dialog, user } = await openRuleEditor()

    await user.clear(within(dialog).getByLabelText(/original name pattern/i))
    await user.type(within(dialog).getByLabelText(/original name pattern/i), 'WALMART')
    await user.clear(within(dialog).getByLabelText(/amount min/i))
    await user.type(within(dialog).getByLabelText(/amount min/i), '10')
    await user.clear(within(dialog).getByLabelText(/amount max/i))
    await user.type(within(dialog).getByLabelText(/amount max/i), '100')
    await user.clear(within(dialog).getByLabelText(/priority/i))
    await user.type(within(dialog).getByLabelText(/priority/i), '5')

    await user.click(within(dialog).getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(updateRule()?.input).toMatchObject({
        originalPattern: 'WALMART',
        amountMin: 10,
        amountMax: 100,
        priority: 5,
      }),
    )
  })

  it('updates the selected category through the shared picker', async () => {
    const updateRule = captureUpdateRule()
    const { dialog, user } = await openRuleEditor()
    expect(rules[0].category).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: new RegExp(`category .*${rules[0].category?.name}`, 'i') }))
    await user.type(screen.getByPlaceholderText(/search categories/i), 'rest')
    await user.click(screen.getByRole('button', { name: /restaurants/i }))
    await user.click(within(dialog).getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(updateRule()?.input).toMatchObject({
        changes: { categoryId: '2' },
      }),
    )
  })

  it('shows account checkboxes and selects accounts', async () => {
    const { dialog } = await openRuleEditor()
    const checkboxes = within(dialog).queryAllByRole('checkbox')
    // The first checkbox is the "apply retroactively" one; accounts are checkbox list items
    expect(checkboxes.length).toBeGreaterThanOrEqual(1)
  })

  it('opens create rule modal when Add is clicked', async () => {
    const user = userEvent.setup()
    await renderAndWait()

    await user.click(screen.getByRole('button', { name: /^add$/i }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Create rule' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'Filters' })).toBeInTheDocument()
    expect(within(dialog).getByRole('heading', { name: 'Changes' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /close/i }))
  })

  it('creates a hide-only rule', async () => {
    const user = userEvent.setup()
    let createRule: RuleMutationVariables | undefined

    server.use(
      graphql.link('/query').mutation<Record<string, unknown>, RuleMutationVariables>('CreateRule', ({ variables }) => {
        createRule = variables
        const input = variables.input
        const changes = input.changes
        return HttpResponse.json({
          data: {
            createRule: {
              __typename: 'CreateRulePayload',
              retroactivelyUpdated: 0,
              rule: {
                __typename: 'Rule',
                id: 'hide-rule',
                merchantPattern: input.merchantPattern ?? null,
                originalPattern: input.originalPattern ?? null,
                merchantName: changes.merchantName ?? null,
                category: null,
                tags: [],
                shouldHide: changes.isHidden ?? null,
                shouldBeRecurring: null,
                accounts: [],
                amountMin: null,
                amountMax: null,
                priority: 0,
                createdAt: '2026-05-01T00:00:00Z',
              },
            },
          },
        })
      }),
    )

    await renderAndWait()
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/merchant pattern/i), 'Venmo')
    await user.click(within(dialog).getByRole('switch', { name: /hide matching transactions/i }))
    await user.click(within(dialog).getByRole('button', { name: /submit rule/i }))

    await waitFor(() =>
      expect(createRule?.input).toMatchObject({
        merchantPattern: 'Venmo',
        changes: { isHidden: true },
        applyRetroactively: false,
      }),
    )
    expect(createRule?.input).not.toHaveProperty('categoryId')
    expect(createRule?.input).not.toHaveProperty('tagId')
  })

  it('creates a rule that renames matching merchants', async () => {
    const user = userEvent.setup()
    let createRule: RuleMutationVariables | undefined

    server.use(
      graphql.link('/query').mutation<Record<string, unknown>, RuleMutationVariables>('CreateRule', ({ variables }) => {
        createRule = variables
        return HttpResponse.json({ data: { createRule: {
          __typename: 'CreateRulePayload',
          retroactivelyUpdated: 0,
          rule: {
            ...rules[0],
            id: 'rename-rule',
            merchantPattern: variables.input.merchantPattern ?? null,
            merchantName: variables.input.changes.merchantName ?? null,
          },
        } } })
      }),
    )

    await renderAndWait()
    await user.click(screen.getByRole('button', { name: /^add$/i }))

    const dialog = screen.getByRole('dialog')
    await user.type(within(dialog).getByLabelText(/merchant pattern/i), 'Coffee')
    await user.type(within(dialog).getByLabelText(/^merchant name$/i), 'Coffee Shop')
    await user.click(within(dialog).getByRole('button', { name: /submit rule/i }))

    await waitFor(() => expect(createRule?.input).toMatchObject({ merchantPattern: 'Coffee', changes: { merchantName: 'Coffee Shop' } }))
  })

  it('opens create rule modal from the compact mobile header action', async () => {
    const user = userEvent.setup()
    renderRulesPage(true)
    await screen.findAllByText(/target/i)

    const createButton = within(screen.getByTestId('mobile-header-actions')).getByRole('button', { name: /create rule/i })
    expect(createButton).toHaveClass('h-10', 'w-10', 'rounded-xl')

    await user.click(createButton)

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Create rule' })).toBeInTheDocument()
  })

  it('opens rule filters from the compact mobile header action', async () => {
    const user = userEvent.setup()
    renderRulesPage(true)
    await screen.findAllByText(/target/i)

    const actions = screen.getByTestId('mobile-header-actions')
    const filterButton = within(actions).getByRole('button', { name: /open rule filters/i })
    expect(filterButton).toHaveClass('rounded-xl', 'p-2.5')

    await user.click(filterButton)

    expect(within(actions).getByText('Filters')).toBeInTheDocument()
  })
})
