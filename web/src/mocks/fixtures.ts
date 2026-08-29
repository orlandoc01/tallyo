import type { Account, AccountSnapshot, AnalysisHolding, AnalysisInput, AnalysisReport, AnalysisView, Asset, AssetSnapshot, BalanceSnapshotReview, BudgetReport, BudgetReportHistory, CashFlowPeriod, Category, CategoryGroup, Configuration, Holding, Rule, Connection, Owner, PlaidCredential, PlaidItem, RecurringCharge, RecurringStreamStatus, SimpleFinAccessToken, SimpleFinConnection, Tag, Transaction, TransactionsSummary } from '../types/graphql'
import type { SpendingPeriod } from '../types/domain'
import { buildDemoData } from './demo/data'

const demoData = import.meta.env.MODE === 'demo' ? buildDemoData() : null
export const demoNetWorthReport = demoData?.netWorthReport ?? null
export const demoHistoricalNetWorthReport = demoData?.historicalNetWorthReport ?? null

export const uncategorizedCategory: Category = { __typename: 'Category', id: '0', name: 'uncategorized', emoji: '❓', groupName: 'Other', groupEmoji: '?', kind: 'EXPENSE', sortOrder: 2147483647, plaidPFC2Codes: [] }

export const categories: Category[] = [
  { __typename: 'Category', id: '1', name: 'Groceries', emoji: '🍏', groupName: 'Food', groupEmoji: '🍽️', kind: 'EXPENSE', sortOrder: 1, plaidPFC2Codes: ['FOOD_AND_DRINK_GROCERIES'] },
  { __typename: 'Category', id: '2', name: 'Restaurants & Bars', emoji: '🍽️', groupName: 'Food', groupEmoji: '🍽️', kind: 'EXPENSE', sortOrder: 2, plaidPFC2Codes: ['FOOD_AND_DRINK_RESTAURANT'] },
  { __typename: 'Category', id: '3', name: 'Interest', emoji: '🛰️', groupName: 'Income', groupEmoji: '💵', kind: 'INCOME', sortOrder: 3, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '4', name: 'Transfer', emoji: '↔️', groupName: 'Transfers', groupEmoji: '🔁', kind: 'TRANSFER', sortOrder: 4, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '5', name: 'Shopping', emoji: '🛍️', groupName: 'Lifestyle', groupEmoji: '✨', kind: 'EXPENSE', sortOrder: 5, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '6', name: 'Utilities', emoji: '💡', groupName: 'Home', groupEmoji: '🏠', kind: 'EXPENSE', sortOrder: 6, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '7', name: 'Transit', emoji: '🚇', groupName: 'Transport', groupEmoji: '🚗', kind: 'EXPENSE', sortOrder: 7, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '8', name: 'Pharmacy', emoji: '🩺', groupName: 'Health', groupEmoji: '🩺', kind: 'EXPENSE', sortOrder: 8, plaidPFC2Codes: [] },
  { __typename: 'Category', id: '9', name: 'Shopping Credits', emoji: '↩️', groupName: 'Lifestyle', groupEmoji: '✨', kind: 'EXPENSE', sortOrder: 9, plaidPFC2Codes: [] },
]

export const categoryGroups: CategoryGroup[] = [
  { __typename: 'CategoryGroup', id: '1', name: 'Food', emoji: '🍽️', kind: 'EXPENSE', categories: [categories[0], categories[1]] },
  { __typename: 'CategoryGroup', id: '2', name: 'Income', emoji: '💵', kind: 'INCOME', categories: [categories[2]] },
  { __typename: 'CategoryGroup', id: '3', name: 'Transfers', emoji: '🔁', kind: 'TRANSFER', categories: [categories[3]] },
  { __typename: 'CategoryGroup', id: '4', name: 'Lifestyle', emoji: '✨', kind: 'EXPENSE', categories: [categories[4], categories[8]] },
  { __typename: 'CategoryGroup', id: '5', name: 'Home', emoji: '🏠', kind: 'EXPENSE', categories: [categories[5]] },
  { __typename: 'CategoryGroup', id: '6', name: 'Transport', emoji: '🚗', kind: 'EXPENSE', categories: [categories[6]] },
  { __typename: 'CategoryGroup', id: '7', name: 'Health', emoji: '🩺', kind: 'EXPENSE', categories: [categories[7]] },
]

export const tags: Tag[] = [
  { __typename: 'Tag', id: 'tag-1', name: 'Work', color: '#3B82F6', transactionCount: 1 },
  { __typename: 'Tag', id: 'tag-2', name: 'Travel', color: '#22C55E', transactionCount: 0 },
]

export function normalizeAccountForGraphql(account: Account): Account {
  return {
    ...account,
    accountWealthProperty: account.accountWealthProperty ?? null,
    lastSyncedAt: account.lastSyncedAt ?? null,
  }
}

export function normalizeTransactionForGraphql(transaction: Transaction): Transaction {
  return {
    ...transaction,
    logoUrl: transaction.logoUrl ?? null,
    tags: transaction.tags ?? [],
    account: normalizeAccountForGraphql(transaction.account),
  }
}

export const owners: Owner[] = [
  { __typename: 'Owner', id: 'owner-1', name: 'alex' },
  { __typename: 'Owner', id: 'owner-2', name: 'sam' },
]

export const plaidCredentials: PlaidCredential[] = [
  {
    __typename: 'PlaidCredential',
    id: 1,
    clientId: 'client-primary',
    environment: 'DEVELOPMENT',
    label: 'Primary',
    itemCount: 4,
    createdAt: '2026-05-01T00:00:00Z',
  },
  {
    __typename: 'PlaidCredential',
    id: 2,
    clientId: 'client-overflow',
    environment: 'SANDBOX',
    label: 'Overflow',
    itemCount: 0,
    createdAt: '2026-05-01T00:00:00Z',
  },
]

export const configurationFixture: Configuration = {
  configFilePath: '/config.yaml',
  dbPath: '/data/tallyo.db',
  port: '8080',
  syncOff: false,
  locale: { timezone: 'America/New_York' },
  general: {
    disableTransactionTracking: false,
    disableWealthTracking: false,
    hideOwners: false,
  },
  authorization: {
    masterPassword: '********',
    disableAllAuth: false,
    oauthIssuerUrl: 'https://spend.example',
    frontendRedirectUris: ['https://spend.example/auth/callback'],
    accessTokenLifetime: '15m0s',
    refreshTokenLifetime: '168h0m0s',
    devCorsAllowedOrigins: ['http://localhost:5173'],
  },
  llmCategorization: {
    enabled: true,
    provider: 'OLLAMA',
    allowedProviders: ['OLLAMA'],
    ollama: { url: 'http://ollama:11434', model: 'llama3' },
  },
  googleAuthn: {
    enabled: true,
    googleClientId: 'google-client',
    googleClientSecret: '********',
  },
  passKeyAuthn: {
    enabled: true,
    webauthnRpId: 'spend.example',
    webauthnRpName: 'Tallyo',
    webauthnRpOrigins: ['https://spend.example'],
  },
  emailCodeAuthn: {
    enabled: true,
    smtpHost: 'smtp.example.com',
    smtpPort: '587',
    smtpFrom: 'noreply@example.com',
    smtpUsername: 'smtp-user',
    smtpPassword: '********',
  },
  mcp: {
    enabled: true,
    dynamicRedirectHosts: ['claude.ai'],
  },
  security: {
    trustedProxyCidrs: ['10.0.0.0/24'],
  },
}

export const assets: Asset[] = [
  { __typename: 'Asset', id: 'asset-usd', assetType: 'CURRENCY', identifier: 'USD', name: 'US Dollar', classifier: 'CASH', currentPrice: 1, forcedUsdPrice: null, trackingTicker: null, trackingMultiplier: 1, priceConnectivity: 'HEALTHY', investmentConnectivity: 'HEALTHY', adapterSources: [], latestSnapshot: null, details: null },
  { __typename: 'Asset', id: 'asset-vti', assetType: 'SECURITY', identifier: 'VTI', name: 'Vanguard Total Stock Market ETF', classifier: 'PUBLIC', currentPrice: 275.5, forcedUsdPrice: null, trackingTicker: null, trackingMultiplier: 1, priceConnectivity: 'NOT_FOUND', investmentConnectivity: 'HEALTHY', adapterSources: [{ __typename: 'AssetAdapterSource', sourceAdapter: 'PLAID', sourceId: 'sec-vti' }], latestSnapshot: null, details: null },
  { __typename: 'Asset', id: 'asset-eth', assetType: 'CRYPTO', identifier: 'ETH', name: 'Ethereum', classifier: 'CRYPTOCURRENCY', currentPrice: 3400, forcedUsdPrice: null, trackingTicker: null, trackingMultiplier: 1, priceConnectivity: 'HEALTHY', investmentConnectivity: 'HEALTHY', adapterSources: [{ __typename: 'AssetAdapterSource', sourceAdapter: 'DEBANK', sourceId: 'eth:eth' }], latestSnapshot: null, details: null },
  { __typename: 'Asset', id: 'asset-primary-home', assetType: 'REAL_ESTATE', identifier: 'home-primary', name: 'Primary Home', classifier: 'REAL_ESTATE', currentPrice: 1450000, forcedUsdPrice: 1450000, trackingTicker: null, trackingMultiplier: 1, priceConnectivity: 'HEALTHY', investmentConnectivity: 'HEALTHY', adapterSources: [], latestSnapshot: null, details: { __typename: 'RealEstateAssetDetails', address: { __typename: 'Address', street: '673 Guerrero St', city: 'San Francisco', state: 'CA', zip: '94110', homeType: null } } },
  { __typename: 'Asset', id: 'asset-equity', assetType: 'SECURITY', identifier: 'ACME', name: 'Acme Corp', classifier: 'COMPANY_EQUITY', currentPrice: 150, forcedUsdPrice: null, trackingTicker: null, trackingMultiplier: 1, priceConnectivity: 'HEALTHY', investmentConnectivity: 'HEALTHY', adapterSources: [], latestSnapshot: null, details: null },
  { __typename: 'Asset', id: 'asset-bnd', assetType: 'SECURITY', identifier: 'BND', name: 'Vanguard Total Bond Market ETF', classifier: 'PUBLIC', currentPrice: 72.18, forcedUsdPrice: null, trackingTicker: null, trackingMultiplier: 1, priceConnectivity: 'HEALTHY', investmentConnectivity: 'HEALTHY', adapterSources: [], latestSnapshot: null, details: null },
  { __typename: 'Asset', id: 'asset-qqq', assetType: 'SECURITY', identifier: 'QQQ', name: 'Invesco QQQ Trust', classifier: 'PUBLIC', currentPrice: 500, forcedUsdPrice: null, trackingTicker: null, trackingMultiplier: 1, priceConnectivity: 'HEALTHY', investmentConnectivity: 'HEALTHY', adapterSources: [], latestSnapshot: null, details: null },
  { __typename: 'Asset', id: 'asset-legacy', assetType: 'SECURITY', identifier: 'LEGACY', name: 'Legacy Holding', classifier: 'PUBLIC', currentPrice: 10, forcedUsdPrice: null, trackingTicker: null, trackingMultiplier: 1, priceConnectivity: 'HEALTHY', investmentConnectivity: 'HEALTHY', adapterSources: [], latestSnapshot: null, details: null },
  // A genuine custom tracker: an institution-only share class priced off a public proxy ticker.
  { __typename: 'Asset', id: 'asset-trust-vffvx', assetType: 'SECURITY', identifier: 'TrustII_VFFVX', name: '401k Target 2055 Trust', classifier: 'PUBLIC', currentPrice: 68.99, forcedUsdPrice: null, trackingTicker: 'VFFVX', trackingMultiplier: 1.5155, priceConnectivity: 'HEALTHY', investmentConnectivity: 'HEALTHY', adapterSources: [], latestSnapshot: null, details: null },
]

function holdingAccount(accountId: string): Account {
  return { __typename: 'Account', id: accountId, connection: null, owner: owners[0], name: '', type: 'DEPOSITORY', subtype: null, mask: null, notes: null, closed: false, hidden: false, needsReview: false, manual: false, typeLocked: false, accountWealthProperty: null, latestSnapshot: null, lastSyncedAt: null, createdAt: '2026-05-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z' }
}

function holding(accountId: string, asset: Asset, quantity: number | null, valueUSD: number, manual = false): Holding {
  return { __typename: 'Holding', assetId: asset.id, asset, accountId, account: holdingAccount(accountId), quantity, valueUSD, manual }
}

function snapshot(id: string, accountId: string, date: string, balanceUSD: number, holdings: Holding[], overrides: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return { __typename: 'AccountSnapshot', id, accountId, date, balanceUSD, netContributionUSD: balanceUSD, flagged: false, holdings, ...overrides }
}

export const accountSnapshots: AccountSnapshot[] = [
  snapshot('snapshot-1', 'acct-1', '2026-05-21', 1450, [holding('acct-1', assets[0], 450, 450), holding('acct-1', assets[1], 4, 1000)]),
  snapshot('snapshot-2', 'acct-1', '2026-05-20', 1200, [holding('acct-1', assets[0], 200, 200), holding('acct-1', assets[1], 4, 1000)], { flagged: true }),
  snapshot('snapshot-3', 'acct-1', '2026-05-19', 980, [holding('acct-1', assets[0], 180, 180), holding('acct-1', assets[1], 3.2, 800)], { netContributionUSD: 925 }),
  snapshot('snapshot-4', 'acct-1', '2026-05-17', 870, [holding('acct-1', assets[0], 170, 170), holding('acct-1', assets[1], 2.8, 700)]),
  snapshot('snapshot-5', 'acct-1', '2026-05-16', 820, [holding('acct-1', assets[0], 120, 120), holding('acct-1', assets[1], 2.8, 700)]),
  snapshot('snapshot-6', 'acct-1', '2026-05-15', 760, [holding('acct-1', assets[0], 160, 160), holding('acct-1', assets[1], 2.4, 600)]),
  snapshot('snapshot-7', 'acct-1', '2026-05-14', 700, [holding('acct-1', assets[0], 100, 100), holding('acct-1', assets[1], 2.4, 600)]),
  snapshot('snapshot-evm-wallet', 'acct-evm', '2026-05-21', 9000, [holding('acct-evm', assets[0], 500, 500), holding('acct-evm', assets[2], 2.5, 8500)]),
  snapshot('snapshot-real-estate', 'acct-real-estate', '2026-05-21', 1450000, [holding('acct-real-estate', assets[3], 1, 1450000, true)]),
  snapshot('snapshot-manual-equity', 'manual-company-equity', '2026-05-21', 1500, [holding('manual-company-equity', assets[4], 10, 1500, true)]),
  snapshot('snapshot-manual-loan', 'manual-loan', '2026-05-21', -18500, []),
]

const basePlaidItem: PlaidItem = {
  __typename: 'PlaidItem',
  id: 'item-1',
  credential: plaidCredentials[0],
  institutionId: 'ins_10',
  accounts: [],
  lastSyncedAt: '2026-05-21T10:00:00Z',
  healthState: 'LINK_UPDATE_REQUIRED',
  healthErrorCode: null,
  healthErrorMessage: null,
  healthUpdatedAt: '2026-05-21T10:00:00Z',
  syncCron: '0 6,18 * * *',
  recurringSyncCron: '0 12 * * 0',
  nextSyncAt: '2026-05-21T18:00:00Z',
  nextRecurringSyncAt: '2026-05-24T12:00:00Z',
  isActive: true,
  createdAt: '2026-05-01T00:00:00Z',
  updatedAt: '2026-05-21T10:00:00Z',
}

const connectionNames = ['American Express', 'Chase', 'Fidelity', 'Capital One']

function connection(id: string, name: string, owner: Owner, provider: Connection['provider']): Connection {
  return { __typename: 'Connection', id, name, owner, isActive: true, provider }
}

const connectionSummaries: Connection[] = connectionNames.map((name, index) => (
  connection(`conn-${index + 1}`, name, owners[index % owners.length], { ...basePlaidItem, id: `item-${index + 1}` })
))

type StubAccountSpec = Pick<Account, 'id' | 'name' | 'type' | 'subtype' | 'mask' | 'owner'> & Partial<Account>

const stubAccountSpecs: StubAccountSpec[] = [
  { id: 'acct-1', name: 'Checking', type: 'DEPOSITORY', subtype: 'checking', mask: '9625', owner: owners[0], notes: 'Primary household operating account with bill-pay autopay notes.' },
  { id: 'acct-2', name: 'Savings', type: 'DEPOSITORY', subtype: 'savings', mask: '1234', owner: owners[1], closed: true },
  { id: 'acct-3', name: 'Secret Fund', type: 'DEPOSITORY', subtype: 'checking', mask: '5678', owner: owners[0], hidden: true },
  { id: 'acct-4', name: 'Blue Cash Preferred', type: 'CREDIT', subtype: 'credit card', mask: '1004', owner: owners[0] },
  { id: 'acct-5', name: 'Gold Card', type: 'CREDIT', subtype: 'credit card', mask: '1005', owner: owners[1] },
  { id: 'acct-6', name: 'Everyday Checking', type: 'DEPOSITORY', subtype: 'checking', mask: '2006', owner: owners[0] },
  { id: 'acct-7', name: 'Vacation Savings', type: 'DEPOSITORY', subtype: 'savings', mask: '2007', owner: owners[1] },
  { id: 'acct-8', name: 'Freedom Unlimited', type: 'CREDIT', subtype: 'credit card', mask: '2008', owner: owners[0] },
  { id: 'acct-9', name: 'Amazon Prime Card', type: 'CREDIT', subtype: 'credit card', mask: '2009', owner: owners[1] },
  { id: 'acct-10', name: 'Home Projects', type: 'DEPOSITORY', subtype: 'savings', mask: '2010', owner: owners[0] },
  { id: 'acct-11', name: 'Brokerage', type: 'INVESTMENT', subtype: 'brokerage', mask: '3011', owner: owners[0] },
  { id: 'acct-12', name: 'Roth IRA', type: 'INVESTMENT', subtype: 'roth ira', mask: '3012', owner: owners[1] },
  { id: 'acct-13', name: '401k', type: 'INVESTMENT', subtype: '401k', mask: '3013', owner: owners[0] },
  { id: 'acct-14', name: 'HSA Investments', type: 'INVESTMENT', subtype: 'hsa', mask: '3014', owner: owners[1] },
  { id: 'acct-15', name: 'College Fund', type: 'INVESTMENT', subtype: '529', mask: '3015', owner: owners[0] },
  { id: 'acct-16', name: 'Quicksilver', type: 'CREDIT', subtype: 'credit card', mask: '4016', owner: owners[0] },
  { id: 'acct-17', name: 'Venture X', type: 'CREDIT', subtype: 'credit card', mask: '4017', owner: owners[1] },
  { id: 'acct-18', name: 'Performance Savings', type: 'DEPOSITORY', subtype: 'savings', mask: '4018', owner: owners[0] },
  { id: 'acct-19', name: 'Kids Savings', type: 'DEPOSITORY', subtype: 'savings', mask: '4019', owner: owners[1] },
  { id: 'acct-20', name: 'Auto Loan', type: 'LOAN', subtype: 'auto', mask: '4020', owner: owners[0] },
]

function stubAccount(spec: StubAccountSpec): Account {
  return {
    __typename: 'Account',
    connection: null,
    notes: null,
    lastSyncedAt: null,
    accountWealthProperty: null,
    closed: false,
    hidden: false,
    needsReview: false,
    manual: false,
    typeLocked: false,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-01T00:00:00Z',
    ...spec,
  }
}

// Accounts used inside plaidItems use shallow connection refs to avoid circular providers.
const plaidAccountGroups: Account[][] = connectionNames.map((_, index) => (
  stubAccountSpecs.slice(index * 5, index * 5 + 5).map((spec) => stubAccount({ ...spec, connection: connectionSummaries[index] }))
))

export const plaidItems: PlaidItem[] = plaidAccountGroups.map((group, index) => ({
  ...basePlaidItem,
  id: `item-${index + 1}`,
  institutionId: `ins_${index + 10}`,
  healthState: index === 0 ? 'LINK_UPDATE_REQUIRED' : 'HEALTHY',
  accounts: group,
}))

const simpleFinAccounts: Account[] = [
  stubAccount({
    id: 'sfin-acct-1',
    owner: owners[0],
    name: 'Mystery Account',
    type: 'CREDIT',
    subtype: null,
    mask: '1111',
    latestSnapshot: snapshot('snapshot-sfin-1', 'sfin-acct-1', '2026-05-21', 4321.09, []),
    lastSyncedAt: '2026-05-21T11:00:00Z',
    needsReview: true,
    createdAt: '2026-05-02T00:00:00Z',
    updatedAt: '2026-05-21T11:00:00Z',
  }),
]

const simpleFinAccessTokenRef: SimpleFinAccessToken = {
  __typename: 'SimpleFinAccessToken',
  id: '1',
  label: 'SimpleFIN Bridge',
  owner: owners[0],
  connections: [],
  syncCron: '0 6,18 * * *',
  lastSyncedAt: '2026-05-21T11:00:00Z',
  nextSyncAt: '2026-05-21T18:00:00Z',
  createdAt: '2026-05-02T00:00:00Z',
}

export const simpleFinConnections: SimpleFinConnection[] = [
  {
    __typename: 'SimpleFinConnection',
    id: 'sfin-conn-1',
    orgDomain: 'chase.com',
    orgUrl: 'https://www.chase.com',
    accounts: simpleFinAccounts,
    lastSyncedAt: '2026-05-21T11:00:00Z',
    createdAt: '2026-05-02T00:00:00Z',
    updatedAt: '2026-05-21T11:00:00Z',
  },
]

const simpleFinConnectionSummary = connection('conn-sfin-1', 'Chase Bank', owners[0], simpleFinConnections[0])

export const simpleFinAccessTokens: SimpleFinAccessToken[] = [
  { ...simpleFinAccessTokenRef, connections: simpleFinConnections },
]

export const evmChains = [
  { __typename: 'EVMChain', id: 'arb', name: 'Arbitrum' },
  { __typename: 'EVMChain', id: 'base', name: 'Base' },
  { __typename: 'EVMChain', id: 'eth', name: 'Ethereum' },
  { __typename: 'EVMChain', id: 'matic', name: 'Polygon' },
  { __typename: 'EVMChain', id: 'monad', name: 'Monad' },
  { __typename: 'EVMChain', id: 'op', name: 'Optimism' },
  { __typename: 'EVMChain', id: 'avax', name: 'Avalanche' },
]

const evmWallet = {
  __typename: 'EVMWallet' as const,
  address: '0x1234567890abcdef1234567890abcdef12345678',
  chainIds: ['arb', 'base', 'eth', 'matic', 'monad', 'op'],
}

const evmWalletConnection = connection('conn-evm', 'Main Wallet', owners[0], evmWallet)

const realEstateAccountConnection = {
  __typename: 'Connection' as const,
  id: 'conn-real-estate',
  name: 'Primary Home',
  owner: owners[0],
  isActive: true,
} as NonNullable<Account['connection']>

export const connections: Connection[] = [
  ...plaidItems.map<Connection>((item, index) => ({
    ...connectionSummaries[index],
    provider: item,
  })),
  simpleFinConnectionSummary,
  evmWalletConnection,
]

const accountConnection = connections[0]

// Root accounts exported for queries — these have their connection set
const portfolioAccounts: Account[] = [
  stubAccount({
    id: 'acct-brokerage',
    connection: accountConnection,
    owner: owners[0],
    name: 'Brokerage',
    type: 'INVESTMENT',
    subtype: 'brokerage',
    mask: '2042',
    latestSnapshot: snapshot('snapshot-brokerage', 'acct-brokerage', '2026-05-21', 13775, []),
    lastSyncedAt: '2026-05-21T10:00:00Z',
  }),
  stubAccount({
    id: 'acct-401k',
    connection: accountConnection,
    owner: owners[1],
    name: '401k',
    type: 'INVESTMENT',
    subtype: '401k',
    mask: '5505',
    latestSnapshot: snapshot('snapshot-401k', 'acct-401k', '2026-05-21', 8500, []),
    lastSyncedAt: '2026-05-21T10:00:00Z',
  }),
]

export const balanceReviews: BalanceSnapshotReview[] = [
  {
    __typename: 'BalanceSnapshotReview',
    id: 'balance-review-1',
    account: portfolioAccounts[0],
    firstFlaggedDate: '2026-06-14',
    latestFlaggedDate: '2026-06-19',
    flaggedSnapshotCount: 6,
    providerBalanceUSD: 71_987_143.66,
    carryForwardBalanceUSD: 110_108.92,
    flagReason: 'balance 110108.92->71987143.66 exceeds 10.0x deviation threshold',
    createdAt: '2026-06-19T16:00:00Z',
    updatedAt: '2026-06-19T16:00:00Z',
  },
]

const linkedAssetAccounts: Account[] = [
  stubAccount({
    id: 'acct-evm',
    connection: evmWalletConnection,
    owner: owners[0],
    name: 'Main Wallet',
    type: 'CRYPTO_WALLET',
    subtype: null,
    mask: null,
    notes: 'Stub EVM wallet account for account detail screenshots.',
    latestSnapshot: accountSnapshots.find((snapshot) => snapshot.accountId === 'acct-evm') ?? null,
    lastSyncedAt: '2026-05-21T10:00:00Z',
    typeLocked: true,
    updatedAt: '2026-05-21T10:00:00Z',
  }),
  stubAccount({
    id: 'acct-real-estate',
    connection: realEstateAccountConnection,
    owner: owners[0],
    name: 'Primary Home',
    type: 'PROPERTY',
    subtype: 'single family',
    mask: null,
    notes: 'Stub real estate account for account detail screenshots.',
    accountWealthProperty: { __typename: 'RealEstateAssetDetails', address: { __typename: 'Address', street: '673 Guerrero St', city: 'San Francisco', state: 'CA', zip: '94110', homeType: null } },
    latestSnapshot: accountSnapshots.find((snapshot) => snapshot.accountId === 'acct-real-estate') ?? null,
    typeLocked: true,
    updatedAt: '2026-05-21T10:00:00Z',
  }),
]

const manualAccounts: Account[] = [
  stubAccount({
    id: 'manual-company-equity',
    owner: owners[0],
    name: 'Acme Company Equity',
    type: 'INVESTMENT',
    subtype: 'manual investment',
    mask: null,
    notes: 'Manual equity companion account for snapshot editor tests.',
    latestSnapshot: accountSnapshots.find((snapshot) => snapshot.accountId === 'manual-company-equity') ?? null,
    manual: true,
    updatedAt: '2026-05-21T10:00:00Z',
  }),
  stubAccount({
    id: 'manual-loan',
    owner: owners[0],
    name: 'Manual Auto Loan',
    type: 'LOAN',
    subtype: 'manual loan',
    mask: null,
    notes: 'Stub manual loan account for dev UI checks.',
    latestSnapshot: accountSnapshots.find((snapshot) => snapshot.accountId === 'manual-loan') ?? null,
    manual: true,
    updatedAt: '2026-05-21T10:00:00Z',
  }),
]

const plaidAccountsWithConnections: Account[] = plaidAccountGroups.flatMap<Account>((group, index) => (
  group.map((acct) => ({
    ...acct,
    connection: connections[index],
    latestSnapshot: accountSnapshots.find((snapshot) => snapshot.accountId === acct.id) ?? null,
  }))
))

const simpleFinAccountsWithConnections: Account[] = simpleFinAccounts.map((account) => ({
  ...account,
  connection: simpleFinConnectionSummary,
}))

export const accounts: Account[] = [...plaidAccountsWithConnections, ...simpleFinAccountsWithConnections, ...linkedAssetAccounts, ...manualAccounts]

// Computed from the same per-account snapshots above, mirroring the server's
// current-position aggregation (hidden/closed accounts excluded). Each
// account ref has its own latestSnapshot nulled out so this doesn't build a
// circular Account/AssetSnapshot graph. Exported so the AssetLatestSnapshot
// MSW handler can recompute it fresh per request instead of reading a
// module-load-time snapshot that could go stale after a mutation.
export function computeAssetLatestSnapshot(assetId: string): AssetSnapshot | null {
  const rowsByAccountId = new Map<string, Holding>()
  let asOfDate = ''
  for (const account of accounts) {
    if (account.hidden || account.closed) continue
    const snap = account.latestSnapshot
    for (const row of snap?.holdings ?? []) {
      if (row.asset.id !== assetId) continue
      const existing = rowsByAccountId.get(account.id)
      rowsByAccountId.set(account.id, {
        __typename: 'Holding',
        assetId,
        asset: { ...row.asset, latestSnapshot: null },
        accountId: account.id,
        account: { ...account, latestSnapshot: null },
        quantity: existing ? sumQuantities(existing.quantity ?? null, row.quantity ?? null) : row.quantity ?? null,
        valueUSD: (existing?.valueUSD ?? 0) + row.valueUSD,
        manual: (existing?.manual ?? false) || row.manual,
      })
      if (snap && snap.date > asOfDate) asOfDate = snap.date
    }
  }
  const rows = [...rowsByAccountId.values()].sort((a, b) => b.valueUSD - a.valueUSD || a.accountId.localeCompare(b.accountId))
  if (rows.length === 0) return null
  const totalHeldValueUSD = rows.reduce((sum, row) => sum + row.valueUSD, 0)
  const totalHeldQuantity = rows.every((row) => row.quantity != null) ? rows.reduce((sum, row) => sum + (row.quantity ?? 0), 0) : null
  return { __typename: 'AssetSnapshot', asOfDate, totalHeldQuantity, totalHeldValueUSD, holdings: rows }
}

function sumQuantities(left: number | null, right: number | null) {
  return left == null || right == null ? null : left + right
}

function latestSnapshotForAccount(accountId: string) {
  return accountSnapshots
    .filter((snapshot) => snapshot.accountId === accountId)
    .sort((a, b) => b.date.localeCompare(a.date))[0] ?? null
}

function updateAccountLatestSnapshot(items: Account[], accountId: string, latestSnapshot: AccountSnapshot | null) {
  for (const account of items) {
    if (account.id === accountId) account.latestSnapshot = latestSnapshot
  }
}

function refreshAssetLatestSnapshots() {
  for (const asset of assets) {
    asset.latestSnapshot = computeAssetLatestSnapshot(asset.id)
  }
}

export function persistAccountSnapshot(snapshot: AccountSnapshot) {
  const index = accountSnapshots.findIndex((item) => item.id === snapshot.id)
  if (index >= 0) accountSnapshots[index] = snapshot
  else accountSnapshots.push(snapshot)

  const latestSnapshot = latestSnapshotForAccount(snapshot.accountId)
  updateAccountLatestSnapshot(accounts, snapshot.accountId, latestSnapshot)
  for (const item of plaidItems) updateAccountLatestSnapshot(item.accounts, snapshot.accountId, latestSnapshot)
  for (const connection of connections) {
    if (connection.provider?.__typename === 'PlaidItem' || connection.provider?.__typename === 'SimpleFinConnection') {
      updateAccountLatestSnapshot(connection.provider.accounts, snapshot.accountId, latestSnapshot)
    }
  }
  refreshAssetLatestSnapshots()
  return latestSnapshot ?? snapshot
}

refreshAssetLatestSnapshots()

// Pre-aggregation shape: account-bearing so account/owner/subtype filters can
// apply per the real server's SQL filtering, then grouped by asset ID (below)
// before producing GraphQL AnalysisHolding rows, which carry no account.
interface AnalysisHoldingFixture {
  asset: Asset
  account: Account
  valueUSD: number
}

const analysisHoldings: AnalysisHoldingFixture[] = [
  {
    asset: assets[1],
    account: stubAccount({ id: 'acct-brokerage', name: 'Brokerage', type: 'INVESTMENT', subtype: 'brokerage', mask: '0000', owner: owners[0] }),
    valueUSD: 13775,
  },
  {
    asset: assets[5],
    account: stubAccount({ id: 'acct-roth', name: 'Roth IRA', type: 'INVESTMENT', subtype: 'roth ira', mask: '0000', owner: owners[0] }),
    valueUSD: 6200,
  },
  {
    asset: assets[6],
    account: stubAccount({ id: 'acct-401k', name: '401k', type: 'INVESTMENT', subtype: '401k', mask: '0000', owner: owners[1] }),
    valueUSD: 8500,
  },
  // Same asset (VTI) as the brokerage holding above, in a different account —
  // exercises grouping by asset ID into one aggregated row.
  {
    asset: assets[1],
    account: stubAccount({ id: 'acct-ira', name: 'IRA', type: 'INVESTMENT', subtype: 'ira', mask: '0000', owner: owners[0] }),
    valueUSD: 4225,
  },
]

export function analysisReportForInput(input?: AnalysisInput): AnalysisReport {
  if (demoData) return demoData.analysisReportForInput(input)
  const view = input?.view ?? 'COMPOSITION'
  const filteredHoldings = analysisHoldings.filter((holding) => {
    if (input?.ownerIds?.length && !input.ownerIds.includes(holding.account.owner.id)) return false
    if (input?.accountSubtypes?.length && (!holding.account.subtype || !input.accountSubtypes.includes(holding.account.subtype))) return false
    if (input?.accountIds?.length && !input.accountIds.includes(holding.account.id)) return false
    return true
  })
  return analysisReportForHoldings(view, filteredHoldings)
}

export function analysisReportForView(view: AnalysisView): AnalysisReport {
  return analysisReportForHoldings(view, analysisHoldings)
}

function analysisReportForHoldings(view: AnalysisView, holdings: AnalysisHoldingFixture[]): AnalysisReport {
  const totalValueUSD = holdings.reduce((sum, holding) => sum + holding.valueUSD, 0)
  if (holdings.length === 0) {
    return { __typename: 'AnalysisReport', view, totalValueUSD, slices: [] }
  }

  if (view === 'MORNINGSTAR_CATEGORY') {
    return {
      __typename: 'AnalysisReport',
      view,
      totalValueUSD,
      slices: [
        analysisSlice('US Equity: Large Blend', holdings, totalValueUSD, 0.9),
        analysisSlice('Unassigned', holdings, totalValueUSD, 0.1),
      ],
    }
  }
  if (view === 'MORNINGSTAR_GROUP') {
    return {
      __typename: 'AnalysisReport',
      view,
      totalValueUSD,
      slices: [
        analysisSlice('US Equity', holdings, totalValueUSD, 0.9),
        analysisSlice('Unassigned', holdings, totalValueUSD, 0.1),
      ],
    }
  }
  if (view === 'SECTORS') {
    return {
      __typename: 'AnalysisReport',
      view,
      totalValueUSD,
      slices: [
        analysisSlice('Technology', holdings, totalValueUSD, 0.6),
        analysisSlice('Healthcare', holdings, totalValueUSD, 0.3),
        analysisSlice('Unassigned', holdings, totalValueUSD, 0.1),
      ],
    }
  }
  return {
    __typename: 'AnalysisReport',
    view,
    totalValueUSD,
    slices: [
      analysisSlice('Stock', holdings, totalValueUSD, 0.7),
      analysisSlice('Bond', holdings, totalValueUSD, 0.15),
      analysisSlice('Cash', holdings, totalValueUSD, 0.05),
      analysisSlice('Unassigned', holdings, totalValueUSD, 0.1),
    ],
  }
}

function analysisSlice(label: string, holdings: AnalysisHoldingFixture[], totalValueUSD: number, share = 1) {
  const valueUSD = totalValueUSD * share
  const byAssetId = new Map<string, { asset: Asset; valueUSD: number }>()
  for (const holding of holdings) {
    const scaledValueUSD = holding.valueUSD * share
    const existing = byAssetId.get(holding.asset.id)
    if (existing) {
      existing.valueUSD += scaledValueUSD
    } else {
      byAssetId.set(holding.asset.id, { asset: holding.asset, valueUSD: scaledValueUSD })
    }
  }
  return {
    __typename: 'AnalysisSlice' as const,
    label,
    valueUSD,
    percent: totalValueUSD ? (valueUSD / totalValueUSD) * 100 : 0,
    holdings: [...byAssetId.values()].map((entry): AnalysisHolding => ({
      __typename: 'AnalysisHolding',
      asset: entry.asset,
      valueUSD: entry.valueUSD,
      percent: valueUSD ? (entry.valueUSD / valueUSD) * 100 : 0,
    })),
  }
}

function transaction(fields: Pick<Transaction, 'id' | 'amount' | 'datetime' | 'merchantName' | 'originalName' | 'category'> & Partial<Transaction>): Transaction {
  return {
    __typename: 'Transaction',
    tags: [],
    account: accounts[0],
    postedDatetime: fields.datetime,
    isRecurring: false,
    isReviewed: true,
    notes: null,
    plaidCategory: null,
    pending: false,
    isHidden: false,
    createdAt: fields.datetime,
    updatedAt: fields.datetime,
    ...fields,
  }
}

export const transactions: Transaction[] = [
  transaction({ id: 'txn-1', amount: 62.3, datetime: '2026-05-14T00:00:00Z', merchantName: 'Target', originalName: 'TARGET STORE', category: categories[0] }),
  transaction({ id: 'txn-2', amount: -52.12, datetime: '2026-05-14T00:00:00Z', merchantName: 'Target', originalName: 'TARGET RETURN', category: categories[0], isHidden: true }),
  transaction({ id: 'txn-cloudflare', amount: 15.00, datetime: '2026-05-15T00:00:00Z', merchantName: 'Cloudflare', originalName: 'CLOUDFLARE', category: uncategorizedCategory, isReviewed: false }),
]

const aprilTransactions: Transaction[] = [
  transaction({ id: 'txn-04-income', amount: -3200, datetime: '2026-04-15T12:00:00Z', merchantName: 'Employer Direct Deposit', originalName: 'DIRECT DEP ACME CORP', category: categories[2], isRecurring: true }),
  transaction({ id: 'txn-04-restaurant-1', amount: 85, datetime: '2026-04-10T12:00:00Z', merchantName: 'Chipotle', originalName: 'CHIPOTLE #1234', category: categories[1] }),
  transaction({ id: 'txn-04-restaurant-2', amount: 80, datetime: '2026-04-22T12:00:00Z', merchantName: 'Shake Shack', originalName: 'SHAKE SHACK #567', category: categories[1] }),
  transaction({ id: 'txn-04-groceries', amount: 85, datetime: '2026-04-18T12:00:00Z', merchantName: "Trader Joe's", originalName: "TRADER JOE'S #88", category: categories[0] }),
]

const juneTransactions: Transaction[] = [
  transaction({ id: 'txn-06-income', amount: -3100, datetime: '2026-06-01T12:00:00Z', merchantName: 'Employer Direct Deposit', originalName: 'DIRECT DEP ACME CORP', category: categories[2], isRecurring: true }),
  transaction({ id: 'txn-06-restaurant-1', amount: 65, datetime: '2026-06-05T12:00:00Z', merchantName: 'Chipotle', originalName: 'CHIPOTLE #1234', category: categories[1] }),
  transaction({ id: 'txn-06-restaurant-2', amount: 45, datetime: '2026-06-12T12:00:00Z', merchantName: 'Pizza Hut', originalName: 'PIZZA HUT #999', category: categories[1] }),
  transaction({ id: 'txn-06-groceries', amount: 70, datetime: '2026-06-08T12:00:00Z', merchantName: 'Whole Foods', originalName: 'WHOLE FOODS MKT #42', category: categories[0] }),
]

export const allTransactions: Transaction[] = [...aprilTransactions, ...transactions, ...juneTransactions]

export const spendingPeriod: SpendingPeriod = {
  periodLabel: '2026-05',
  periodStart: '2026-05-01',
  periodEnd: '2026-05-31',
  total: 368.76,
  categories: [
    { category: categories[1], total: 150, transactionCount: 2, percentOfTotal: 40.68 },
    { category: categories[4], total: 84.25, transactionCount: 3, percentOfTotal: 22.85 },
    { category: categories[0], total: 62.3, transactionCount: 1, percentOfTotal: 16.9 },
    { category: categories[5], total: 46.1, transactionCount: 2, percentOfTotal: 12.5 },
    { category: categories[6], total: 32.4, transactionCount: 4, percentOfTotal: 8.79 },
    { category: categories[7], total: 18.7, transactionCount: 1, percentOfTotal: 5.07 },
    { category: categories[8], total: -24.99, transactionCount: 1, percentOfTotal: -6.78 },
  ],
}

export const recurringCharges: RecurringCharge[] = [
  {
    __typename: 'RecurringCharge',
    id: 'rc-1',
    merchantName: 'Netflix',
    estimatedAmount: 19.99,
    interval: 'MONTHLY',
    status: 'MATURE' as RecurringStreamStatus,
    isActive: true,
    category: categories[1],
    transactions,
    firstDate: '2026-05-10',
    lastDate: '2026-05-10',
    lastAmount: 19.99,
    isUserModified: false,
    nextExpectedDate: '2026-06-10',
  },
]

export const cashFlowPeriods: CashFlowPeriod[] = [
  {
    periodLabel: '2026-04',
    periodStart: '2026-04-01',
    periodEnd: '2026-04-30',
    summary: { income: 3200, expenses: 250, savings: 2950, savingsRate: 92.19 },
    incomeByCategory: [
      { category: categories[2], total: 3200, transactionCount: 1, percentOfTotal: 100 },
    ],
    expensesByCategory: [
      { category: categories[1], total: 165, transactionCount: 2, percentOfTotal: 66 },
      { category: categories[0], total: 85, transactionCount: 1, percentOfTotal: 34 },
    ],
  },
  {
    periodLabel: '2026-05',
    periodStart: '2026-05-01',
    periodEnd: '2026-05-31',
    summary: { income: 3000, expenses: 212.3, savings: 2787.7, savingsRate: 92.92 },
    incomeByCategory: [
      { category: categories[2], total: 3000, transactionCount: 1, percentOfTotal: 100 },
    ],
    expensesByCategory: [
      { category: categories[1], total: 150, transactionCount: 2, percentOfTotal: 70.65 },
      { category: categories[0], total: 62.3, transactionCount: 1, percentOfTotal: 29.35 },
    ],
  },
  {
    periodLabel: '2026-06',
    periodStart: '2026-06-01',
    periodEnd: '2026-06-30',
    summary: { income: 3100, expenses: 180, savings: 2920, savingsRate: 94.19 },
    incomeByCategory: [
      { category: categories[2], total: 3100, transactionCount: 1, percentOfTotal: 100 },
    ],
    expensesByCategory: [
      { category: categories[1], total: 110, transactionCount: 2, percentOfTotal: 61.11 },
      { category: categories[0], total: 70, transactionCount: 1, percentOfTotal: 38.89 },
    ],
  },
]

export const transactionsSummary: TransactionsSummary = {
  totalCount: 2,
  totalAmount: 10.18,
  averageAmount: 5.09,
  largestAmount: 62.3,
  firstDate: '2026-05-14',
  lastDate: '2026-05-14',
}

export const rules: Rule[] = [
  {
    __typename: 'Rule',
    id: '7',
    merchantPattern: 'Target',
    originalPattern: 'TARGET',
    merchantName: null,
    category: categories[0],
    tags: [],
    shouldHide: null,
    shouldBeRecurring: null,
    accounts: [accounts[0]],
    amountMin: null,
    amountMax: null,
    priority: 10,
    createdAt: '2026-05-01T00:00:00Z',
  },
]

export const budgetReport: BudgetReport = {
  month: '2026-06',
  expensesBudgeted: 780,
  expensesActual: 640,
  incomeBudgeted: 1600,
  incomeActual: 1680,
  remainingBudgeted: 820,
  remainingActual: 1040,
  sections: [
    {
      label: 'Income',
      group: categoryGroups.find((group) => group.kind === 'INCOME') ?? categoryGroups[0],
      budgeted: 1600,
      actual: 1680,
      remaining: 80,
      lines: [
        { id: 'income-1', category: categories.find((category) => category.kind === 'INCOME') ?? categories[0], budgeted: 1600, actual: 1680, remaining: 80 },
      ],
    },
    {
      label: 'Food',
      group: categoryGroups[0],
      budgeted: 780,
      actual: 640,
      remaining: 140,
      lines: [
        { id: '1', category: categories[0], budgeted: 460, actual: 390, remaining: 70 },
        { id: '2', category: categories[1], budgeted: 320, actual: 250, remaining: 70 },
      ],
    },
  ],
}

export const budgetReportHistory: BudgetReportHistory = {
  items: [
    {
      month: '2026-06',
      expensesBudgeted: 780,
      expensesActual: 640,
      incomeBudgeted: 1600,
      incomeActual: 1680,
      remainingBudgeted: 820,
      remainingActual: 1040,
      sections: budgetReport.sections,
    },
  ],
}

export function budgetReportForMonth(month: string) {
  return demoData?.budgetReportHistory.items.find((report) => report.month === month) ?? { ...budgetReport, month }
}

if (demoData) {
  categories.splice(0, categories.length, ...demoData.categories)
  categoryGroups.splice(0, categoryGroups.length, ...demoData.categoryGroups)
  tags.splice(0, tags.length, ...demoData.tags)
  owners.splice(0, owners.length, ...demoData.owners)
  plaidCredentials.splice(0, plaidCredentials.length, ...demoData.plaidCredentials)
  assets.splice(0, assets.length, ...demoData.assets)
  accountSnapshots.splice(0, accountSnapshots.length, ...demoData.accountSnapshots)
  plaidItems.splice(0, plaidItems.length, ...demoData.plaidItems)
  simpleFinAccessTokens.splice(0, simpleFinAccessTokens.length, ...demoData.simpleFinAccessTokens)
  connections.splice(0, connections.length, ...demoData.connections)
  accounts.splice(0, accounts.length, ...demoData.accounts)
  balanceReviews.splice(0, balanceReviews.length)
  transactions.splice(0, transactions.length, ...demoData.allTransactions)
  allTransactions.splice(0, allTransactions.length, ...demoData.allTransactions)
  recurringCharges.splice(0, recurringCharges.length, ...demoData.recurringCharges)
  rules.splice(0, rules.length, {
    __typename: 'Rule', id: 'demo-rule-1', merchantPattern: 'Trader Joe\'s', originalPattern: 'TRADER JOE', merchantName: null, category: demoData.categories.find((category) => category.id === '1')!, tags: [], shouldHide: null, shouldBeRecurring: null, accounts: [demoData.accounts.find((account) => account.id === 'demo-visa')!], amountMin: null, amountMax: null, priority: 10, createdAt: demoData.allTransactions[0].datetime,
  })
  Object.assign(budgetReport, demoData.budgetReport)
  budgetReportHistory.items.splice(0, budgetReportHistory.items.length, ...demoData.budgetReportHistory.items)
  Object.assign(transactionsSummary, {
    totalCount: demoData.allTransactions.length,
    totalAmount: demoData.allTransactions.reduce((sum, transaction) => sum + transaction.amount, 0),
    averageAmount: demoData.allTransactions.reduce((sum, transaction) => sum + transaction.amount, 0) / demoData.allTransactions.length,
    largestAmount: Math.max(...demoData.allTransactions.map((transaction) => transaction.amount)),
    firstDate: demoData.allTransactions.at(-1)?.datetime.slice(0, 10) ?? null,
    lastDate: demoData.allTransactions[0]?.datetime.slice(0, 10) ?? null,
  })
  refreshAssetLatestSnapshots()
}
