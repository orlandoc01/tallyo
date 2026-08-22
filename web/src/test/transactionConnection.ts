import type { PageInfo, Transaction } from '../types/graphql'

type TransactionNode = Pick<Transaction, '__typename' | 'id'>

export function transactionConnection<T extends TransactionNode>(nodes: T[], overrides: Partial<PageInfo> = {}, totalCount = nodes.length, cursorOffset = 0) {
  const cursor = (index: number) => `cursor-${cursorOffset + index}`
  return {
    __typename: 'TransactionConnection' as const,
    edges: nodes.map((node, index) => ({ __typename: 'TransactionEdge' as const, node, cursor: cursor(index) })),
    pageInfo: {
      __typename: 'PageInfo' as const,
      hasNextPage: false,
      hasPreviousPage: false,
      startCursor: nodes.length > 0 ? cursor(0) : null,
      endCursor: nodes.length > 0 ? cursor(nodes.length - 1) : null,
      ...overrides,
    },
    totalCount,
  }
}
