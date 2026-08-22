import {
  ACCOUNTS_QUERY,
  ACCOUNTS_WITH_LATEST_SNAPSHOT_QUERY,
  ACCOUNTS_WITH_LATEST_SNAPSHOT_SUMMARY_QUERY,
  CATEGORIES_QUERY,
  CATEGORY_GROUPS_QUERY,
  CONNECTIONS_QUERY,
  EVM_CHAINS_QUERY,
  OWNERS_QUERY,
  PLAID_CREDENTIALS_QUERY,
  PLAID_PFC2_CODES_QUERY,
  SIMPLE_FIN_ACCESS_TOKENS_QUERY,
  TAGS_QUERY,
} from '../graphql/queries'
import type { Account, Category, CategoryGroup, Connection, EVMChain, Owner, PlaidCredential, SimpleFinAccessToken, Tag } from '../types/graphql'
import { usePermissions } from './usePermissions'
import { emptyList, useEntityQuery, useListQuery } from './useListQuery'

interface UseAccountsOptions {
  includeLatestSnapshot?: boolean
}

// Snapshot Holding rows are read:holdings-gated on the server; requesting them
// from a session that lacks the scope surfaces an expected forbidden-field
// error on every account row. Fall back to the summary-only document (balance
// + date, no per-account Holding rows) instead of selecting a field the
// caller can't read.
export function useAccounts(options: UseAccountsOptions = {}) {
  const { canRead } = usePermissions()
  const query = !options.includeLatestSnapshot
    ? ACCOUNTS_QUERY
    : canRead('holdings') ? ACCOUNTS_WITH_LATEST_SNAPSHOT_QUERY : ACCOUNTS_WITH_LATEST_SNAPSHOT_SUMMARY_QUERY
  const { items: accounts, ...result } = useListQuery<Account>({ query }, 'accounts')
  return { ...result, accounts }
}

export function useOwners() {
  const { items: owners, ...result } = useListQuery<Owner>({ query: OWNERS_QUERY }, 'owners')
  return { ...result, owners }
}

export function useTags() {
  const { items: tags, ...result } = useListQuery<Tag>({ query: TAGS_QUERY }, 'tags')
  return { ...result, tags }
}

export function useEVMChains() {
  const { items: chains, ...result } = useListQuery<EVMChain>({ query: EVM_CHAINS_QUERY }, 'evmChains')
  return { ...result, chains }
}

export function usePlaidCredentials() {
  const { items: credentials, ...result } = useListQuery<PlaidCredential>({ query: PLAID_CREDENTIALS_QUERY }, 'plaidCredentials')
  return { ...result, credentials }
}

export function useSimpleFinAccessTokens(pause = false) {
  const { items: tokens, ...result } = useListQuery<SimpleFinAccessToken>({ query: SIMPLE_FIN_ACCESS_TOKENS_QUERY, pause }, 'simpleFinAccessTokens')
  return { ...result, tokens }
}

export function useCategories() {
  const { items: categories, ...result } = useListQuery<Category>({ query: CATEGORIES_QUERY }, 'categories')
  return { ...result, categories }
}

export function useCategoryGroups() {
  const { items: categoryGroups, ...result } = useListQuery<CategoryGroup>({ query: CATEGORY_GROUPS_QUERY }, 'categoryGroups')
  return { ...result, categoryGroups }
}

export function usePlaidPFC2Codes(pause = false) {
  const { data, ...result } = useEntityQuery<string[]>({ query: PLAID_PFC2_CODES_QUERY, pause }, 'plaidPFC2Codes')
  return { ...result, plaidPFC2Codes: data ?? emptyList<string>() }
}

export function useConnections(includeInactive = false, pause = false) {
  return useListQuery<Connection, { input: { includeInactive: boolean } }>({ query: CONNECTIONS_QUERY, variables: { input: { includeInactive } }, pause }, 'connections')
}
