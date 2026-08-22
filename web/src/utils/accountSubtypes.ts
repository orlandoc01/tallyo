import type { AccountType } from '../types/graphql'

/**
 * Valid Plaid account subtypes grouped by account type, sourced from the Plaid
 * account type schema (https://plaid.com/docs/api/accounts/#account-type-schema).
 *
 * Plaid assigns a subtype on sync, but a user may reassign it to any value valid
 * for the account's type. The backend validates submitted subtypes against the
 * same set.
 */
const ACCOUNT_SUBTYPES_BY_TYPE: Record<AccountType, readonly string[]> = {
  PROPERTY: [],
  CRYPTO_WALLET: [],
  DEPOSITORY: [
    'cash',
    'cash management',
    'cd',
    'checking',
    'ebt',
    'hsa',
    'limited purpose checking',
    'money market',
    'paypal',
    'prepaid',
    'savings',
  ],
  CREDIT: ['credit card', 'bank issued credit card', 'paypal credit card'],
  LOAN: [
    'auto',
    'business',
    'commercial',
    'construction',
    'consumer',
    'home equity',
    'line of credit',
    'loan',
    'mortgage',
    'overdraft',
    'student',
  ],
  INVESTMENT: [
    '529',
    '401a',
    '401k',
    '403B',
    '457b',
    'brokerage',
    'cash isa',
    'crypto exchange',
    'education savings account',
    'fhsa',
    'fixed annuity',
    'gic',
    'hra',
    'hsa',
    'ira',
    'isa',
    'keogh',
    'lif',
    'life insurance',
    'lira',
    'lrif',
    'lrsp',
    'mutual fund',
    'non custodial wallet',
    'non taxable brokerage account',
    'other annuity',
    'other insurance',
    'pension',
    'prif',
    'profit sharing plan',
    'qshr',
    'rdsp',
    'resp',
    'retirement',
    'rlif',
    'roth',
    'roth 401k',
    'roth 403B',
    'roth 457b',
    'roth pension',
    'roth profit sharing plan',
    'roth thrift savings plan',
    'rrif',
    'rrsp',
    'sarsep',
    'sep ira',
    'simple ira',
    'sipp',
    'stock plan',
    'tfsa',
    'thrift savings plan',
    'trust',
    'ugma',
    'utma',
    'variable annuity',
  ],
  OTHER: ['payroll', 'other'],
}

/** All account types in display order, for populating type selectors. */
export const ACCOUNT_TYPES: readonly AccountType[] = ['DEPOSITORY', 'CREDIT', 'LOAN', 'INVESTMENT', 'CRYPTO_WALLET', 'OTHER']

/** Title-cases an account type for display, e.g. `DEPOSITORY` → "Depository". */
export function formatAccountType(type: AccountType): string {
  if (type === 'CRYPTO_WALLET') return 'Crypto Wallet'
  return type.charAt(0) + type.slice(1).toLowerCase()
}

/**
 * Returns the subtype options valid for the given account type. Only subtypes
 * that belong to the type are offered, so a user cannot assign a mismatched
 * subtype (the backend enforces the same rule).
 */
export function subtypeOptions(type: AccountType): readonly string[] {
  return ACCOUNT_SUBTYPES_BY_TYPE[type]
}

/** Reports whether `subtype` is a valid Plaid subtype for the given account type. */
export function isValidSubtypeForType(type: AccountType, subtype: string): boolean {
  return ACCOUNT_SUBTYPES_BY_TYPE[type].includes(subtype)
}
