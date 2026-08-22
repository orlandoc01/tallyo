import { useEffect, type ReactNode } from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { graphql, HttpResponse } from 'msw'
import { useMobileHeader } from '../components/layout/useMobileHeader'
import { TransactionSelectionProvider } from '../components/transactions/TransactionSelectionProvider'
import { allTransactions } from '../mocks/fixtures'
import { server } from '../mocks/server'
import { renderWithProviders } from '../test/renderWithProviders'
import { transactionConnection } from '../test/transactionConnection'
import { ReportsPage } from './ReportsPage'
import { TransactionsPage } from './TransactionsPage'

type AuthOverride = NonNullable<Parameters<typeof renderWithProviders>[1]>['auth']

const authContext: AuthOverride = { scopes: ['read:spending', 'read:transactions'], masterPasswordStatus: 'DISABLED' }
const writerAuthContext: AuthOverride = { ...authContext, scopes: ['read:spending', 'read:transactions', 'write:transactions'] }

function renderMobileFilters(ui: ReactNode, auth: AuthOverride = authContext) {
  return renderWithProviders(
    <TransactionSelectionProvider>{ui}</TransactionSelectionProvider>,
    { auth, initialEntries: ['/expenses/breakdown'], withGraphql: true, withMobileHeader: true },
  )
}

function OpenReportsFilterOnMount() {
  const { openFilter } = useMobileHeader()
  useEffect(() => { openFilter() }, [openFilter])
  return (
    <Routes>
      <Route element={<ReportsPage />} path="/expenses/:tab" />
    </Routes>
  )
}

function OpenTransactionsFilterOnMount() {
  const { openFilter } = useMobileHeader()
  useEffect(() => { openFilter() }, [openFilter])
  return <TransactionsPage />
}

describe('mobile filters', () => {
  it('anchors the expenses filter dropdown below the header action', async () => {
    renderMobileFilters(<OpenReportsFilterOnMount />)

    const dialog = await screen.findByRole('dialog', { name: 'Filters' })
    expect(dialog).toHaveClass('fixed', 'inset-x-0', 'bottom-0')
    expect(dialog).toHaveStyle({ top: '48px' })
    expect(dialog.firstElementChild).toHaveClass('absolute', 'right-0', 'top-0')
    expect(dialog.firstElementChild).toHaveClass('w-[min(20rem,100vw)]')
    expect(dialog.firstElementChild).toHaveClass('rounded-b-3xl')
    expect(dialog.firstElementChild).toHaveClass('max-h-full')
    expect(dialog.firstElementChild).toHaveClass('min-h-0')
    expect(dialog.firstElementChild).toHaveClass('overflow-hidden')
    expect(dialog.firstElementChild?.children[1]).toHaveClass('min-h-0', 'overflow-y-auto')

    fireEvent.click(dialog.firstElementChild!)
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument()
  })

  it('anchors the transactions filter dropdown below the header action', async () => {
    renderMobileFilters(<OpenTransactionsFilterOnMount />)

    const dialog = await screen.findByRole('dialog', { name: 'Filters' })
    expect(dialog).toHaveClass('fixed', 'inset-x-0', 'bottom-0')
    expect(dialog).toHaveStyle({ top: '48px' })
    expect(dialog.firstElementChild).toHaveClass('absolute', 'right-0', 'top-0')
    expect(dialog.firstElementChild).toHaveClass('w-[min(20rem,100vw)]')
    expect(dialog.firstElementChild).toHaveClass('rounded-b-3xl')
    expect(dialog.firstElementChild).toHaveClass('max-h-full')
    expect(dialog.firstElementChild).toHaveClass('min-h-0')
    expect(dialog.firstElementChild).toHaveClass('overflow-hidden')
    expect(dialog.firstElementChild?.children[1]).toHaveClass('min-h-0', 'overflow-y-auto')
    expect(screen.getAllByRole('heading', { name: 'Filters' })).toHaveLength(1)
    expect(dialog.firstElementChild?.children[1].firstElementChild).not.toHaveClass('rounded-3xl')
    expect(dialog.firstElementChild?.children[1].firstElementChild).not.toHaveClass('border')

    fireEvent.click(dialog.firstElementChild!)
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument()
  })

  it('selects all filtered transactions across ID pages', async () => {
    const user = userEvent.setup()
    const graphqlApi = graphql.link('/query')
    const filteredIds = allTransactions
      .filter((transaction) => !transaction.isHidden)
      .sort((left, right) => left.datetime === right.datetime ? 0 : left.datetime > right.datetime ? -1 : 1)
      .map((transaction) => transaction.id)
    const firstPageIds = filteredIds.slice(0, 4)
    const secondPageIds = filteredIds.slice(4)
    const bulkUpdateIds: string[][] = []

    server.use(
      graphqlApi.query<Record<string, unknown>, { input?: { after?: string | null } }>('TransactionIds', ({ variables }) => {
        const input = variables.input
        const ids = input?.after === 'ids-page-1' ? secondPageIds : firstPageIds

        return HttpResponse.json({
          data: {
            transactions: transactionConnection(
              ids.map((id) => ({ __typename: 'Transaction' as const, id })),
              {
                hasNextPage: input?.after !== 'ids-page-1',
                endCursor: input?.after === 'ids-page-1' ? 'ids-page-2' : 'ids-page-1',
              },
              filteredIds.length,
            ),
          },
        })
      }),
      graphqlApi.mutation<Record<string, unknown>, { input: { transactionIds: string[]; updates: { categoryId?: string } } }>('BulkUpdateTransactions', ({ variables }) => {
        const input = variables.input
        bulkUpdateIds.push(input.transactionIds)
        return HttpResponse.json({
          data: {
            bulkUpdateTransactions: {
              __typename: 'BulkUpdateTransactionsPayload',
              updatedCount: input.transactionIds.length,
              transactions: [],
            },
          },
        })
      }),
    )

    renderMobileFilters(<TransactionsPage />, writerAuthContext)

    await screen.findAllByText('Pizza Hut')
    await user.click(screen.getByRole('button', { name: 'Edit Multiple' }))

    const selectAll = screen.getByRole('checkbox', { name: 'Select all transactions in current filter' })
    await user.click(selectAll)

    await waitFor(() => expect(selectAll).toBeChecked())
    expect(screen.getAllByRole('checkbox', { name: 'Select transaction for Target' })[0]).toBeChecked()
    expect(screen.getByText(`${filteredIds.length} selected`)).toBeInTheDocument()

    const deselectedId = filteredIds[0]
    await user.click(screen.getAllByRole('checkbox', { name: 'Select transaction for Pizza Hut' })[0])

    expect(selectAll).toBePartiallyChecked()
    expect(screen.getByText(`${filteredIds.length - 1} selected`)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^Edit$/ }))
    await user.click(screen.getByLabelText('Category'))
    await user.click((await screen.findAllByRole('button', { name: /groceries/i })).at(-1)!)
    await user.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(bulkUpdateIds).toEqual([filteredIds.filter((id) => id !== deselectedId)]))
  })
})
