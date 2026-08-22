import { act, renderHook, waitFor } from '@testing-library/react'
import { graphql, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { UPDATE_TRANSACTION_MUTATION } from '../graphql/mutations'
import { createGraphqlClient } from '../graphql/client'
import { allTransactions, categories, normalizeTransactionForGraphql } from '../mocks/fixtures'
import { server } from '../mocks/server'
import { mockMutation } from '../test/msw'
import { transactionConnection } from '../test/transactionConnection'
import { createProvidersWrapper } from '../test/renderWithProviders'
import { usePaginatedTransactions } from './useTransactions'

describe('usePaginatedTransactions', () => {
  it('usePaginatedTransactions loadMore is a no-op when no next page', async () => {
    const { result } = renderHook(
      () => usePaginatedTransactions(undefined, { field: 'DATE', direction: 'DESC' }, 50),
      { wrapper: createProvidersWrapper({ withGraphql: true }) },
    )
    await waitFor(() => expect(result.current.fetching).toBe(false))
    expect(result.current.hasNextPage).toBe(false)

    act(() => {
      result.current.loadMore()
    })

    expect(result.current.hasNextPage).toBe(false)
  })

  it('reexecuteQuery triggers a refetch', async () => {
    const { result } = renderHook(
      () => usePaginatedTransactions(undefined, { field: 'DATE', direction: 'DESC' }, 50),
      { wrapper: createProvidersWrapper({ withGraphql: true }) },
    )
    await waitFor(() => expect(result.current.fetching).toBe(false))

    act(() => {
      result.current.reexecuteQuery({ requestPolicy: 'network-only' })
    })

    await waitFor(() => expect(result.current.fetching).toBe(false))
    expect(result.current.transactions.length).toBeGreaterThan(0)
  })

  it('does not duplicate the current page when a paginated transaction is updated', async () => {
    const client = createGraphqlClient()
    const pageTransactions = allTransactions.slice(0, 4).map(normalizeTransactionForGraphql)
    const updatedTransaction = { ...pageTransactions[2], category: categories[1] }

    server.use(
      graphql.link('/query').query<Record<string, unknown>, { input?: { first?: number; after?: string | null } }>('Transactions', ({ variables }) => {
        const input = variables.input
        const first = input?.first ?? 2
        const afterIndex = input?.after ? Number(input.after.replace('cursor-', '')) : -1
        const startIndex = afterIndex + 1
        const items = pageTransactions.slice(startIndex, startIndex + first)
        const endIndex = startIndex + items.length - 1

        return HttpResponse.json({
          data: {
            transactions: transactionConnection(items, {
              hasNextPage: endIndex < pageTransactions.length - 1,
              hasPreviousPage: startIndex > 0,
            }, pageTransactions.length, startIndex),
          },
        })
      }),
    )
    mockMutation('UpdateTransaction', {
      updateTransaction: {
        __typename: 'UpdateTransactionPayload',
        transaction: updatedTransaction,
      },
    })

    const { result } = renderHook(
      () => usePaginatedTransactions(undefined, { field: 'DATE', direction: 'DESC' }, 2),
      { wrapper: createProvidersWrapper({ graphqlClient: client }) },
    )

    await waitFor(() => expect(result.current.transactions.map((transaction) => transaction.id)).toEqual(pageTransactions.slice(0, 2).map((transaction) => transaction.id)))

    act(() => {
      result.current.loadMore()
    })

    await waitFor(() => expect(result.current.transactions.map((transaction) => transaction.id)).toEqual(pageTransactions.map((transaction) => transaction.id)))

    await act(async () => {
      await client.mutation(UPDATE_TRANSACTION_MUTATION, { input: { id: updatedTransaction.id, updates: { categoryId: updatedTransaction.category.id } } }).toPromise()
    })

    await waitFor(() => {
      const ids = result.current.transactions.map((transaction) => transaction.id)
      expect(ids).toEqual(pageTransactions.map((transaction) => transaction.id))
      expect(ids.filter((id) => id === updatedTransaction.id)).toHaveLength(1)
    })
    expect(result.current.transactions.find((transaction) => transaction.id === updatedTransaction.id)?.category.id).toBe(categories[1].id)
    expect(result.current.totalCount).toBe(pageTransactions.length)
  })
})
