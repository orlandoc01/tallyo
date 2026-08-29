import type { Asset, Category, CategoryGroup, Owner, Tag } from '../../types/graphql'

export const DAY = 86_400_000

export function mulberry32(seed: number) {
  return () => {
    let value = seed += 0x6d2b79f5
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296
  }
}

export function dateString(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function monthDate(today: Date, offset: number, day: number) {
  const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - offset, 1))
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), Math.min(day, lastDay, offset === 0 ? today.getUTCDate() : lastDay)))
}

export function money(amount: number) {
  return Math.round(amount * 100) / 100
}

export const owners: Owner[] = [
  { __typename: 'Owner', id: 'owner-jamie', name: 'Jamie Rivera' },
  { __typename: 'Owner', id: 'owner-taylor', name: 'Taylor Rivera' },
  { __typename: 'Owner', id: 'owner-morgan', name: 'Morgan Rivera' },
]

export const categories: Category[] = [
  { __typename: 'Category', id: '0', name: 'uncategorized', emoji: '❓', groupName: 'Other', groupEmoji: '❓', kind: 'EXPENSE', sortOrder: 99, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '1', name: 'Groceries', emoji: '🥦', groupName: 'Food', groupEmoji: '🍽️', kind: 'EXPENSE', sortOrder: 1, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '2', name: 'Restaurants', emoji: '🍜', groupName: 'Food', groupEmoji: '🍽️', kind: 'EXPENSE', sortOrder: 2, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '3', name: 'Paychecks', emoji: '💵', groupName: 'Income', groupEmoji: '💰', kind: 'INCOME', sortOrder: 1, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '4', name: 'Transfers', emoji: '🔁', groupName: 'Transfers', groupEmoji: '🔁', kind: 'TRANSFER', sortOrder: 1, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '5', name: 'Shopping', emoji: '🛍️', groupName: 'Lifestyle', groupEmoji: '🎉', kind: 'EXPENSE', sortOrder: 1, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '6', name: 'Utilities', emoji: '💡', groupName: 'Home', groupEmoji: '🏠', kind: 'EXPENSE', sortOrder: 1, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '7', name: 'Transit', emoji: '⛽', groupName: 'Transport', groupEmoji: '🚗', kind: 'EXPENSE', sortOrder: 1, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '8', name: 'Health & Fitness', emoji: '🏋️', groupName: 'Health', groupEmoji: '❤️', kind: 'EXPENSE', sortOrder: 1, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '9', name: 'Refunds', emoji: '↩️', groupName: 'Lifestyle', groupEmoji: '🎉', kind: 'EXPENSE', sortOrder: 2, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '10', name: 'Mortgage', emoji: '🏡', groupName: 'Home', groupEmoji: '🏠', kind: 'EXPENSE', sortOrder: 2, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '11', name: 'Insurance', emoji: '🛡️', groupName: 'Home', groupEmoji: '🏠', kind: 'EXPENSE', sortOrder: 3, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '12', name: 'Subscriptions', emoji: '📺', groupName: 'Lifestyle', groupEmoji: '🎉', kind: 'EXPENSE', sortOrder: 3, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '13', name: 'Travel', emoji: '✈️', groupName: 'Lifestyle', groupEmoji: '🎉', kind: 'EXPENSE', sortOrder: 4, plaidPFC2Codes: [] },
]

export const categoryGroups: CategoryGroup[] = ['Food', 'Income', 'Transfers', 'Lifestyle', 'Home', 'Transport', 'Health', 'Other'].map((name, index) => {
  const groupCategories = categories.filter((category) => category.groupName === name)
  return { __typename: 'CategoryGroup', id: `group-${index + 1}`, name, emoji: groupCategories[0]?.groupEmoji ?? '?', kind: groupCategories[0]?.kind ?? 'EXPENSE', categories: groupCategories }
})

export const tags: Tag[] = [
  { __typename: 'Tag', id: 'tag-home', name: 'Home', color: '#F97316', transactionCount: 0 },
  { __typename: 'Tag', id: 'tag-work', name: 'Work', color: '#3B82F6', transactionCount: 0 },
  { __typename: 'Tag', id: 'tag-travel', name: 'Travel', color: '#22C55E', transactionCount: 0 },
  { __typename: 'Tag', id: 'tag-family', name: 'Family', color: '#A855F7', transactionCount: 0 },
]

function asset(id: string, identifier: string, name: string, classifier: Asset['classifier'], price: number, assetType: Asset['assetType'] = 'SECURITY'): Asset {
  return { __typename: 'Asset', id, assetType, identifier, name, classifier, currentPrice: price, forcedUsdPrice: null, trackingTicker: null, trackingMultiplier: 1, priceConnectivity: 'HEALTHY', investmentConnectivity: 'HEALTHY', adapterSources: [], latestSnapshot: null, details: null }
}

export const assets: Asset[] = [
  asset('asset-usd', 'USD', 'US Dollar', 'CASH', 1, 'CURRENCY'),
  asset('asset-vti', 'VTI', 'Vanguard Total Stock Market ETF', 'PUBLIC', 282),
  asset('asset-vxus', 'VXUS', 'Vanguard Total International Stock ETF', 'PUBLIC', 67),
  asset('asset-bnd', 'BND', 'Vanguard Total Bond Market ETF', 'PUBLIC', 73),
  asset('asset-aapl', 'AAPL', 'Apple Inc.', 'PUBLIC', 230),
  asset('asset-msft', 'MSFT', 'Microsoft Corp.', 'PUBLIC', 420),
  asset('asset-btc', 'BTC', 'Bitcoin', 'CRYPTOCURRENCY', 104_000, 'CRYPTO'),
  asset('asset-eth', 'ETH', 'Ethereum', 'CRYPTOCURRENCY', 3_500, 'CRYPTO'),
  asset('asset-home', 'home-maple', '42 Maple Street', 'REAL_ESTATE', 640_000, 'REAL_ESTATE'),
]

export const classifierLabels: Record<Asset['classifier'], string> = { CASH: 'Cash', PUBLIC: 'Public markets', COMPANY_EQUITY: 'Company equity', CRYPTOCURRENCY: 'Crypto', STABLECOIN: 'Stablecoins', REAL_ESTATE: 'Real estate' }
