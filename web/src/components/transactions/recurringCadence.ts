import { addDays, startOfDay } from 'date-fns'
import type { RecurrenceInterval, RecurringCharge } from '../../types/graphql'
import { accountDisplayLabel } from '../../utils/accounts'
import { parseLocalDate } from '../../utils/dates'

type Cadence = RecurrenceInterval | null

const CADENCE_TABLE: ReadonlyArray<{ interval: Cadence; label: string; perMonth: number }> = [
  { interval: 'WEEKLY', label: 'Weekly', perMonth: 52 / 12 },
  { interval: 'BIWEEKLY', label: 'Biweekly', perMonth: 26 / 12 },
  { interval: 'MONTHLY', label: 'Monthly', perMonth: 1 },
  { interval: 'QUARTERLY', label: 'Quarterly', perMonth: 1 / 3 },
  { interval: 'YEARLY', label: 'Yearly', perMonth: 1 / 12 },
  { interval: null, label: 'Irregular', perMonth: 0 },
]

function cadenceEntry(interval: Cadence) {
  return CADENCE_TABLE.find((entry) => entry.interval === interval) ?? CADENCE_TABLE[CADENCE_TABLE.length - 1]
}

export function cadenceLabel(interval: Cadence): string {
  return cadenceEntry(interval).label
}

export function monthlyAmount(amount: number, interval: Cadence): number {
  return amount * cadenceEntry(interval).perMonth
}

export interface CadenceGroup {
  label: string
  items: RecurringCharge[]
  cycleTotal: number
}

export function groupByCadence(charges: RecurringCharge[]): CadenceGroup[] {
  return CADENCE_TABLE
    .map(({ interval, label }) => {
      const items = charges
        .filter((charge) => (charge.interval ?? null) === interval)
        .sort((a, b) => b.lastDate.localeCompare(a.lastDate))
      return { label, items, cycleTotal: items.reduce((sum, charge) => sum + charge.estimatedAmount, 0) }
    })
    .filter((group) => group.items.length > 0)
}

export interface RecurringStats {
  monthlyExpenses: number
  monthlyIncome: number
  next7Total: number
  next7Count: number
}

export function recurringStats(charges: RecurringCharge[], now: Date): RecurringStats {
  const windowStart = startOfDay(now)
  const windowEnd = addDays(windowStart, 7)
  return charges.reduce<RecurringStats>((stats, charge) => {
    const monthly = monthlyAmount(charge.estimatedAmount, charge.interval ?? null)
    const next = charge.nextExpectedDate ? parseLocalDate(charge.nextExpectedDate) : null
    const dueSoon = next !== null && next >= windowStart && next <= windowEnd
    return {
      monthlyExpenses: stats.monthlyExpenses + Math.max(monthly, 0),
      monthlyIncome: stats.monthlyIncome + Math.max(-monthly, 0),
      next7Total: stats.next7Total + (dueSoon ? Math.abs(charge.estimatedAmount) : 0),
      next7Count: stats.next7Count + (dueSoon ? 1 : 0),
    }
  }, { monthlyExpenses: 0, monthlyIncome: 0, next7Total: 0, next7Count: 0 })
}

export function latestTransaction<T extends { datetime: string }>(transactions: T[]): T | undefined {
  return transactions.reduce<T | undefined>((latest, transaction) => (!latest || transaction.datetime > latest.datetime ? transaction : latest), undefined)
}

export function chargeAccount(charge: RecurringCharge) {
  const account = latestTransaction(charge.transactions)?.account
  return account ? accountDisplayLabel(account) : '—'
}
