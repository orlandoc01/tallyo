import { graphql, http, HttpResponse } from 'msw'
import {
  accounts,
  accountSnapshots,
  assets,
  balanceReviews,
  allTransactions,
  budgetReport,
  budgetReportHistory,
  categories,
  categoryGroups,
  rules,
  tags,
  connections,
  evmChains,
  owners,
  plaidCredentials,
  plaidItems,
  recurringCharges,
  simpleFinAccessTokens,
  transactions,
  transactionsSummary,
  analysisReportForInput,
  computeAssetLatestSnapshot,
  persistAccountSnapshot,
} from './fixtures'
import { cashFlowPeriodsForFilter, spendingReportForFilter, type ReportFilter } from './reportFixtures'
import type { Account, AccountSnapshot, AccountSnapshotInput, AccountSnapshotsInput, AddUserInput, AnalysisInput, Asset, AssetsInput, BudgetReportInput, BulkDeleteTransactionsInput, BulkUpdateTransactionsInput, CashFlowPeriod, ChangeAccountSnapshotInput, CopyBudgetsInput, CreateAssetInput, CreateCategoryGroupInput, CreateCategoryInput, CreateManualAccountInput, CreateOwnerInput, CreatePlaidCredentialInput, CreateRuleInput, CreateSimpleFinAccessTokenInput, CreateTransactionInput, Holding, LinkEVMWalletInput, MergeAssetInput, ReorderCategoriesInput, RulesInput, SetBudgetInput, SpendingByCategoryReport, TransactionsFilter, TransactionsInput, UpdateAccountInput, UpdateCategoryGroupInput, UpdateCategoryInput, UpdateConnectionInput, UpdatePlaidCredentialInput, UpdateRuleInput, UpdateTransactionInput, UpdateUserInput, User } from '../types/graphql'

const api = graphql.link('/query')

// Rule payload shared by the CreateRule and UpdateRule mutation handlers.
function ruleFromInput(input: CreateRuleInput | UpdateRuleInput, rule: { id: string; priority: number; createdAt: string }) {
  return {
    __typename: 'Rule',
    id: rule.id,
    merchantPattern: input.merchantPattern ?? null,
    originalPattern: input.originalPattern ?? null,
    merchantName: input.changes.merchantName ?? null,
    category: input.changes.categoryId ? categories.find((item) => item.id === input.changes.categoryId) ?? null : null,
    tags: input.changes.tagIds ? tags.filter((tag) => input.changes.tagIds?.includes(tag.id)) : [],
    shouldHide: input.changes.isHidden ?? null,
    shouldBeRecurring: input.changes.isRecurring ?? null,
    accounts: accounts.filter((account) => input.accountIds?.includes(account.id)),
    amountMin: input.amountMin ?? null,
    amountMax: input.amountMax ?? null,
    priority: rule.priority,
    createdAt: rule.createdAt,
  }
}
const disableAuthForStubApi = import.meta.env.VITE_STUB_API === 'true'
const createdAssets: Asset[] = []
const users: Array<Pick<User, '__typename' | 'id' | 'email' | 'role' | 'createdAt'>> = [
  { __typename: 'User', id: 'user-1', email: 'alice@example.com', role: 'WRITER', createdAt: '2026-01-15T00:00:00Z' },
  { __typename: 'User', id: 'user-2', email: 'admin@example.com', role: 'ADMIN', createdAt: '2026-01-01T00:00:00Z' },
]

function catalogAssets() {
  return [...assets, ...createdAssets]
}

function replaceCatalogAsset(asset: Asset) {
  const replaceIn = (items: Asset[]) => {
    const index = items.findIndex((item) => item.id === asset.id)
    if (index >= 0) items[index] = asset
  }
  replaceIn(assets)
  replaceIn(createdAssets)
}

function removeCatalogAsset(assetId: string) {
  const removeFrom = (items: Asset[]) => {
    const index = items.findIndex((item) => item.id === assetId)
    if (index >= 0) items.splice(index, 1)
  }
  removeFrom(assets)
  removeFrom(createdAssets)
}

function assetSourceKey(source: Asset['adapterSources'][number]) {
  return `${source.sourceAdapter}:${source.sourceId}`
}

function stubAccounts() {
  return accounts.map((account) => ({ ...account, hidden: false }))
}

// Shared by the Assets and AssetsWithLatestSnapshot operations — the fixture
// objects already carry the computed latestSnapshot, so both queries read the
// same filtered/sorted list regardless of which fields they select.
function filteredAssetsForInput(input?: AssetsInput) {
  const search = input?.search?.trim().toLowerCase() ?? ''
  return catalogAssets()
    .filter((asset) => input?.includeHistorical || createdAssets.some((created) => created.id === asset.id) || asset.latestSnapshot != null)
    .filter((asset) => !input?.assetType || asset.assetType === input.assetType)
    .filter((asset) => !search || asset.identifier.toLowerCase().includes(search) || (asset.name?.toLowerCase().includes(search) ?? false))
    .sort((a, b) => {
      if (!search) return 0
      return assetSearchScore(a, search) - assetSearchScore(b, search)
    })
}

function accountSnapshotCursor(snapshot: AccountSnapshot) {
  return snapshot.date
}

export function accountSnapshotsConnection(input: AccountSnapshotsInput) {
  const filtered = accountSnapshots
    .filter((snapshot) => snapshot.accountId === input.accountId)
    .sort((a, b) => b.date.localeCompare(a.date))
  const afterIndex = input.after ? filtered.findIndex((snapshot) => accountSnapshotCursor(snapshot) === input.after) : -1
  const start = afterIndex >= 0 ? afterIndex + 1 : 0
  const first = input.first ?? 20
  const page = filtered.slice(start, start + first)
  const edges = page.map((node) => ({ __typename: 'AccountSnapshotEdge' as const, node, cursor: accountSnapshotCursor(node) }))
  return {
    __typename: 'AccountSnapshotConnection' as const,
    edges,
    pageInfo: {
      __typename: 'PageInfo' as const,
      hasNextPage: start + first < filtered.length,
      hasPreviousPage: start > 0,
      startCursor: edges[0]?.cursor ?? null,
      endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
    },
    totalCount: filtered.length,
  }
}

function withTransactionTags<T extends { tags?: unknown[]; logoUrl?: string | null; account?: { lastSyncedAt?: string | null } }>(transaction: T) {
  return {
    ...transaction,
    logoUrl: transaction.logoUrl ?? null,
    tags: transaction.tags ?? [],
    account: transaction.account ? {
      ...transaction.account,
      lastSyncedAt: transaction.account.lastSyncedAt ?? null,
    } : transaction.account,
  }
}

function transactionsForInput(input?: TransactionsInput) {
  const filter = input?.filter
  const sort = input?.sort
  const search = filter?.search?.trim().toLowerCase()

  return allTransactions
    .filter((transaction) => !search || [
      transaction.merchantName,
      transaction.originalName,
      transaction.notes,
    ].some((value) => value?.toLowerCase().includes(search)))
    .filter((transaction) => !filter?.categoryIds?.length || filter.categoryIds.includes(transaction.category.id))
    .filter((transaction) => !filter?.accountIds?.length || filter.accountIds.includes(transaction.account.id))
    .filter((transaction) => !filter?.ownerIds?.length || filter.ownerIds.includes(transaction.account.owner.id))
    .filter((transaction) => !filter?.tagIds?.length || transaction.tags.some((tag) => filter.tagIds?.includes(tag.id)))
    .filter((transaction) => filter?.untagged === undefined || filter.untagged === (transaction.tags.length === 0))
    .filter((transaction) => !filter?.datetimeRange?.from || transaction.datetime >= filter.datetimeRange.from)
    .filter((transaction) => !filter?.datetimeRange?.to || transaction.datetime < filter.datetimeRange.to)
    .filter((transaction) => !filter?.merchantPrefix || transaction.merchantName?.toLowerCase().includes(filter.merchantPrefix.toLowerCase()))
    .filter((transaction) => !filter?.originalPrefix || transaction.originalName?.toLowerCase().includes(filter.originalPrefix.toLowerCase()))
    .filter((transaction) => filter?.amountMin == null || transaction.amount >= filter.amountMin)
    .filter((transaction) => filter?.amountMax == null || transaction.amount <= filter.amountMax)
    .filter((transaction) => filter?.exactAmount == null || transaction.amount === filter.exactAmount)
    .filter((transaction) => filter?.isHidden === undefined || transaction.isHidden === filter.isHidden)
    .filter((transaction) => filter?.isReviewed === undefined || transaction.isReviewed === filter.isReviewed)
    .filter((transaction) => filter?.isRecurring === undefined || transaction.isRecurring === filter.isRecurring)
    .filter((transaction) => filter?.isPending === undefined || transaction.pending === filter.isPending)
    .filter((transaction) => !filter?.excludeTransfers || transaction.category.kind !== 'TRANSFER')
    .filter((transaction) => !filter?.excludeIncome || transaction.category.kind !== 'INCOME')
    .sort((a, b) => {
      const direction = sort?.direction === 'ASC' ? 1 : -1
      const left = sort?.field === 'AMOUNT' ? a.amount : a.datetime
      const right = sort?.field === 'AMOUNT' ? b.amount : b.datetime

      if (left === right) return 0
      return left > right ? direction : -direction
    })
}

function transactionCursor(index: number) {
  return `cursor-${index}`
}

function startIndexAfter(cursor?: string | null) {
  const match = /^cursor-(\d+)$/.exec(cursor ?? '')
  return match ? Number(match[1]) + 1 : 0
}

function transactionPage(items: ReturnType<typeof transactionsForInput>, input?: TransactionsInput) {
  const start = startIndexAfter(input?.after)
  const end = Math.min(start + (input?.first ?? items.length), items.length)
  return {
    items: items.slice(start, end),
    pageInfo: {
      __typename: 'PageInfo',
      hasNextPage: end < items.length,
      hasPreviousPage: start > 0,
      startCursor: end > start ? transactionCursor(start) : null,
      endCursor: end > start ? transactionCursor(end - 1) : null,
    },
    start,
  }
}

function setupCompleteForStubApi() {
  if (!disableAuthForStubApi) return true
  return !window.location.pathname.startsWith('/setup')
}

export const configuration = {
  __typename: 'Configuration',
  configFilePath: '/config.yaml',
  dbPath: '/data/tallyo.db',
  port: '8080',
  syncOff: false,
  locale: { __typename: 'Locale', timezone: 'America/New_York' },
  general: { __typename: 'GeneralConfiguration', disableTransactionTracking: false, disableWealthTracking: false, hideOwners: false },
  authorization: {
    __typename: 'AuthorizationConfiguration',
    masterPassword: '********',
    disableAllAuth: false,
    oauthIssuerUrl: 'http://localhost:5173',
    frontendRedirectUris: ['http://localhost:5173/oauth/callback'],
    accessTokenLifetime: '15m0s',
    refreshTokenLifetime: '168h0m0s',
    devCorsAllowedOrigins: ['http://localhost:5173'],
  },
  llmCategorization: {
    __typename: 'LlmCategorizationConfiguration',
    enabled: true,
    provider: 'OLLAMA',
    allowedProviders: ['OLLAMA'],
    ollama: { __typename: 'OllamaProviderConfiguration', url: 'http://ollama:11434', model: 'llama3' },
  },
  googleAuthn: { __typename: 'GoogleAuthnConfiguration', enabled: true, googleClientId: 'stub-google-client', googleClientSecret: '********' },
  passKeyAuthn: { __typename: 'PassKeyAuthnConfiguration', enabled: true, webauthnRpId: 'localhost', webauthnRpName: 'Tallyo', webauthnRpOrigins: ['http://localhost:5173'] },
  emailCodeAuthn: { __typename: 'EmailCodeAuthnConfiguration', enabled: true, smtpHost: 'smtp.example.com', smtpPort: '587', smtpFrom: 'noreply@example.com', smtpUsername: 'stub-user', smtpPassword: '********' },
  mcp: { __typename: 'McpConfiguration', enabled: true, dynamicRedirectHosts: [] },
  security: { __typename: 'SecurityConfiguration', trustedProxyCidrs: [] },
}

// Add __typename to SpendingByCategoryReport and all nested types
function withSpendingTypenames(report: SpendingByCategoryReport) {
  return {
    __typename: 'SpendingByCategoryReport',
    ...report,
    periods: report.periods.map((p) => ({ __typename: 'SpendingAggregatePeriod', ...p })),
    categories: report.categories.map((c) => ({
      __typename: 'CategorySpendingAggregate',
      ...c,
      periods: c.periods.map((p) => ({ __typename: 'CategorySpendingPeriod', ...p })),
    })),
  }
}

// Add __typename to CashFlowReport and all nested types
function withCashFlowTypenames(periods: CashFlowPeriod[]) {
  return {
    __typename: 'CashFlowReport',
    periods: periods.map((period) => ({
      __typename: 'CashFlowPeriod',
      ...period,
      summary: { __typename: 'CashFlowSummary', ...period.summary },
      incomeByCategory: period.incomeByCategory.map((b) => ({ __typename: 'CashFlowBreakdown', ...b })),
      expensesByCategory: period.expensesByCategory.map((b) => ({ __typename: 'CashFlowBreakdown', ...b })),
    })),
  }
}

function assetSearchScore(asset: Asset, term: string) {
  const identifier = asset.identifier.toLowerCase()
  const name = asset.name?.toLowerCase() ?? ''
  if (identifier === term) return 0
  if (name === term) return 1
  if (identifier.startsWith(term)) return 2
  if (name.startsWith(term)) return 3

  const identifierIndex = identifier.indexOf(term)
  const nameIndex = name.indexOf(term)
  const matches = [identifierIndex, nameIndex].filter((index) => index >= 0)
  return matches.length ? 4 + Math.min(...matches) : Number.POSITIVE_INFINITY
}

// Add __typename to BudgetReport and all nested types
function withBudgetTypenames(report: typeof budgetReport) {
  return {
    __typename: 'BudgetReport',
    ...report,
    sections: report.sections.map((s) => ({
      __typename: 'BudgetSection',
      ...s,
      lines: s.lines.map((l) => ({ __typename: 'BudgetLine', ...l })),
    })),
  }
}

export const handlers = [
  http.get('/auth/config', () => HttpResponse.json({ master_password_status: 'ENABLED', email_auth_enabled: true, google_auth_enabled: true, webauthn_enabled: true, disable_all_auth: disableAuthForStubApi, setup_complete: setupCompleteForStubApi(), scopes: [] })),
  http.get('/auth/webauthn/credentials', () => HttpResponse.json([])),
  http.get('/healthz', () => new HttpResponse(null, { status: 204 })),
  api.query('Categories', () => HttpResponse.json({ data: { categories: { __typename: 'CategoryList', items: categories } } })),
  api.query('CategoryGroups', () => HttpResponse.json({ data: { categoryGroups: { __typename: 'CategoryGroupList', items: categoryGroups } } })),
  api.query('PlaidPFC2Codes', () => HttpResponse.json({ data: { plaidPFC2Codes: ['FOOD_AND_DRINK_GROCERIES', 'FOOD_AND_DRINK_RESTAURANT', 'FOOD_AND_DRINK_COFFEE'] } })),
  api.query('Owners', () => HttpResponse.json({ data: { owners: { __typename: 'OwnerList', items: owners } } })),
  api.query('Accounts', () => HttpResponse.json({ data: { accounts: { __typename: 'AccountList', items: stubAccounts() } } })),
  api.query('Assets', ({ variables }) => HttpResponse.json({ data: { assets: { __typename: 'AssetList', items: filteredAssetsForInput(variables.input as AssetsInput | undefined) } } })),
  api.query('AssetsWithLatestSnapshot', ({ variables }) => HttpResponse.json({ data: { assets: { __typename: 'AssetList', items: filteredAssetsForInput(variables.input as AssetsInput | undefined) } } })),
  api.query('BalanceReviews', () => HttpResponse.json({ data: { balanceSnapshotReviews: { __typename: 'BalanceSnapshotReviewList', items: balanceReviews } } })),
  api.query('AccountSnapshots', ({ variables }) => {
    const input = variables.input as AccountSnapshotsInput
    return HttpResponse.json({ data: { accountSnapshots: accountSnapshotsConnection(input) } })
  }),
  api.query('AccountSnapshot', ({ variables }) => {
    const input = variables.input as AccountSnapshotInput
    const snapshot = input.snapshotId
      ? accountSnapshots.find((item) => item.id === input.snapshotId)
      : input.date
        ? accountSnapshots.find((item) => item.accountId === input.accountId && item.date === input.date)
        : accountSnapshots.find((item) => item.accountId === input.accountId)
    return HttpResponse.json({ data: { accountSnapshot: snapshot ?? null } })
  }),
  api.query('Analysis', ({ variables }) => {
    const input = variables.input as AnalysisInput | undefined
    return HttpResponse.json({ data: { analysis: analysisReportForInput(input) } })
  }),
  api.query('Tags', () => HttpResponse.json({ data: { tags: { __typename: 'TagList', items: tags } } })),
  api.query('EVMChains', () => HttpResponse.json({ data: { evmChains: { __typename: 'EVMChainList', items: evmChains } } })),
  api.query('Account', ({ variables }) => HttpResponse.json({ data: { account: stubAccounts().find((account) => account.id === variables.id) ?? null } })),
  api.query('AssetQuote', ({ variables }) => HttpResponse.json({ data: { assetQuote: { __typename: 'AssetQuote', ticker: variables.ticker, priceUSD: 100, asOf: '2026-01-01T00:00:00Z' } } })),
  api.query('AssetLatestSnapshot', ({ variables }) => {
    const assetId = variables.assetId as string
    const asset = catalogAssets().find((item) => item.id === assetId)
    if (!asset) return HttpResponse.json({ data: { node: null } })
    return HttpResponse.json({ data: { node: { __typename: 'Asset', id: asset.id, latestSnapshot: computeAssetLatestSnapshot(assetId) } } })
  }),
  api.query('PlaidCredentials', () => HttpResponse.json({ data: { plaidCredentials: { __typename: 'PlaidCredentialList', items: plaidCredentials } } })),
  api.query('Configuration', () => HttpResponse.json({ data: { configuration } })),
  api.query('GeneralConfiguration', () => HttpResponse.json({ data: { generalConfiguration: configuration.general } })),
  api.query('InstanceTimezone', () => HttpResponse.json({ data: { instanceTimezone: configuration.locale.timezone } })),
  api.mutation('UpdateConfiguration', () => HttpResponse.json({ data: { updateConfiguration: { __typename: 'UpdateConfigurationPayload', configuration } } })),
  api.mutation('ResolveBalanceReview', () => HttpResponse.json({ data: { resolveBalanceReview: { __typename: 'ResolveBalanceReviewPayload', success: true } } })),
  api.mutation('ChangeAccountSnapshot', ({ variables }) => {
    const input = variables.input as ChangeAccountSnapshotInput
    const existing = accountSnapshots.find((item) => item.id === input.snapshotId) ?? accountSnapshots[0]
    const account = stubAccounts().find((item) => item.id === existing.accountId) ?? accounts[0]
    const holdings = input.holdings.map((holding) => {
      const current = existing.holdings?.find((item) => item.asset.id === holding.assetId)
      const asset = current?.asset ?? catalogAssets().find((item) => item.id === holding.assetId) ?? assets[0]
      return {
        __typename: 'Holding' as const,
        assetId: asset.id,
        asset: { ...asset, latestSnapshot: null },
        accountId: account.id,
        account: { ...account, latestSnapshot: null },
        quantity: holding.quantity === undefined ? current?.quantity ?? holding.valueUSD : holding.quantity,
        valueUSD: holding.valueUSD,
        manual: current?.manual ?? account.manual,
      }
    })
    const snapshot: AccountSnapshot = {
      ...existing,
      balanceUSD: holdings.reduce((sum, holding) => sum + holding.valueUSD, 0),
      flagged: false,
      holdings,
    }
    const persistedSnapshot = persistAccountSnapshot(snapshot)
    const updatedAccount = stubAccounts().find((item) => item.id === persistedSnapshot.accountId) ?? { ...account, latestSnapshot: persistedSnapshot }
    return HttpResponse.json({ data: { changeAccountSnapshot: { __typename: 'ChangeAccountSnapshotPayload', snapshot: persistedSnapshot, account: updatedAccount } } })
  }),
  api.query('PlaidItems', () => HttpResponse.json({ data: { plaidItems: { __typename: 'PlaidItemList', items: plaidItems } } })),
  api.query('SimpleFinAccessTokens', () => HttpResponse.json({ data: { simpleFinAccessTokens: { __typename: 'SimpleFinAccessTokenList', items: simpleFinAccessTokens } } })),
  api.query('Connections', () => HttpResponse.json({ data: { connections: { __typename: 'ConnectionList', items: connections } } })),
  api.query('Transactions', ({ variables }) => {
    const input = variables.input as TransactionsInput | undefined
    const filteredTransactions = transactionsForInput(input)

    return HttpResponse.json({
      data: {
        transactions: {
          __typename: 'TransactionConnection',
          edges: filteredTransactions.map((node, index) => ({ __typename: 'TransactionEdge', node: withTransactionTags(node), cursor: `cursor-${index}` })),
          pageInfo: {
            __typename: 'PageInfo',
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: filteredTransactions.length ? 'cursor-0' : null,
            endCursor: filteredTransactions.length ? `cursor-${filteredTransactions.length - 1}` : null,
          },
          totalCount: filteredTransactions.length,
        },
      },
    })
  }),
  api.query('TransactionsStagedForCategorization', () => HttpResponse.json({
    data: { transactionsStagedForCategorization: { __typename: 'TransactionsStagedForCategorization', count: 0 } },
  })),
  api.query('TransactionIds', ({ variables }) => {
    const input = variables.input as TransactionsInput | undefined
    const filteredTransactions = transactionsForInput(input)
    const page = transactionPage(filteredTransactions, input)

    return HttpResponse.json({
      data: {
        transactions: {
          __typename: 'TransactionConnection',
          edges: page.items.map((node, index) => ({
            __typename: 'TransactionEdge',
            node: { __typename: 'Transaction', id: node.id },
            cursor: transactionCursor(page.start + index),
          })),
          pageInfo: page.pageInfo,
          totalCount: filteredTransactions.length,
        },
      },
    })
  }),
  api.query('SpendingByCategory', ({ variables }) => {
    const report = spendingReportForFilter(variables.filter as ReportFilter | undefined)

    return HttpResponse.json({
      data: {
        spendingByCategory: withSpendingTypenames(report),
      },
    })
  }),
  api.query('SpendingTotals', () =>
    HttpResponse.json({
      data: {
        spendingByCategory: {
          __typename: 'SpendingByCategoryReport',
          totalAmount: 500,
          periods: [
            { __typename: 'SpendingAggregatePeriod', periodStart: '2026-05-01', totalAmount: 100 },
            { __typename: 'SpendingAggregatePeriod', periodStart: '2026-05-02', totalAmount: 200 },
            { __typename: 'SpendingAggregatePeriod', periodStart: '2026-05-03', totalAmount: 200 },
          ],
        },
      },
    }),
  ),
  api.query('RecurringCharges', () => HttpResponse.json({ data: { recurringCharges: { __typename: 'RecurringChargeList', items: recurringCharges.map((charge) => ({ ...charge, transactions: charge.transactions.map(withTransactionTags) })) } } })),
  api.query('Rules', ({ variables }) => {
    const input = variables.input as RulesInput | null | undefined
    const merchantPattern = input?.merchantPattern?.trim().toLowerCase() ?? ''
    const originalPattern = input?.originalPattern?.trim().toLowerCase() ?? ''
    const accountIds = input?.accountIds ?? []
    const filteredRules = rules
      .filter((rule) => !merchantPattern || (rule.merchantPattern ?? '').toLowerCase().includes(merchantPattern))
      .filter((rule) => !originalPattern || (rule.originalPattern ?? '').toLowerCase().includes(originalPattern))
      .filter((rule) => !accountIds.length || rule.accounts?.some((account) => accountIds.includes(account.id)))
      .filter((rule) => input?.amountMin == null || rule.amountMax == null || rule.amountMax >= input.amountMin)
      .filter((rule) => input?.amountMax == null || rule.amountMin == null || rule.amountMin <= input.amountMax)
    return HttpResponse.json({ data: { rules: { __typename: 'RuleList', items: filteredRules } } })
  }),
  api.query('Users', () =>
    HttpResponse.json({
      data: {
        users: {
          __typename: 'UserList',
          items: users,
        },
      },
    }),
  ),
  api.mutation('UpdateUser', ({ variables }) => {
    const input = variables.input as UpdateUserInput
    const user = users.find((item) => item.id === input.id) ?? users[0]
    return HttpResponse.json({ data: { updateUser: { __typename: 'UpdateUserPayload', user: { ...user, role: input.role } } } })
  }),
  api.mutation('AddUser', ({ variables }) => {
    const input = variables.input as AddUserInput & { role: NonNullable<AddUserInput['role']> }
    return HttpResponse.json({
      data: { addUser: { __typename: 'AddUserPayload', user: { __typename: 'User', id: 'user-new', email: input.email, role: input.role, createdAt: '2026-05-30T00:00:00Z' } } },
    })
  }),
  api.mutation('CreateInviteLink', () => {
    return HttpResponse.json({ data: { createInviteLink: { __typename: 'CreateInviteLinkPayload', url: 'https://spend.example/auth/email/magic?token=invite', expiresAt: '2026-06-15T12:15:00Z' } } })
  }),
  api.mutation('RemoveUser', () => {
    return HttpResponse.json({ data: { removeUser: { __typename: 'RemoveUserPayload', success: true } } })
  }),
  api.query('CashFlow', ({ variables }) => HttpResponse.json({ data: { cashFlow: withCashFlowTypenames(cashFlowPeriodsForFilter(variables.filter as ReportFilter | undefined)) } })),
  api.query('TransactionsSummary', ({ variables }) => {
    const matches = transactionsForInput({ filter: variables.filter as TransactionsFilter | undefined })
    const totalAmount = matches.reduce((sum, transaction) => sum + transaction.amount, 0)

    return HttpResponse.json({
      data: {
        transactionsSummary: {
          __typename: 'TransactionsSummary',
          ...transactionsSummary,
          totalCount: matches.length,
          totalAmount,
          averageAmount: matches.length ? totalAmount / matches.length : 0,
          largestAmount: matches.reduce((max, transaction) => Math.max(max, transaction.amount), 0),
        },
      },
    })
  }),
  api.mutation('UpdateTransaction', ({ variables }) => {
    const input = variables.input as UpdateTransactionInput
    const transaction = transactions.find((item) => item.id === input.id) ?? transactions[0]
    let category = transaction.category
    if (input.updates.categoryId !== undefined) {
      category = categories.find((item) => item.id === input.updates.categoryId) ?? transaction.category
    }

    const nextTags = input.updates.tagIds ? tags.filter((tag) => input.updates.tagIds?.includes(tag.id)) : transaction.tags ?? []

    return HttpResponse.json({
      data: { updateTransaction: { __typename: 'UpdateTransactionPayload', transaction: { ...transaction, ...input.updates, category, tags: nextTags } } },
    })
  }),
  api.mutation('ReprocessUncategorizedTransactions', () => HttpResponse.json({
    data: { reprocessUncategorizedTransactions: { __typename: 'ReprocessUncategorizedTransactionsPayload', stagedCount: 0 } },
  })),
  api.mutation('CreateTransaction', ({ variables }) => {
    const input = variables.input as CreateTransactionInput
    const account = accounts.find((item) => item.id === input.accountId) ?? accounts[0]
    const category = categories.find((item) => item.id === input.categoryId) ?? categories[0]
    const now = `${input.date}T12:00:00Z`

    return HttpResponse.json({
      data: {
        createTransaction: {
          __typename: 'CreateTransactionPayload',
          transaction: {
            __typename: 'Transaction',
            id: 'manual-test-transaction',
            account,
            amount: input.amount,
            datetime: now,
            postedDatetime: now,
            merchantName: input.merchantName ?? null,
            originalName: input.originalName ?? null,
            logoUrl: null,
            category,
            isRecurring: input.isRecurring ?? false,
            isReviewed: !!input.categoryId,
            notes: input.notes ?? null,
            plaidCategory: null,
            pending: false,
            isHidden: input.isHidden ?? false,
            tags: [],
            createdAt: now,
            updatedAt: now,
          },
        },
      },
    })
  }),
  api.mutation('DeleteTransaction', () => HttpResponse.json({ data: { deleteTransaction: { __typename: 'DeleteTransactionPayload', success: true } } })),
  api.mutation('CreateRule', ({ variables }) => {
    const input = variables.input as CreateRuleInput
    return HttpResponse.json({
      data: {
        createRule: {
          __typename: 'CreateRulePayload',
          rule: ruleFromInput(input, { id: '8', priority: 10, createdAt: '2026-05-21T00:00:00Z' }),
        },
      },
    })
  }),
  api.mutation('UpdateRule', ({ variables }) => {
    const input = variables.input as UpdateRuleInput
    return HttpResponse.json({
      data: {
        updateRule: {
          __typename: 'UpdateRulePayload',
          rule: ruleFromInput(input, { id: input.id, priority: input.priority ?? 0, createdAt: '2026-05-01T00:00:00Z' }),
        },
      },
    })
  }),
  api.mutation('DeleteRule', () => HttpResponse.json({ data: { deleteRule: { __typename: 'DeleteRulePayload', success: true } } })),
  api.mutation('CreateLinkToken', () => HttpResponse.json({ data: { createLinkToken: { __typename: 'CreateLinkTokenPayload', linkToken: 'link-sandbox-token', expiration: '2026-05-21T12:00:00Z' } } })),
  api.mutation('CreateUpdateLinkToken', () => HttpResponse.json({ data: { createUpdateLinkToken: { __typename: 'CreateLinkTokenPayload', linkToken: 'link-update-token', expiration: '2026-05-21T12:00:00Z' } } })),
  api.mutation('ExchangePublicToken', () => HttpResponse.json({ data: { exchangePublicToken: { __typename: 'ExchangePublicTokenPayload', item: plaidItems[0], accounts: accounts.filter((account) => account.connection?.id === 'conn-1') } } })),
  api.mutation('CreateSimpleFinAccessToken', ({ variables }) => {
    const input = variables.input as CreateSimpleFinAccessTokenInput
    const owner = owners.find((item) => item.id === input.ownerId) ?? owners[0]
    const accessToken = { ...simpleFinAccessTokens[0], label: input.label ?? simpleFinAccessTokens[0].label, owner }
    return HttpResponse.json({ data: { createSimpleFinAccessToken: { __typename: 'CreateSimpleFinAccessTokenPayload', accessToken, connections: accessToken.connections, accounts: accessToken.connections.flatMap((connection) => connection.accounts) } } })
  }),
  api.mutation('DeleteSimpleFinAccessToken', () => HttpResponse.json({ data: { deleteSimpleFinAccessToken: true } })),
  api.mutation('ResetSimpleFinSync', () => HttpResponse.json({ data: { resetSimpleFinSync: simpleFinAccessTokens[0] } })),
  api.mutation('CompleteLinkUpdate', () => HttpResponse.json({ data: { completeLinkUpdate: { __typename: 'CompleteLinkUpdatePayload', item: { ...plaidItems[0], healthState: 'HEALTHY' } } } })),
  api.mutation('UpdateConnection', ({ variables }) => {
    const input = variables.input as UpdateConnectionInput
    const connection = connections.find((conn) => conn.id === input.connectionId) ?? connections[0]
    const provider = (() => {
      if (!connection.provider) return connection.provider

      switch (connection.provider.__typename) {
        case 'EVMWallet':
          return { ...connection.provider, chainIds: input.chainIds ?? connection.provider.chainIds }
        case 'PlaidItem':
          return {
            ...connection.provider,
            syncCron: input.syncCron ?? connection.provider.syncCron,
            recurringSyncCron: input.recurringSyncCron ?? connection.provider.recurringSyncCron,
            nextSyncAt: '2026-05-21T20:00:00Z',
            nextRecurringSyncAt: '2026-05-25T12:00:00Z',
          }
        default:
          return connection.provider
      }
    })()
    return HttpResponse.json({
      data: {
        updateConnection: {
          __typename: 'UpdateConnectionPayload',
          connection: {
            ...connection,
            isActive: input.isActive ?? connection.isActive,
            provider,
          },
        },
      },
    })
  }),
  api.mutation('DeleteConnection', () => HttpResponse.json({ data: { deleteConnection: { __typename: 'DeleteConnectionPayload', success: true } } })),
  api.mutation('UpdateAccount', ({ variables }) => {
    const input = variables.input as UpdateAccountInput
    const account = accounts.find((a) => a.id === input.id) ?? accounts[0]
    const updatedOwner = input.ownerId ? (owners.find((o) => o.id === input.ownerId) ?? account.owner) : account.owner
    const updatedAccount = {
      ...account,
      ...input,
      owner: updatedOwner,
      needsReview: input.type == null ? account.needsReview : false,
    }
    return HttpResponse.json({ data: { updateAccount: { __typename: 'UpdateAccountPayload', account: updatedAccount } } })
  }),
  api.mutation('RemoveManualAccount', () => HttpResponse.json({ data: { removeManualAccount: { __typename: 'RemoveManualAccountPayload', success: true } } })),
  api.mutation('CreateCategoryGroup', ({ variables }) => {
    const input = variables.input as CreateCategoryGroupInput
    const newGroup = { __typename: 'CategoryGroup', id: '99', name: input.name, emoji: input.emoji, kind: input.kind, categories: [] }
    return HttpResponse.json({ data: { createCategoryGroup: { __typename: 'CreateCategoryGroupPayload', group: newGroup } } })
  }),
  api.mutation('UpdateCategoryGroup', ({ variables }) => {
    const input = variables.input as UpdateCategoryGroupInput
    const group = categoryGroups.find((g) => g.id === input.id) ?? categoryGroups[0]
    return HttpResponse.json({ data: { updateCategoryGroup: { __typename: 'UpdateCategoryGroupPayload', group: { ...group, name: input.name, emoji: input.emoji } } } })
  }),
  api.mutation('DeleteCategoryGroup', () =>
    HttpResponse.json({ data: { deleteCategoryGroup: { __typename: 'DeleteCategoryGroupPayload', success: true } } }),
  ),
  api.mutation('CreateCategory', ({ variables }) => {
    const input = variables.input as CreateCategoryInput
    const group = categoryGroups.find((g) => g.id === input.groupId) ?? categoryGroups[0]
    const newCat = { __typename: 'Category', id: '100', name: input.name, emoji: input.emoji, groupName: group.name, groupEmoji: group.emoji, kind: group.kind, sortOrder: 100, plaidPFC2Codes: [] }
    return HttpResponse.json({ data: { createCategory: { __typename: 'CreateCategoryPayload', category: newCat } } })
  }),
  api.mutation('UpdateCategory', ({ variables }) => {
    const input = variables.input as UpdateCategoryInput
    const cat = categories.find((c) => c.id === input.id) ?? categories[0]
    return HttpResponse.json({ data: { updateCategory: { __typename: 'UpdateCategoryPayload', category: { ...cat, name: input.name, emoji: input.emoji, plaidPFC2Codes: input.plaidPFC2Codes ?? cat.plaidPFC2Codes } } } })
  }),
  api.mutation('DeleteCategory', () =>
    HttpResponse.json({ data: { deleteCategory: { __typename: 'DeleteCategoryPayload', success: true } } }),
  ),
  api.mutation('ReorderCategories', ({ variables }) => {
    const input = variables.input as ReorderCategoriesInput
    const group = categoryGroups.find((g) => g.id === input.groupId) ?? categoryGroups[0]
    return HttpResponse.json({ data: { reorderCategories: { __typename: 'ReorderCategoriesPayload', group } } })
  }),
  api.mutation('CreatePlaidCredential', ({ variables }) => {
    const input = variables.input as CreatePlaidCredentialInput
    return HttpResponse.json({ data: { createPlaidCredential: { __typename: 'CreatePlaidCredentialPayload', credential: { __typename: 'PlaidCredential', id: 99, clientId: input.clientId, environment: input.environment, label: input.label ?? null, itemCount: 0, createdAt: '2026-05-01T00:00:00Z' } } } })
  }),
  api.mutation('UpdatePlaidCredential', ({ variables }) => {
    const input = variables.input as UpdatePlaidCredentialInput
    const credential = plaidCredentials.find((item) => item.id === input.id) ?? plaidCredentials[0]
    return HttpResponse.json({ data: { updatePlaidCredential: { __typename: 'UpdatePlaidCredentialPayload', credential: { ...credential, environment: input.environment } } } })
  }),
  api.mutation('DeletePlaidCredential', () => HttpResponse.json({ data: { deletePlaidCredential: { __typename: 'DeletePlaidCredentialPayload', success: true } } })),
  api.mutation('CreateOwner', ({ variables }) => {
    const input = variables.input as CreateOwnerInput
    return HttpResponse.json({ data: { createOwner: { __typename: 'Owner', id: 'owner-new', name: input.name } } })
  }),
  api.mutation('DeleteOwner', () => HttpResponse.json({ data: { deleteOwner: true } })),
  api.mutation('CreateAsset', ({ variables }) => {
    const input = variables.input as CreateAssetInput
    const price = input.forcedUsdPrice ?? (input.assetType === 'CURRENCY' ? 1 : null)
    const asset: Asset = {
      __typename: 'Asset',
      id: `asset-created-${input.identifier.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      assetType: input.assetType,
      identifier: input.identifier,
      name: input.name ?? null,
      classifier: input.classifier,
      currentPrice: price,
      forcedUsdPrice: input.forcedUsdPrice ?? null,
      trackingTicker: input.trackingTicker ?? null,
      trackingMultiplier: input.trackingMultiplier ?? 1,
      priceConnectivity: 'HEALTHY',
      investmentConnectivity: 'HEALTHY',
      adapterSources: [],
      latestSnapshot: null,
      details: null,
    }
    createdAssets.push(asset)
    return HttpResponse.json({ data: { createAsset: { __typename: 'CreateAssetPayload', asset } } })
  }),
  api.mutation('MergeAsset', ({ variables }) => {
    const input = variables.input as MergeAssetInput
    const target = catalogAssets().find((item) => item.id === input.assetId) ?? assets[0]
    const duplicate = catalogAssets().find((item) => item.adapterSources.some((source) => (
      source.sourceAdapter === input.sourceAdapter && source.sourceId === input.sourceId
    )))
    if (!duplicate || duplicate.id === target.id) {
      return HttpResponse.json({ data: { mergeAsset: { __typename: 'MergeAssetPayload', asset: target } } })
    }

    const existingSourceKeys = new Set(target.adapterSources.map(assetSourceKey))
    const movedSources = duplicate.adapterSources.filter((source) => !existingSourceKeys.has(assetSourceKey(source)))
    const asset = { ...target, adapterSources: [...target.adapterSources, ...movedSources] }
    replaceCatalogAsset(asset)
    removeCatalogAsset(duplicate.id)
    for (const snapshot of accountSnapshots) {
      snapshot.holdings = snapshot.holdings?.map((holding) => (
        holding.asset?.id === duplicate.id || holding.asset?.id === target.id ? { ...holding, asset } : holding
      ))
    }
    return HttpResponse.json({ data: { mergeAsset: { __typename: 'MergeAssetPayload', asset } } })
  }),
  api.mutation('CreateManualAccount', ({ variables }) => {
    const input = variables.input as CreateManualAccountInput
    const newAccount = {
      ...accounts[0],
      id: `manual-${input.name.toLowerCase().replace(/\s+/g, '-')}`,
      connection: input.connectionId ? connections[0] : null,
      name: input.name,
      owner: owners.find((o) => o.id === input.ownerId) ?? owners[0],
      type: input.type,
      subtype: null,
      notes: input.notes ?? null,
      mask: null,
      closed: input.closed ?? false,
      hidden: input.hidden ?? false,
      manual: true,
    }
    return HttpResponse.json({ data: { createManualAccount: { __typename: 'CreateManualAccountPayload', account: newAccount } } })
  }),
  api.query('NetWorth', ({ variables }) => {
    const includeHoldings = Boolean((variables as { includeHoldings?: boolean }).includeHoldings)
    const cashAccount: Account = { ...accounts[0], latestSnapshot: { ...accountSnapshots[0], id: 'snapshot-cash', balanceUSD: 4500, netContributionUSD: 300 }, lastSyncedAt: '2026-05-21T10:00:00Z' }
    const taxAdvantagedInvestmentAccount: Account = { ...accounts[1], id: 'acct-invest-tax-advantaged', name: 'Roth 401k', type: 'INVESTMENT', subtype: 'roth 401k', latestSnapshot: { ...accountSnapshots[0], id: 'snapshot-tax-advantaged', accountId: 'acct-invest-tax-advantaged', balanceUSD: 12200, netContributionUSD: 950 }, closed: false, lastSyncedAt: '2026-05-21T10:00:00Z' }
    const investmentAccount: Account = { ...accounts[1], id: 'acct-invest-brokerage', name: 'Brokerage', type: 'INVESTMENT', subtype: 'brokerage', latestSnapshot: { ...accountSnapshots[0], id: 'snapshot-brokerage', accountId: 'acct-invest-brokerage', balanceUSD: 6000, netContributionUSD: 300 }, closed: false, lastSyncedAt: '2026-05-21T10:00:00Z' }
    const creditAccount: Account = { ...accounts[0], id: 'acct-credit', name: 'Credit Card', type: 'CREDIT', subtype: 'credit card', latestSnapshot: { ...accountSnapshots[0], id: 'snapshot-credit', accountId: 'acct-credit', balanceUSD: 1200, netContributionUSD: -150 }, lastSyncedAt: '2026-05-21T10:00:00Z' }
    const rollupHoldings = (asset: Asset, rows: Array<{ account: Account; quantity: number | null; valueUSD: number }>): Holding[] | null => (
      includeHoldings ? rows.map((row) => ({ __typename: 'Holding' as const, assetId: asset.id, asset, accountId: row.account.id, account: row.account, quantity: row.quantity, valueUSD: row.valueUSD, manual: false })) : null
    )

    return HttpResponse.json({
      data: {
        netWorth: {
          __typename: 'NetWorthReport',
          asOfDate: '2026-05-21',
          currentNetWorthUSD: 23000,
          currentAssetsUSD: 24200,
          currentLiabilitiesUSD: 1200,
          classifierBreakdown: [
            {
              __typename: 'ClassifierBreakdown',
              classifier: 'CASH',
              label: 'Cash',
              valueUSD: 4500,
              percentOfAssets: 19.82,
              assetCount: 1,
              holdings: [{ __typename: 'HoldingRollup', asset: assets[0], totalQuantity: 4500, valueUSD: 4500, holdings: rollupHoldings(assets[0], [{ account: cashAccount, quantity: 4500, valueUSD: 4500 }]) }],
            },
            {
              __typename: 'ClassifierBreakdown',
              classifier: 'PUBLIC',
              label: 'Public markets',
              valueUSD: 18200,
              percentOfAssets: 80.18,
              assetCount: 2,
              holdings: [{ __typename: 'HoldingRollup', asset: assets[1], totalQuantity: 66.06, valueUSD: 18200, holdings: rollupHoldings(assets[1], [{ account: taxAdvantagedInvestmentAccount, quantity: 44, valueUSD: 12200 }, { account: investmentAccount, quantity: 22.06, valueUSD: 6000 }]) }],
            },
            {
              __typename: 'ClassifierBreakdown',
              classifier: 'COMPANY_EQUITY',
              label: 'Company Equity',
              valueUSD: 1500,
              percentOfAssets: 6.61,
              assetCount: 1,
              holdings: [{ __typename: 'HoldingRollup', asset: assets[4], totalQuantity: 10, valueUSD: 1500, holdings: rollupHoldings(assets[4], [{ account: investmentAccount, quantity: 10, valueUSD: 1500 }]) }],
            },
          ],
          liabilityBreakdown: [
            {
              __typename: 'LiabilityBreakdown',
              category: 'CARD',
              label: 'Cards',
              valueUSD: 1200,
              percentOfLiabilities: 100,
              accountCount: 1,
              accounts: [creditAccount],
            },
          ],
        },
      },
    })
  }),
  api.query('HistoricalNetWorth', () => {
    return HttpResponse.json({
      data: {
        historicalNetWorth: {
          __typename: 'HistoricalNetWorthReport',
          series: [
            { __typename: 'NetWorthPoint', date: '2026-01-01', totalAssetsUSD: 19000, totalLiabilitiesUSD: 1050, netWorthUSD: 17950 },
            { __typename: 'NetWorthPoint', date: '2026-02-01', totalAssetsUSD: 20100, totalLiabilitiesUSD: 1100, netWorthUSD: 19000 },
            { __typename: 'NetWorthPoint', date: '2026-03-01', totalAssetsUSD: 21000, totalLiabilitiesUSD: 1150, netWorthUSD: 19850 },
            { __typename: 'NetWorthPoint', date: '2026-04-01', totalAssetsUSD: 22000, totalLiabilitiesUSD: 1200, netWorthUSD: 20800 },
            { __typename: 'NetWorthPoint', date: '2026-05-01', totalAssetsUSD: 22700, totalLiabilitiesUSD: 1200, netWorthUSD: 21500 },
          ],
          classifierSeries: [
            { __typename: 'ClassifierHistoryPoint', date: '2026-01-01', classifier: 'CASH', label: 'Cash & Equivalents', valueUSD: 4200 },
            { __typename: 'ClassifierHistoryPoint', date: '2026-01-01', classifier: 'PUBLIC', label: 'Public Assets', valueUSD: 14800 },
            { __typename: 'ClassifierHistoryPoint', date: '2026-02-01', classifier: 'CASH', label: 'Cash & Equivalents', valueUSD: 4300 },
            { __typename: 'ClassifierHistoryPoint', date: '2026-02-01', classifier: 'PUBLIC', label: 'Public Assets', valueUSD: 15800 },
            { __typename: 'ClassifierHistoryPoint', date: '2026-03-01', classifier: 'CASH', label: 'Cash & Equivalents', valueUSD: 4350 },
            { __typename: 'ClassifierHistoryPoint', date: '2026-03-01', classifier: 'PUBLIC', label: 'Public Assets', valueUSD: 16650 },
            { __typename: 'ClassifierHistoryPoint', date: '2026-04-01', classifier: 'CASH', label: 'Cash & Equivalents', valueUSD: 4425 },
            { __typename: 'ClassifierHistoryPoint', date: '2026-04-01', classifier: 'PUBLIC', label: 'Public Assets', valueUSD: 17575 },
            { __typename: 'ClassifierHistoryPoint', date: '2026-05-01', classifier: 'CASH', label: 'Cash & Equivalents', valueUSD: 4500 },
            { __typename: 'ClassifierHistoryPoint', date: '2026-05-01', classifier: 'PUBLIC', label: 'Public Assets', valueUSD: 18200 },
          ],
          liabilitySeries: [
            { __typename: 'LiabilityHistoryPoint', date: '2026-01-01', category: 'CARD', label: 'Credit Card', valueUSD: -1050 },
            { __typename: 'LiabilityHistoryPoint', date: '2026-02-01', category: 'CARD', label: 'Credit Card', valueUSD: -1100 },
            { __typename: 'LiabilityHistoryPoint', date: '2026-03-01', category: 'CARD', label: 'Credit Card', valueUSD: -1150 },
            { __typename: 'LiabilityHistoryPoint', date: '2026-04-01', category: 'CARD', label: 'Credit Card', valueUSD: -1200 },
            { __typename: 'LiabilityHistoryPoint', date: '2026-05-01', category: 'CARD', label: 'Credit Card', valueUSD: -1200 },
          ],
        },
      },
    })
  }),
  api.mutation('BulkUpdateTransactions', ({ variables }) => {
    const input = variables.input as BulkUpdateTransactionsInput & { transactionIds: string[] }
    const category = input.updates.categoryId ? (categories.find((item) => item.id === input.updates.categoryId) ?? categories[0]) : undefined
    const nextTags = input.updates.tagIds ? tags.filter((tag) => input.updates.tagIds?.includes(tag.id)) : undefined
    const updatedTransactions = allTransactions
      .filter((transaction) => input.transactionIds.includes(transaction.id))
      .map((transaction) => ({ ...transaction, ...input.updates, category: category ?? transaction.category, tags: nextTags ?? transaction.tags, isReviewed: input.updates.categoryId ? true : transaction.isReviewed }))

    return HttpResponse.json({ data: { bulkUpdateTransactions: { __typename: 'BulkUpdateTransactionsPayload', updatedCount: updatedTransactions.length, transactions: updatedTransactions.map(withTransactionTags) } } })
  }),
  api.mutation('BulkDeleteTransactions', ({ variables }) => {
    // Older tests still send `ids`; production uses the generated `transactionIds` field.
    const input = variables.input as BulkDeleteTransactionsInput & { ids?: string[] }
    return HttpResponse.json({ data: { bulkDeleteTransactions: { __typename: 'BulkDeleteTransactionsPayload', deletedCount: (input.ids ?? input.transactionIds ?? []).length } } })
  }),
  api.mutation('LinkEVMWallet', ({ variables }) => {
    const input = variables.input as LinkEVMWalletInput
    const owner = owners.find((item) => item.id === input.ownerId) ?? owners[0]
    const account = { ...accounts[0], id: `evm-${input.address.toLowerCase()}`, connection: { __typename: 'Connection', id: 'conn-evm', isActive: true, provider: { __typename: 'EVMWallet', address: input.address, chainIds: input.chainIds } }, owner, name: 'EVM Wallet', type: 'CRYPTO_WALLET', subtype: null, mask: null, manual: false }

    return HttpResponse.json({ data: { linkEVMWallet: { __typename: 'LinkEVMWalletPayload', connection: account.connection, account } } })
  }),
  api.query('BudgetReport', ({ variables }) => {
    const input = variables.input as BudgetReportInput
    return HttpResponse.json({ data: { budgetReport: withBudgetTypenames({ ...budgetReport, month: input?.month ?? budgetReport.month }) } })
  }),
  api.query('BudgetReportHistory', () => HttpResponse.json({
    data: {
      budgetReportHistory: {
        __typename: 'BudgetReportHistory',
        items: budgetReportHistory.items.map((item) => ({ __typename: 'BudgetReport', ...item })),
      },
    },
  })),
  api.query('BudgetReportHistoryWithSections', () => HttpResponse.json({
    data: {
      budgetReportHistory: {
        __typename: 'BudgetReportHistory',
        items: budgetReportHistory.items.map((item) => withBudgetTypenames({ ...budgetReport, ...item })),
      },
    },
  })),
  api.mutation('SetBudget', ({ variables }) => {
    const input = variables.input as SetBudgetInput
    const category = categories.find((c) => c.id === input.categoryId) ?? categories[0]
    return HttpResponse.json({
      data: {
        setBudget: {
          __typename: 'SetBudgetPayload',
          budget: { __typename: 'Budget', id: '1', month: input.month, amount: input.amount, category },
        },
      },
    })
  }),
  api.mutation('DeleteBudget', () => HttpResponse.json({ data: { deleteBudget: { __typename: 'DeleteBudgetPayload', success: true } } })),
  api.mutation('CopyBudgets', ({ variables }) => {
    const input = variables.input as CopyBudgetsInput
    return HttpResponse.json({
      data: { copyBudgets: { __typename: 'CopyBudgetsPayload', copiedCount: input.fromMonth === input.toMonth ? 0 : 2 } },
    })
  }),
  http.get('/transactions/export', () => new HttpResponse('account_id,date,amount,merchant_name\nacct-1,2026-05-14,62.30,Target\n', {
    headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="transactions.csv"' },
  })),
  http.post('/transactions/import', () => HttpResponse.json({ processed: 2, skipped: 0, errors: [] })),
]
