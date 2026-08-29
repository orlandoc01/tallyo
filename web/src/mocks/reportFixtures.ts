import type { CashFlowBreakdown, CashFlowPeriod, Category, Granularity, SpendingByCategoryReport, Transaction } from '../types/graphql'
import { accounts, allTransactions, categories } from './fixtures'

export type ReportFilter = {
  categoryIds?: string[]
  datetimeRange?: { from?: string; to?: string }
  granularity?: Granularity | null
  isHidden?: boolean
}

const reportOnlyTransactions: Transaction[] = import.meta.env.MODE === 'demo' ? [] : [
  reportTransaction('report-2024-income', '2024-02-15', -2600, categories[2], 'Employer Direct Deposit'),
  reportTransaction('report-2024-groceries', '2024-02-17', 140, categories[0], 'Whole Foods'),
  reportTransaction('report-2024-restaurants', '2024-08-08', 180, categories[1], 'Local Diner'),
  reportTransaction('report-2025-income', '2025-10-15', -2900, categories[2], 'Employer Direct Deposit'),
  reportTransaction('report-2025-groceries', '2025-10-17', 160, categories[0], 'Trader Joe\'s'),
  reportTransaction('report-2025-restaurants', '2025-12-05', 90, categories[1], 'Pizza Hut'),
  reportTransaction('report-2026-q1-income', '2026-01-15', -3000, categories[2], 'Employer Direct Deposit'),
  reportTransaction('report-2026-q1-restaurants', '2026-01-16', 120, categories[1], 'Chipotle'),
  reportTransaction('report-2026-may-income', '2026-05-01', -3000, categories[2], 'Employer Direct Deposit'),
  reportTransaction('report-2026-may-restaurant-1', '2026-05-10', 100, categories[1], 'Sushi Place'),
  reportTransaction('report-2026-may-restaurant-2', '2026-05-20', 50, categories[1], 'Taco Stand'),
  reportTransaction('report-2026-june-shopping', '2026-06-14', 84.25, categories[4], 'Target'),
  reportTransaction('report-2026-june-utilities', '2026-06-18', 46.1, categories[5], 'Electric Company'),
  reportTransaction('report-2026-june-shopping-credit', '2026-06-22', -24.99, categories[8], 'Target Return'),
]

const reportTransactions = [...allTransactions, ...reportOnlyTransactions]

export function spendingReportForFilter(filter?: ReportFilter): SpendingByCategoryReport {
  return buildSpendingReport(
    filteredReportTransactions(filter).filter((transaction) => transaction.category.kind === 'EXPENSE'),
    filter?.granularity ?? 'MONTHLY',
  )
}

export function cashFlowPeriodsForFilter(filter?: ReportFilter): CashFlowPeriod[] {
  const periods = periodBuckets(filteredReportTransactions(filter)
    .filter((transaction) => transaction.category.kind === 'EXPENSE' || transaction.category.kind === 'INCOME'), filter?.granularity ?? 'MONTHLY')

  return periods.map(({ period, transactions }) => {
    const incomeByCategory = cashFlowBreakdown(transactions.filter((transaction) => transaction.category.kind === 'INCOME'), 'INCOME')
    const expensesByCategory = cashFlowBreakdown(transactions.filter((transaction) => transaction.category.kind === 'EXPENSE'), 'EXPENSE')
    const income = incomeByCategory.reduce((sum, item) => sum + item.total, 0)
    const expenses = expensesByCategory.reduce((sum, item) => sum + item.total, 0)
    const savings = income - expenses

    return {
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
      summary: {
        income,
        expenses,
        savings,
        savingsRate: income ? savings / income * 100 : 0,
      },
      incomeByCategory,
      expensesByCategory,
    }
  })
}

function buildSpendingReport(transactions: Transaction[], granularity: Granularity): SpendingByCategoryReport {
  const periods = periodBuckets(transactions, granularity)
  const totalAmount = transactions.reduce((sum, transaction) => sum + transaction.amount, 0)
  const transactionCount = transactions.length
  const categoriesById = new Map<string, SpendingByCategoryReport['categories'][number]>()

  for (const category of new Map(transactions.map((transaction) => [transaction.category.id, transaction.category])).values()) {
    const categoryTransactions = transactions.filter((transaction) => transaction.category.id === category.id)
    const categoryTotal = categoryTransactions.reduce((sum, transaction) => sum + transaction.amount, 0)
    categoriesById.set(category.id, {
      category,
      totalAmount: categoryTotal,
      transactionCount: categoryTransactions.length,
      percentOfTotal: totalAmount ? categoryTotal / totalAmount * 100 : 0,
      periods: [],
    })
  }

  for (const category of categoriesById.values()) {
    category.periods = periods.map(({ period, transactions: periodTransactions }) => {
      const categoryTransactions = periodTransactions.filter((transaction) => transaction.category.id === category.category.id)
      const periodTotal = periodTransactions.reduce((sum, transaction) => sum + transaction.amount, 0)
      const categoryTotal = categoryTransactions.reduce((sum, transaction) => sum + transaction.amount, 0)

      return {
        periodLabel: period.label,
        periodStart: period.start,
        periodEnd: period.end,
        totalAmount: categoryTotal,
        transactionCount: categoryTransactions.length,
        percentOfTotal: periodTotal ? categoryTotal / periodTotal * 100 : 0,
      }
    })
  }

  return {
    totalAmount,
    transactionCount,
    periods: periods.map(({ period, transactions: periodTransactions }) => ({
      periodLabel: period.label,
      periodStart: period.start,
      periodEnd: period.end,
      totalAmount: periodTransactions.reduce((sum, transaction) => sum + transaction.amount, 0),
      transactionCount: periodTransactions.length,
    })),
    categories: [...categoriesById.values()].sort((a, b) => b.totalAmount - a.totalAmount),
  }
}

function filteredReportTransactions(filter?: ReportFilter) {
  const from = filter?.datetimeRange?.from ? Date.parse(filter.datetimeRange.from) : Number.NEGATIVE_INFINITY
  const to = filter?.datetimeRange?.to ? Date.parse(filter.datetimeRange.to) : Number.POSITIVE_INFINITY

  return reportTransactions
    .filter((transaction) => filter?.isHidden === undefined || transaction.isHidden === filter.isHidden)
    .filter((transaction) => !filter?.categoryIds?.length || filter.categoryIds.includes(transaction.category.id))
    .filter((transaction) => {
      const time = Date.parse(transaction.datetime)
      return time >= from && time < to
    })
}

function periodBuckets(transactions: Transaction[], granularity: Granularity) {
  const buckets = new Map<string, { period: Period; transactions: Transaction[] }>()
  for (const transaction of transactions) {
    const period = periodForDate(new Date(transaction.datetime), granularity)
    const existing = buckets.get(period.start)
    if (existing) existing.transactions.push(transaction)
    else buckets.set(period.start, { period, transactions: [transaction] })
  }

  return [...buckets.values()].sort((a, b) => a.period.start.localeCompare(b.period.start))
}

function cashFlowBreakdown(transactions: Transaction[], kind: 'EXPENSE' | 'INCOME'): CashFlowBreakdown[] {
  const total = transactions.reduce((sum, transaction) => sum + cashFlowAmount(transaction, kind), 0)
  const byCategory = new Map<string, { category: Category; total: number; transactionCount: number }>()

  for (const transaction of transactions) {
    const existing = byCategory.get(transaction.category.id)
    if (existing) {
      existing.total += cashFlowAmount(transaction, kind)
      existing.transactionCount += 1
    } else {
      byCategory.set(transaction.category.id, {
        category: transaction.category,
        total: cashFlowAmount(transaction, kind),
        transactionCount: 1,
      })
    }
  }

  return [...byCategory.values()]
    .map((item) => ({ ...item, percentOfTotal: total ? item.total / total * 100 : 0 }))
    .sort((a, b) => b.total - a.total)
}

function cashFlowAmount(transaction: Transaction, kind: 'EXPENSE' | 'INCOME') {
  return kind === 'INCOME' ? Math.abs(transaction.amount) : transaction.amount
}

type Period = { label: string; start: string; end: string }

function periodForDate(date: Date, granularity: Granularity): Period {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()

  if (granularity === 'YEARLY') {
    return { label: String(year), start: `${year}-01-01`, end: `${year}-12-31` }
  }

  if (granularity === 'QUARTERLY') {
    const quarter = Math.floor(month / 3)
    const startMonth = quarter * 3
    return {
      label: `${year} Q${quarter + 1}`,
      start: formatDate(new Date(Date.UTC(year, startMonth, 1))),
      end: formatDate(new Date(Date.UTC(year, startMonth + 3, 0))),
    }
  }

  return {
    label: `${year}-${String(month + 1).padStart(2, '0')}`,
    start: formatDate(new Date(Date.UTC(year, month, 1))),
    end: formatDate(new Date(Date.UTC(year, month + 1, 0))),
  }
}

function reportTransaction(id: string, date: string, amount: number, category: Category, merchantName: string): Transaction {
  const datetime = `${date}T12:00:00Z`
  return {
    __typename: 'Transaction',
    id,
    tags: [],
    account: accounts[0],
    amount,
    datetime,
    postedDatetime: datetime,
    merchantName,
    originalName: merchantName.toUpperCase(),
    category,
    isRecurring: category.kind === 'INCOME',
    isReviewed: true,
    notes: null,
    plaidCategory: null,
    pending: false,
    isHidden: false,
    createdAt: datetime,
    updatedAt: datetime,
  }
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10)
}
