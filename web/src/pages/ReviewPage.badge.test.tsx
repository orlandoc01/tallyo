import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { categories, normalizeTransactionForGraphql, transactions } from '../mocks/fixtures'
import { absoluteRoutePath, REVIEW_PATHS } from '../routes'
import { graphql, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { captureMutation } from '../test/msw'
import { renderWithProviders } from '../test/renderWithProviders'
import { transactionConnection } from '../test/transactionConnection'
import { ReviewPage } from './ReviewPage'
import { Route, Routes } from 'react-router'

vi.mock('../hooks/usePermissions', async () => (await import('../test/permissions')).allowAllPermissions())

describe('ReviewPage badges', () => {
  it('drops the transactions badge after approving an older row', async () => {
    const user = userEvent.setup()
    const newest = { ...normalizeTransactionForGraphql(transactions[0]), id: 'txn-newest', merchantName: 'Whole Foods', category: categories[0], isReviewed: false }
    const older = { ...newest, id: 'txn-older', merchantName: 'Pizza Hut', datetime: '2026-05-01T12:00:00Z' }
    let approved = false
    server.use(graphql.link('/query').query('Transactions', ({ variables }) => {
      const rows = approved ? [newest] : [newest, older]
      const first = (variables.input as { first?: number }).first ?? rows.length
      return HttpResponse.json({ data: { transactions: transactionConnection(rows.slice(0, first), {}, rows.length) } })
    }))
    const updateTransaction = captureMutation('UpdateTransaction', {
      updateTransaction: { __typename: 'UpdateTransactionPayload', transaction: normalizeTransactionForGraphql({ ...older, isReviewed: true }) },
    })

    renderWithProviders(
      <Routes>
        {REVIEW_PATHS.map((path) => <Route element={<ReviewPage />} key={path} path={absoluteRoutePath(path)} />)}
      </Routes>,
      { auth: { disableTransactionTracking: false, disableWealthTracking: false, hideOwners: false }, initialEntries: ['/review/transactions'], withGraphql: true },
    )

    expect((await screen.findByRole('tab', { name: /^Transactions/ })).textContent).toBe('Transactions2')

    approved = true
    await user.click((await screen.findAllByRole('button', { name: 'Approve' }))[1])

    await waitFor(() => expect(updateTransaction.variables).toEqual({ input: { id: 'txn-older', updates: { categoryId: categories[0].id } } }))
    await waitFor(() => expect(screen.getByRole('tab', { name: /^Transactions/ }).textContent).toBe('Transactions1'))
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(2)
  })
})
