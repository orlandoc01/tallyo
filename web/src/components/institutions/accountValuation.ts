import { format, subMonths } from 'date-fns'
import type { Account, AccountSnapshot } from '../../types/graphql'
import { parseLocalDate, toDateInputValue } from '../../utils/dates'

export interface SnapshotMonthGroup {
  key: string
  label: string
  snapshots: AccountSnapshot[]
  changeUSD: number
  changePct: number
}

function change(latest: number, oldest: number) {
  const changeUSD = latest - oldest
  return { changeUSD, changePct: oldest === 0 ? 0 : (changeUSD / Math.abs(oldest)) * 100 }
}

// Snapshots arrive newest first; each group keeps that order and reports the
// month's net change from its oldest to its newest snapshot.
export function groupSnapshotsByMonth(snapshots: AccountSnapshot[]): SnapshotMonthGroup[] {
  return snapshots.reduce<SnapshotMonthGroup[]>((groups, snapshot) => {
    const key = snapshot.date.slice(0, 7)
    const group = groups.find((item) => item.key === key)
    if (group) group.snapshots.push(snapshot)
    else groups.push({ key, label: format(parseLocalDate(snapshot.date), 'MMMM yyyy'), snapshots: [snapshot], changeUSD: 0, changePct: 0 })
    return groups
  }, []).map((group) => {
    const latest = group.snapshots[0].netContributionUSD
    const oldest = group.snapshots[group.snapshots.length - 1].netContributionUSD
    return { ...group, ...change(latest, oldest) }
  })
}

export function formatSnapshotDay(date: string) {
  return format(parseLocalDate(date), 'EEE, MMM d')
}

export type SnapshotTone = 'sync' | 'manual' | 'flagged'

const SOURCE_LABELS: Record<string, string> = { PlaidItem: 'Plaid sync', SimpleFinConnection: 'SimpleFIN sync', EVMWallet: 'Wallet sync' }

export function snapshotSource(account: Account, snapshot: AccountSnapshot): { label: string; tone: SnapshotTone } {
  if (snapshot.flagged) return { label: 'Flagged', tone: 'flagged' }
  const typename = account.connection?.provider?.__typename
  if (account.manual || !typename) return { label: 'Manual', tone: 'manual' }
  return { label: SOURCE_LABELS[typename] ?? 'Provider sync', tone: 'sync' }
}

export interface SparklinePoint {
  date: string
  value: number
}

// Oldest-first balance points within the trailing twelve months.
export function trailingYearPoints(snapshots: AccountSnapshot[], now = new Date()): SparklinePoint[] {
  const since = toDateInputValue(subMonths(now, 12))
  return snapshots
    .filter((snapshot) => snapshot.date >= since)
    .map((snapshot) => ({ date: snapshot.date, value: snapshot.netContributionUSD }))
    .reverse()
}

export function sparklineChange(points: SparklinePoint[]) {
  if (points.length < 2) return null
  return change(points[points.length - 1].value, points[0].value)
}

export function sparklineLabels(points: SparklinePoint[], count = 5) {
  if (points.length === 0) return []
  const last = points.length - 1
  return Array.from({ length: Math.min(count, points.length) }, (_, index) => {
    const point = points[Math.round((index * last) / Math.max(1, Math.min(count, points.length) - 1))]
    return format(parseLocalDate(point.date), 'MMM')
  })
}

export function balanceOnlyLineLabel(account: Account) {
  return account.type === 'CREDIT' || account.type === 'LOAN' ? 'Statement balance' : 'Cash balance'
}
