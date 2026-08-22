import type { Account, AccountType } from '../types/graphql'
import { subtypeOptions } from './accountSubtypes'

export type AccountGroupId = 'DEPOSITS' | 'TAX_ADVANTAGED' | 'INVESTMENTS' | 'REAL_ESTATE' | 'CRYPTO_WALLETS' | 'OTHER_ASSETS'

interface AccountGroupConfig {
  id: AccountGroupId
  accountType?: AccountType
  label: string
}

const TAX_ADVANTAGED_SUBTYPES = new Set([
  '529',
  '401a',
  '401k',
  '403b',
  '457b',
  'cash isa',
  'education savings account',
  'fhsa',
  'fixed annuity',
  'health reimbursement arrangement',
  'hra',
  'hsa',
  'ira',
  'isa',
  'keogh',
  'lif',
  'lira',
  'lrif',
  'lrsp',
  'pension',
  'prif',
  'rdsp',
  'resp',
  'retirement',
  'rlif',
  'roth',
  'roth 401k',
  'roth 403b',
  'roth 457b',
  'roth ira',
  'roth pension',
  'roth profit sharing plan',
  'roth thrift savings plan',
  'rrif',
  'rrsp',
  'sarsep',
  'sep ira',
  'simple ira',
  'sipp',
  'tfsa',
  'thrift savings plan',
  'ugma',
  'utma',
  'variable annuity',
  'other annuity',
])

export const ASSET_ACCOUNT_GROUPS: AccountGroupConfig[] = [
  { id: 'DEPOSITS', accountType: 'DEPOSITORY', label: 'Deposits' },
  { id: 'TAX_ADVANTAGED', accountType: 'INVESTMENT', label: 'Tax Advantaged' },
  { id: 'INVESTMENTS', accountType: 'INVESTMENT', label: 'Investments' },
  { id: 'REAL_ESTATE', accountType: 'PROPERTY', label: 'Real Estate' },
  { id: 'CRYPTO_WALLETS', accountType: 'CRYPTO_WALLET', label: 'Crypto Wallets' },
  { id: 'OTHER_ASSETS', accountType: 'OTHER', label: 'Other Assets' },
]

export function isTaxAdvantagedSubtype(subtype?: string | null): boolean {
  return TAX_ADVANTAGED_SUBTYPES.has(subtype?.trim().toLowerCase() ?? '')
}

export function isTaxAdvantagedAccount(account: Account): boolean {
  return isTaxAdvantagedSubtype(account.subtype)
}

export function subtypesForAccountGroupIds(groupIds: AccountGroupId[]): string[] {
  const subtypes = new Set<string>()
  for (const groupId of groupIds) {
    for (const subtype of subtypesForAccountGroupId(groupId)) {
      subtypes.add(subtype)
    }
  }
  return [...subtypes]
}

export function accountIdsForAccountGroupIds(accounts: Account[], groupIds: AccountGroupId[]): string[] {
  const selected = new Set(groupIds)
  return accounts
    .filter((account) => !account.hidden && ASSET_ACCOUNT_GROUPS.some((group) => selected.has(group.id) && accountMatchesAccountGroup(account, group.id)))
    .map((account) => account.id)
}

export function accountMatchesAccountGroup(account: Account, groupId: AccountGroupId): boolean {
  switch (groupId) {
    case 'DEPOSITS':
      return account.type === 'DEPOSITORY'
    case 'TAX_ADVANTAGED':
      return account.type === 'INVESTMENT' && isTaxAdvantagedAccount(account)
    case 'INVESTMENTS':
      return account.type === 'INVESTMENT' && !isTaxAdvantagedAccount(account)
    case 'REAL_ESTATE':
      return account.type === 'PROPERTY'
    case 'CRYPTO_WALLETS':
      return account.type === 'CRYPTO_WALLET'
    case 'OTHER_ASSETS':
      return account.type === 'OTHER'
  }
}

function subtypesForAccountGroupId(groupId: AccountGroupId): string[] {
  switch (groupId) {
    case 'DEPOSITS':
      return [...subtypeOptions('DEPOSITORY')]
    case 'TAX_ADVANTAGED':
      return [...TAX_ADVANTAGED_SUBTYPES]
    case 'INVESTMENTS':
      return subtypeOptions('INVESTMENT').filter((subtype) => !isTaxAdvantagedSubtype(subtype))
    case 'REAL_ESTATE':
      return [...subtypeOptions('PROPERTY')]
    case 'CRYPTO_WALLETS':
      return [...subtypeOptions('CRYPTO_WALLET')]
    case 'OTHER_ASSETS':
      return [...subtypeOptions('OTHER')]
  }
}
