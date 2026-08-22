import type { Connection } from '../../types/graphql'

export function connectionLabel(connection?: Connection | null, fallback = 'Institution') {
  if (connection?.name) return connection.name
  if (connection?.provider?.__typename === 'EVMWallet') return 'Crypto wallet'
  return fallback
}

export function connectionNameForPlaidItem(itemID: string, connections: Connection[]) {
  const connection = connections.find((candidate) => candidate.provider?.__typename === 'PlaidItem' && candidate.provider.id === itemID)
  return connectionLabel(connection)
}
