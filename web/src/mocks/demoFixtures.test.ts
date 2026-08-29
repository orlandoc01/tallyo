import { buildDemoData } from './demo/data'

const idsAreUnique = (ids: string[]) => new Set(ids).size === ids.length

describe('demo fixtures', () => {
  const today = new Date('2026-08-28T12:00:00Z')
  const data = buildDemoData(today)

  it('keeps ids and references internally consistent', () => {
    expect(idsAreUnique(data.accounts.map((account) => account.id))).toBe(true)
    expect(idsAreUnique(data.assets.map((asset) => asset.id))).toBe(true)
    expect(idsAreUnique(data.allTransactions.map((transaction) => transaction.id))).toBe(true)
    expect(idsAreUnique(data.accountSnapshots.map((snapshot) => snapshot.id))).toBe(true)

    const accountIds = new Set(data.accounts.map((account) => account.id))
    const assetIds = new Set(data.assets.map((asset) => asset.id))
    const categoryIds = new Set(data.categories.map((category) => category.id))
    const ownerIds = new Set(data.owners.map((owner) => owner.id))
    const tagIds = new Set(data.tags.map((tag) => tag.id))

    expect(data.accounts.every((account) => ownerIds.has(account.owner.id))).toBe(true)
    expect(data.categoryGroups.every((group) => group.categories.every((category) => categoryIds.has(category.id)))).toBe(true)
    expect(data.allTransactions.every((transaction) => accountIds.has(transaction.account.id) && categoryIds.has(transaction.category.id) && transaction.tags.every((tag) => tagIds.has(tag.id)))).toBe(true)
    expect(data.accountSnapshots.every((snapshot) => accountIds.has(snapshot.accountId) && (snapshot.holdings ?? []).every((holding) => assetIds.has(holding.assetId) && accountIds.has(holding.accountId)))).toBe(true)
    expect(data.recurringCharges.every((charge) => charge.category != null && categoryIds.has(charge.category.id) && charge.transactions.every((transaction) => data.allTransactions.some((item) => item.id === transaction.id)))).toBe(true)
    expect(data.budgetReportHistory.items.every((report) => report.sections.every((section) => section.lines.every((line) => categoryIds.has(line.category.id))))).toBe(true)
    expect(data.connections.every((connection) => ownerIds.has(connection.owner.id) && (connection.provider?.__typename !== 'PlaidItem' || connection.provider.accounts.every((account) => accountIds.has(account.id))))).toBe(true)
    expect(data.simpleFinAccessTokens.every((token) => ownerIds.has(token.owner.id) && token.connections.every((connection) => connection.accounts.every((account) => accountIds.has(account.id))))).toBe(true)
  })

  it('derives twelve monthly budget actuals from the ledger', () => {
    expect(data.budgetReport.month).toBe('2026-08')
    expect(data.budgetReportHistory.items).toHaveLength(12)

    for (const report of data.budgetReportHistory.items) {
      for (const line of report.sections.flatMap((section) => section.lines)) {
        const actual = data.allTransactions
          .filter((transaction) => transaction.datetime.startsWith(report.month) && transaction.category.id === line.category.id)
          .reduce((sum, transaction) => sum + (line.category.kind === 'INCOME' ? Math.abs(transaction.amount) : transaction.amount), 0)
        expect(line.actual).toBeCloseTo(actual)
      }
    }
  })

  it('spans a year and gives every account a current, sorted snapshot history', () => {
    const dates = data.allTransactions.map((transaction) => transaction.datetime)
    expect(Math.min(...dates.map(Date.parse))).toBeGreaterThanOrEqual(today.getTime() - 366 * 86_400_000)
    expect(Math.max(...dates.map(Date.parse))).toBeGreaterThanOrEqual(today.getTime() - 86_400_000)

    for (const account of data.accounts) {
      const snapshots = data.accountSnapshots.filter((snapshot) => snapshot.accountId === account.id)
      expect(snapshots).toHaveLength(24)
      expect(snapshots.every((snapshot, index) => index === 0 || snapshots[index - 1].date >= snapshot.date)).toBe(true)
      expect(account.latestSnapshot?.id).toBe(snapshots[0].id)
      expect(account.latestSnapshot?.balanceUSD).toBe(snapshots[0].balanceUSD)
    }
  })
})
