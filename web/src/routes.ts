export const NET_WORTH_PATHS = [
  'net-worth',
  'net-worth/accounts/:account_id',
  'net-worth/accounts/:account_id/:account_tab',
  'net-worth/assets/:asset_id',
  'net-worth/assets/:asset_id/:asset_tab',
] as const

export const PORTFOLIO_PATHS = [
  'portfolio',
  'portfolio/assets/:asset_id',
  'portfolio/assets/:asset_id/:asset_tab',
] as const

export const TRANSACTION_PATHS = ['transactions', 'transactions/:transaction_id'] as const

export const REVIEW_PATHS = [
  'review/:tab',
  'review/assets/:asset_id',
  'review/assets/:asset_id/:asset_tab',
] as const

export const ACCOUNTS_PATHS = [
  'accounts',
  'accounts/:account_id',
  'accounts/:account_id/:account_tab',
] as const

export const SETTINGS_PATHS = [
  'settings',
  'settings/:tab',
  'settings/assets/:asset_id',
  'settings/assets/:asset_id/:asset_tab',
  'settings/rules/:rule_id',
] as const

export const SETTINGS_ASSET_PATHS = [
  'settings/assets',
  'settings/assets/:asset_id',
  'settings/assets/:asset_id/:asset_tab',
] as const

export const SETTINGS_RULE_PATHS = ['settings/rules', 'settings/rules/:rule_id'] as const

export function absoluteRoutePath(path: string) {
  return `/${path}`
}
