import type { Account, AccountSnapshot, AnalysisInput, AnalysisReport, AnalysisView, Asset, BudgetReport, BudgetReportHistory, Connection, HistoricalNetWorthReport, Holding, NetWorthReport, Owner, PlaidCredential, PlaidItem, RecurringCharge, SimpleFinAccessToken, SimpleFinConnection, Tag, Transaction } from '../../types/graphql'
import { assets, categories, categoryGroups, classifierLabels, dateString, DAY, money, monthDate, mulberry32, owners, tags } from './shared'

type DemoData = {
  accounts: Account[]
  accountSnapshots: AccountSnapshot[]
  allTransactions: Transaction[]
  analysisReportForInput: (input?: AnalysisInput) => AnalysisReport
  assets: Asset[]
  budgetReport: BudgetReport
  budgetReportHistory: BudgetReportHistory
  categories: typeof categories
  categoryGroups: typeof categoryGroups
  connections: Connection[]
  historicalNetWorthReport: HistoricalNetWorthReport
  netWorthReport: NetWorthReport
  owners: Owner[]
  plaidCredentials: PlaidCredential[]
  plaidItems: PlaidItem[]
  recurringCharges: RecurringCharge[]
  simpleFinAccessTokens: SimpleFinAccessToken[]
  tags: Tag[]
}

const accountSpecs: Array<[string, string, Account['type'], string, number]> = [
  ['demo-checking', 'Rivera Household Checking', 'DEPOSITORY', '4821', 0],
  ['demo-savings', 'Rainy Day Savings', 'DEPOSITORY', '9924', 0],
  ['demo-visa', 'Chase Sapphire Preferred', 'CREDIT', '1187', 0],
  ['demo-amex', 'Amex Blue Cash', 'CREDIT', '3104', 1],
  ['demo-brokerage', 'Fidelity Brokerage', 'INVESTMENT', '4410', 0],
  ['demo-401k', 'Taylor 401(k)', 'INVESTMENT', '7742', 1],
  ['demo-mortgage', 'Home Mortgage', 'LOAN', '6609', 0],
  ['demo-wallet', 'Family Crypto Wallet', 'CRYPTO_WALLET', '', 1],
  ['demo-home', '42 Maple Street', 'PROPERTY', '', 0],
]

export function buildDemoData(today = new Date()): DemoData {
  const now = new Date(today)
  const syncedAt = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()
  const credentials: PlaidCredential[] = [{ __typename: 'PlaidCredential', id: 101, clientId: 'demo-household', environment: 'DEVELOPMENT', label: 'Household connections', itemCount: 3, createdAt: new Date(now.getTime() - 400 * DAY).toISOString() }]
  const connectedAt = new Date(now.getTime() - 400 * DAY).toISOString()
  const connectionNames: Record<string, string> = { 'conn-chase': 'Chase', 'conn-fidelity': 'Fidelity', 'conn-simplefin': 'Capital One', 'conn-evm': 'Family Wallet' }
  const connectionIdFor = (id: string, type: Account['type']) => id === 'demo-amex' ? 'conn-simplefin' : id === 'demo-wallet' ? 'conn-evm' : type === 'INVESTMENT' ? 'conn-fidelity' : 'conn-chase'
  const accountConnection = (id: string, owner: Owner): Connection => ({ __typename: 'Connection', id, name: connectionNames[id], owner, isActive: true, provider: null })
  const accounts: Account[] = accountSpecs.map(([id, name, type, mask, ownerIndex]) => ({
    __typename: 'Account' as const, id, name, type, subtype: type === 'CREDIT' ? 'credit card' : type === 'LOAN' ? 'mortgage' : type === 'INVESTMENT' ? (id === 'demo-401k' ? '401k' : 'brokerage') : type === 'CRYPTO_WALLET' ? null : type === 'PROPERTY' ? 'single family' : type === 'DEPOSITORY' && name.includes('Savings') ? 'savings' : 'checking', mask: mask || null, owner: owners[ownerIndex], connection: type === 'PROPERTY' ? null : accountConnection(connectionIdFor(id, type), owners[ownerIndex]), notes: null, closed: false, hidden: false, needsReview: false, manual: type === 'PROPERTY', typeLocked: type === 'CRYPTO_WALLET', accountWealthProperty: null, latestSnapshot: null, lastSyncedAt: syncedAt, createdAt: connectedAt, updatedAt: syncedAt,
  }))
  const snapshots = buildSnapshots(accounts, now)
  for (const account of accounts) account.latestSnapshot = snapshots.find((snapshot) => snapshot.accountId === account.id && snapshot.date === dateString(now)) ?? null
  const transactions = buildTransactions(accounts, now)
  const updatedTags = tags.map((tag) => ({ ...tag, transactionCount: transactions.filter((transaction) => transaction.tags.some((item) => item.id === tag.id)).length }))
  transactions.forEach((transaction) => { transaction.tags = transaction.tags.map((tag) => updatedTags.find((item) => item.id === tag.id) ?? tag) })
  const reports = buildBudgetReports(transactions, now)
  const netWorthReports = netWorthReportsFor(accounts, snapshots)
  const plaidItem = plaidItemFor(accounts, credentials[0], syncedAt, connectedAt)
  const simpleFin = simpleFinFor(accounts, syncedAt, connectedAt)
  const connections: Connection[] = [
    { __typename: 'Connection', id: 'conn-chase', name: 'Chase', owner: owners[0], isActive: true, provider: plaidItem },
    { __typename: 'Connection', id: 'conn-fidelity', name: 'Fidelity', owner: owners[0], isActive: true, provider: { ...plaidItem, id: 'plaid-fidelity', accounts: accounts.filter((account) => account.connection?.id === 'conn-fidelity') } },
    { __typename: 'Connection', id: 'conn-simplefin', name: 'Capital One', owner: owners[1], isActive: true, provider: simpleFin.connections[0] },
    { __typename: 'Connection', id: 'conn-evm', name: 'Family Wallet', owner: owners[1], isActive: true, provider: { __typename: 'EVMWallet', address: '0x8f3a92c41b7e5d60a1f4e2b9c7d3a5e6f1b2c3d4', chainIds: ['eth', 'base', 'arb'] } },
  ]
  return { accounts, accountSnapshots: snapshots, allTransactions: transactions, analysisReportForInput: analysisReportFor(accounts), assets, budgetReport: reports[0], budgetReportHistory: { items: reports }, categories, categoryGroups, connections, historicalNetWorthReport: netWorthReports.history, netWorthReport: netWorthReports.current, owners, plaidCredentials: credentials, plaidItems: [plaidItem], recurringCharges: recurringChargesFor(transactions, now), simpleFinAccessTokens: [simpleFin], tags: updatedTags }
}

function buildSnapshots(accounts: Account[], today: Date) {
  return Array.from({ length: 24 }, (_, offset) => accounts.map((account) => snapshotFor(account, today, offset))).flat().sort((left, right) => right.date.localeCompare(left.date))
}

function snapshotFor(account: Account, today: Date, offset: number): AccountSnapshot {
  const date = offset === 0 ? dateString(today) : dateString(monthDate(today, offset, 28))
  const progress = 23 - offset
  const market = 1 + progress * 0.012 - (progress >= 10 && progress <= 12 ? 0.13 : 0)
  const balance = account.id === 'demo-checking' ? 4_100 + progress * 85 : account.id === 'demo-savings' ? 15_000 + progress * 410 : account.id === 'demo-visa' ? -(900 + ((progress * 313) % 1_600)) : account.id === 'demo-amex' ? -(700 + ((progress * 227) % 1_300)) : account.id === 'demo-mortgage' ? -(438_000 - progress * 1_250) : account.id === 'demo-wallet' ? money(0.09 * assets[6].currentPrice! * market + 1.8 * assets[7].currentPrice! * market) : account.id === 'demo-home' ? money(640_000 * (1 + progress * 0.004)) : account.id === 'demo-brokerage' ? money(52_000 * market) : money(83_000 * market)
  const holdings = holdingsFor(account, balance)
  return { __typename: 'AccountSnapshot', id: `snapshot-${account.id}-${date}`, accountId: account.id, date, balanceUSD: balance, netContributionUSD: balance, flagged: false, holdings }
}

function holdingsFor(account: Account, balance: number): Holding[] {
  const row = (asset: Asset, quantity: number, valueUSD: number): Holding => ({ __typename: 'Holding', assetId: asset.id, asset, accountId: account.id, account: { ...account, latestSnapshot: null }, quantity, valueUSD, manual: false })
  if (account.id === 'demo-brokerage') return [row(assets[1], balance / assets[1].currentPrice! * 0.6, balance * 0.6), row(assets[2], balance / assets[2].currentPrice! * 0.15, balance * 0.15), row(assets[3], balance / assets[3].currentPrice! * 0.15, balance * 0.15), row(assets[4], balance / assets[4].currentPrice! * 0.1, balance * 0.1)]
  if (account.id === 'demo-401k') return [row(assets[1], balance / assets[1].currentPrice! * 0.55, balance * 0.55), row(assets[3], balance / assets[3].currentPrice! * 0.3, balance * 0.3), row(assets[5], balance / assets[5].currentPrice! * 0.15, balance * 0.15)]
  if (account.id === 'demo-wallet') return [row(assets[6], 0.09, 0.09 * assets[6].currentPrice!), row(assets[7], 1.8, 1.8 * assets[7].currentPrice!)]
  if (account.id === 'demo-home') return [row(assets[8], 1, balance)]
  return account.type === 'DEPOSITORY' ? [row(assets[0], balance, balance)] : []
}

function buildTransactions(accounts: Account[], today: Date) {
  const random = mulberry32(0x5eed1234)
  const account = (id: string) => accounts.find((item) => item.id === id)!
  const category = (id: string) => categories.find((item) => item.id === id)!
  const tag = (id: string) => tags.find((item) => item.id === id)!
  const create = (monthOffset: number, index: number, day: number, amount: number, merchantName: string, categoryId: string, accountId: string, recurring = false, tagIds: string[] = []): Transaction => {
    const datetime = `${dateString(monthDate(today, monthOffset, day))}T12:00:00Z`
    const unreviewed = monthOffset === 0 && (index === 20 || index === 21)
    return { __typename: 'Transaction', id: `demo-txn-${monthOffset}-${index}`, account: account(accountId), amount: money(amount), datetime, postedDatetime: datetime, merchantName, originalName: merchantName.toUpperCase(), logoUrl: null, category: unreviewed ? category('0') : category(categoryId), isRecurring: recurring, isReviewed: !unreviewed, notes: null, plaidCategory: null, pending: monthOffset === 0 && index === 21, isHidden: monthOffset === 0 && index === 22, tags: tagIds.map(tag), createdAt: datetime, updatedAt: datetime }
  }
  return Array.from({ length: 12 }, (_, monthOffset) => {
    const variance = (amount: number, spread: number) => amount + (random() - 0.5) * spread
    const monthly = [
      create(monthOffset, 0, 1, -4_600, 'Acme Payroll', '3', 'demo-checking', true, ['tag-work']), create(monthOffset, 1, 15, -4_600, 'Acme Payroll', '3', 'demo-checking', true, ['tag-work']),
      create(monthOffset, 2, 2, 2_450, 'Northstar Mortgage', '10', 'demo-checking', true, ['tag-home']), create(monthOffset, 3, 3, -1_100, 'Transfer to Savings', '4', 'demo-checking', true), create(monthOffset, 4, 3, 1_100, 'Transfer from Checking', '4', 'demo-savings', true),
      create(monthOffset, 5, 5, variance(148, 25), 'Pacific Gas & Electric', '6', 'demo-checking', true, ['tag-home']), create(monthOffset, 6, 7, 82, 'T-Mobile', '6', 'demo-visa', true), create(monthOffset, 7, 8, 17.99, 'Netflix', '12', 'demo-amex', true), create(monthOffset, 8, 9, 55, 'City Gym', '8', 'demo-visa', true), create(monthOffset, 9, 10, 186, 'State Farm Insurance', '11', 'demo-checking', true, ['tag-home']),
      ...Array.from({ length: 4 }, (_, index) => create(monthOffset, 10 + index, 11 + index * 3, variance(112, 55), ['Trader Joe\'s', 'Whole Foods', 'Costco'][index % 3], '1', index % 2 ? 'demo-visa' : 'demo-amex', false, index === 2 ? ['tag-family'] : [])),
      ...Array.from({ length: 3 }, (_, index) => create(monthOffset, 14 + index, 12 + index * 5, variance(44, 28), ['Blue Bottle Coffee', 'Nopalito', 'Neighborhood Ramen'][index], '2', 'demo-visa')),
      create(monthOffset, 17, 18, variance(86, 45), 'Target', '5', 'demo-amex', false, ['tag-family']), create(monthOffset, 18, 20, variance(52, 22), 'Shell', '7', 'demo-visa'), create(monthOffset, 19, 23, variance(68, 35), 'Amazon', '5', 'demo-amex'),
      create(monthOffset, 20, 24, 29.95, 'Corner Market', '1', 'demo-visa'), create(monthOffset, 21, 25, 68.4, 'Unknown Merchant', '5', 'demo-amex'), create(monthOffset, 22, 26, -42.5, 'Target Return', '9', 'demo-amex'),
    ]
    if (monthOffset === 0) return [...monthly, create(monthOffset, 23, today.getUTCDate(), 14.75, 'Farmers Market', '1', 'demo-visa')]
    return monthOffset === 4 ? [...monthly, create(monthOffset, 23, 18, 1_240, 'Alaska Airlines', '13', 'demo-visa', false, ['tag-travel'])] : monthly
  }).flat()
}

function buildBudgetReports(transactions: Transaction[], today: Date) {
  return Array.from({ length: 12 }, (_, offset) => budgetReportFor(transactions, today, offset))
}

// Fixed targets so some lines land over budget instead of tracking actuals.
const budgetTargets: Record<string, number> = { '0': 50, '1': 450, '2': 150, '5': 200, '6': 250, '7': 60, '8': 60, '9': 0, '10': 2_450, '11': 190, '12': 20, '13': 300 }

function budgetReportFor(transactions: Transaction[], today: Date, offset: number): BudgetReport {
  const month = dateString(monthDate(today, offset, 1)).slice(0, 7)
  const lines = categories.filter((category) => category.kind !== 'TRANSFER').map((category) => {
    const actual = money(transactions.filter((transaction) => transaction.datetime.startsWith(month) && transaction.category.id === category.id).reduce((sum, transaction) => sum + (category.kind === 'INCOME' ? Math.abs(transaction.amount) : transaction.amount), 0))
    const budgeted = category.kind === 'INCOME' ? 9_000 : budgetTargets[category.id] ?? 100
    return { id: `budget-${month}-${category.id}`, category, budgeted, actual, remaining: money(budgeted - actual) }
  })
  const sections = categoryGroups.filter((group) => group.kind !== 'TRANSFER').map((group) => {
    const groupLines = lines.filter((line) => line.category.groupName === group.name)
    const sum = (field: 'budgeted' | 'actual' | 'remaining') => money(groupLines.reduce((total, line) => total + line[field], 0))
    return { label: group.name, group, budgeted: sum('budgeted'), actual: sum('actual'), remaining: sum('remaining'), lines: groupLines }
  })
  const total = (kind: 'EXPENSE' | 'INCOME', field: 'budgeted' | 'actual') => money(lines.filter((line) => line.category.kind === kind).reduce((sum, line) => sum + line[field], 0))
  const expensesBudgeted = total('EXPENSE', 'budgeted')
  const expensesActual = total('EXPENSE', 'actual')
  const incomeBudgeted = total('INCOME', 'budgeted')
  const incomeActual = total('INCOME', 'actual')
  return { __typename: 'BudgetReport', month, expensesBudgeted, expensesActual, incomeBudgeted, incomeActual, remainingBudgeted: money(incomeBudgeted - expensesBudgeted), remainingActual: money(incomeActual - expensesActual), sections }
}

function recurringChargesFor(transactions: Transaction[], today: Date): RecurringCharge[] {
  return ['Acme Payroll', 'Northstar Mortgage', 'Pacific Gas & Electric', 'T-Mobile', 'Netflix', 'City Gym', 'State Farm Insurance'].map((merchantName, index) => {
    const matches = transactions.filter((transaction) => transaction.merchantName === merchantName)
    const latest = [...matches].sort((left, right) => right.datetime.localeCompare(left.datetime))[0]
    return { __typename: 'RecurringCharge', id: `demo-recurring-${index}`, merchantName, estimatedAmount: Math.abs(latest.amount), interval: 'MONTHLY', status: 'MATURE', isActive: true, category: latest.category, transactions: matches, firstDate: matches.at(-1)!.datetime.slice(0, 10), lastDate: latest.datetime.slice(0, 10), lastAmount: Math.abs(latest.amount), isUserModified: false, nextExpectedDate: dateString(monthDate(today, -1, Number(latest.datetime.slice(8, 10)))) }
  })
}

function plaidItemFor(accounts: Account[], credential: PlaidCredential, syncedAt: string, connectedAt: string): PlaidItem {
  return { __typename: 'PlaidItem', id: 'plaid-chase', credential, institutionId: 'ins_chase', accounts: accounts.filter((account) => account.connection?.id === 'conn-chase').map((account) => ({ ...account, connection: null })), lastSyncedAt: syncedAt, healthState: 'HEALTHY', healthErrorCode: null, healthErrorMessage: null, healthUpdatedAt: syncedAt, syncCron: '0 */4 * * *', recurringSyncCron: '0 8 * * 1', nextSyncAt: new Date(Date.parse(syncedAt) + 4 * 60 * 60 * 1000).toISOString(), nextRecurringSyncAt: new Date(Date.parse(syncedAt) + 7 * DAY).toISOString(), isActive: true, createdAt: connectedAt, updatedAt: syncedAt }
}

function simpleFinFor(accounts: Account[], syncedAt: string, connectedAt: string): SimpleFinAccessToken {
  const connection: SimpleFinConnection = { __typename: 'SimpleFinConnection', id: 'simplefin-capital-one', orgDomain: 'capitalone.com', orgUrl: 'https://www.capitalone.com', accounts: accounts.filter((account) => account.connection?.id === 'conn-simplefin').map((account) => ({ ...account, connection: null })), lastSyncedAt: syncedAt, createdAt: connectedAt, updatedAt: syncedAt }
  return { __typename: 'SimpleFinAccessToken', id: 'simplefin-demo', label: 'Capital One bridge', owner: owners[1], connections: [connection], syncCron: '0 */6 * * *', lastSyncedAt: syncedAt, nextSyncAt: new Date(Date.parse(syncedAt) + 6 * 60 * 60 * 1000).toISOString(), createdAt: connectedAt }
}

function netWorthReportsFor(accounts: Account[], snapshots: AccountSnapshot[]) {
  const dates = [...new Set(snapshots.map((snapshot) => snapshot.date))].sort()
  const totalsFor = (date: string) => snapshots.filter((snapshot) => snapshot.date === date).reduce((totals, snapshot) => ({ assets: totals.assets + Math.max(snapshot.balanceUSD, 0), liabilities: totals.liabilities + Math.abs(Math.min(snapshot.balanceUSD, 0)) }), { assets: 0, liabilities: 0 })
  const latestDate = dates.at(-1)!
  const latest = totalsFor(latestDate)
  const holdings = accounts.flatMap((account) => account.latestSnapshot?.holdings ?? [])
  const classifierBreakdown = [...new Set(holdings.map((holding) => holding.asset.classifier))].map((classifier) => {
    const rows = holdings.filter((holding) => holding.asset.classifier === classifier)
    const valueUSD = money(rows.reduce((sum, holding) => sum + holding.valueUSD, 0))
    return { __typename: 'ClassifierBreakdown' as const, classifier, label: classifierLabels[classifier], valueUSD, percentOfAssets: latest.assets ? valueUSD / latest.assets * 100 : 0, assetCount: new Set(rows.map((holding) => holding.assetId)).size, holdings: rows.map((holding) => ({ __typename: 'HoldingRollup' as const, asset: holding.asset, totalQuantity: holding.quantity, valueUSD: holding.valueUSD, percentOfClassifier: valueUSD ? holding.valueUSD / valueUSD * 100 : 0, holdings: [{ ...holding, account: accounts.find((account) => account.id === holding.accountId) ?? holding.account }] })) }
  }).sort((left, right) => right.valueUSD - left.valueUSD)
  const liabilities = accounts.filter((account) => account.type === 'CREDIT' || account.type === 'LOAN').map((account) => ({ account, valueUSD: Math.abs(account.latestSnapshot?.balanceUSD ?? 0), category: account.type === 'CREDIT' ? 'CARD' as const : 'MORTGAGE' as const }))
  const current: NetWorthReport = { __typename: 'NetWorthReport', asOfDate: latestDate, currentNetWorthUSD: money(latest.assets - latest.liabilities), currentAssetsUSD: money(latest.assets), currentLiabilitiesUSD: money(latest.liabilities), classifierBreakdown, liabilityBreakdown: (['CARD', 'MORTGAGE'] as const).flatMap((category) => {
    const rows = liabilities.filter((item) => item.category === category)
    const valueUSD = money(rows.reduce((sum, item) => sum + item.valueUSD, 0))
    return rows.length ? [{ __typename: 'LiabilityBreakdown' as const, category, label: category === 'CARD' ? 'Cards' : 'Mortgage', valueUSD, percentOfLiabilities: latest.liabilities ? valueUSD / latest.liabilities * 100 : 0, accountCount: rows.length, accounts: rows.map((item) => item.account) }] : []
  }) }
  const history: HistoricalNetWorthReport = { __typename: 'HistoricalNetWorthReport', series: dates.map((date) => {
    const totals = totalsFor(date)
    return { __typename: 'NetWorthPoint', date, totalAssetsUSD: money(totals.assets), totalLiabilitiesUSD: money(totals.liabilities), netWorthUSD: money(totals.assets - totals.liabilities) }
  }), classifierSeries: dates.flatMap((date) => Array.from(snapshots.filter((snapshot) => snapshot.date === date).flatMap((snapshot) => snapshot.holdings ?? []).reduce((byClassifier, holding) => byClassifier.set(holding.asset.classifier, (byClassifier.get(holding.asset.classifier) ?? 0) + holding.valueUSD), new Map<Asset['classifier'], number>()).entries()).map(([classifier, valueUSD]) => ({ __typename: 'ClassifierHistoryPoint' as const, date, classifier, label: classifierLabels[classifier], valueUSD: money(valueUSD) }))), liabilitySeries: dates.flatMap((date) => snapshots.filter((snapshot) => snapshot.date === date && snapshot.balanceUSD < 0).map((snapshot) => ({ __typename: 'LiabilityHistoryPoint' as const, date, category: snapshot.accountId === 'demo-mortgage' ? 'MORTGAGE' as const : 'CARD' as const, label: snapshot.accountId === 'demo-mortgage' ? 'Mortgage' : 'Credit cards', valueUSD: snapshot.balanceUSD }))) }
  return { current, history }
}

function analysisReportFor(accounts: Account[]) {
  const labels: Record<AnalysisView, Record<string, string>> = {
    COMPOSITION: { 'asset-vti': 'US Equity', 'asset-vxus': 'International Equity', 'asset-bnd': 'Bonds', 'asset-aapl': 'US Equity', 'asset-msft': 'US Equity', 'asset-btc': 'Crypto', 'asset-eth': 'Crypto' },
    MORNINGSTAR_CATEGORY: { 'asset-vti': 'US Large Blend', 'asset-vxus': 'Foreign Large Blend', 'asset-bnd': 'Intermediate Core Bond', 'asset-aapl': 'US Large Growth', 'asset-msft': 'US Large Growth', 'asset-btc': 'Digital Assets', 'asset-eth': 'Digital Assets' },
    MORNINGSTAR_GROUP: { 'asset-vti': 'US Equity', 'asset-vxus': 'International Equity', 'asset-bnd': 'Taxable Bond', 'asset-aapl': 'US Equity', 'asset-msft': 'US Equity', 'asset-btc': 'Alternatives', 'asset-eth': 'Alternatives' },
    SECTORS: { 'asset-vti': 'Diversified Market', 'asset-vxus': 'International', 'asset-bnd': 'Fixed Income', 'asset-aapl': 'Technology', 'asset-msft': 'Technology', 'asset-btc': 'Digital Assets', 'asset-eth': 'Digital Assets' },
  }
  return (input?: AnalysisInput): AnalysisReport => {
    const view = input?.view ?? 'COMPOSITION'
    const eligibleAccounts = accounts.filter((account) => !input?.ownerIds?.length || input.ownerIds.includes(account.owner.id)).filter((account) => !input?.accountIds?.length || input.accountIds.includes(account.id)).filter((account) => !input?.accountSubtypes?.length || (account.subtype != null && input.accountSubtypes.includes(account.subtype)))
    const rows = eligibleAccounts.flatMap((account) => account.latestSnapshot?.holdings ?? []).filter((holding) => holding.asset.classifier !== 'CASH' && holding.asset.classifier !== 'REAL_ESTATE')
    const totalValueUSD = money(rows.reduce((sum, holding) => sum + holding.valueUSD, 0))
    const grouped = rows.reduce((byLabel, holding) => {
      const label = labels[view][holding.asset.id] ?? 'Unclassified'
      return byLabel.set(label, [...(byLabel.get(label) ?? []), holding])
    }, new Map<string, Holding[]>())
    const slices = [...grouped.entries()].map(([label, holdings]) => {
      const valueUSD = money(holdings.reduce((sum, holding) => sum + holding.valueUSD, 0))
      return { __typename: 'AnalysisSlice' as const, label, valueUSD, percent: totalValueUSD ? valueUSD / totalValueUSD * 100 : 0, holdings: holdings.map((holding) => ({ __typename: 'AnalysisHolding' as const, asset: holding.asset, valueUSD: holding.valueUSD, percent: valueUSD ? holding.valueUSD / valueUSD * 100 : 0 })) }
    }).sort((left, right) => right.valueUSD - left.valueUSD)
    return { __typename: 'AnalysisReport', view, totalValueUSD, slices }
  }
}
