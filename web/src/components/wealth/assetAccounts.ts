import type { Account } from '../../types/graphql'

export function accountsHoldingAsset(accounts: Account[], assetId: string) {
  return accounts.filter((account) => account.latestSnapshot?.holdings?.some((holding) => holding.asset.id === assetId))
}
