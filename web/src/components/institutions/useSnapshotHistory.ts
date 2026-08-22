import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { useClient } from 'urql'
import { ACCOUNT_SNAPSHOTS_QUERY } from '../../graphql/queries'
import type { Account, AccountSnapshot, AccountSnapshotConnection, AccountSnapshotsInput, PageInfo } from '../../types/graphql'

// Paged snapshot history for one account: initial fetch, load-more (button
// first, then infinite scroll via sentinelRef), and lookups by date. Resets
// when the account or its latest snapshot changes; onInitialSnapshots fires
// after the first page loads for accounts without a latest snapshot so the
// editor can seed its selection.
export function useSnapshotHistory(account: Account, onInitialSnapshots: (snapshots: AccountSnapshot[]) => void) {
  const client = useClient()
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const [snapshots, setSnapshots] = useState<AccountSnapshot[]>(() => account.latestSnapshot ? [account.latestSnapshot] : [])
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null)
  const [infinite, setInfinite] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const seedInitialSnapshots = useEffectEvent(onInitialSnapshots)
  const snapshotsByDateMap = useMemo(() => snapshotsByDate(snapshots), [snapshots])

  useEffect(() => {
    const latestSnapshot = account.latestSnapshot ?? null
    let cancelled = false
    setSnapshots(latestSnapshot ? [latestSnapshot] : [])
    setPageInfo(null)
    setInfinite(false)
    setLoading(true)
    setError(null)

    client.query<{ accountSnapshots: AccountSnapshotConnection }, { input: AccountSnapshotsInput }>(
      ACCOUNT_SNAPSHOTS_QUERY,
      { input: { accountId: account.id, first: 5 } },
      { requestPolicy: 'network-only' },
    ).toPromise()
      .then((queryResult) => {
        if (cancelled) return
        const connection = queryResult.data?.accountSnapshots
        const fetched = connection?.edges.map((edge) => edge.node) ?? (latestSnapshot ? [latestSnapshot] : [])
        setSnapshots(fetched)
        setPageInfo(connection?.pageInfo ?? null)
        setError(queryResult.error?.message ?? null)
        if (!latestSnapshot) {
          seedInitialSnapshots(fetched)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // seedInitialSnapshots is an effect event: non-reactive and unstable, it
    // must stay out of the deps or this effect refetches on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, account.latestSnapshot, client])

  async function loadMore() {
    if (loading || !pageInfo?.hasNextPage || !pageInfo.endCursor) return
    setLoading(true)
    setError(null)
    try {
      const queryResult = await client.query<{ accountSnapshots: AccountSnapshotConnection }, { input: AccountSnapshotsInput }>(
        ACCOUNT_SNAPSHOTS_QUERY,
        { input: { accountId: account.id, first: 20, after: pageInfo.endCursor } },
        { requestPolicy: 'network-only' },
      ).toPromise()
      if (queryResult.error) {
        setError(queryResult.error.message)
      }
      const connection = queryResult.data?.accountSnapshots
      if (!connection) return
      const fetched = connection.edges.map((edge) => edge.node)
      setSnapshots((current) => mergeHistorySnapshots(current, fetched))
      setPageInfo(connection.pageInfo)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const loadMoreEvent = useEffectEvent(() => {
    void loadMore()
  })

  useEffect(() => {
    if (!infinite || !pageInfo?.hasNextPage || typeof IntersectionObserver === 'undefined') return
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        loadMoreEvent()
      }
    })
    observer.observe(sentinel)
    return () => observer.disconnect()
    // loadMoreEvent is an effect event; see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infinite, pageInfo?.hasNextPage])

  function applySavedSnapshot(updatedSnapshot: AccountSnapshot) {
    setSnapshots((current) => current.map((snapshot) => snapshot.date === updatedSnapshot.date ? updatedSnapshot : snapshot))
  }

  return {
    applySavedSnapshot,
    error,
    infinite,
    loadMore,
    loading,
    pageInfo,
    sentinelRef,
    setInfinite,
    snapshots,
    snapshotsByDate: snapshotsByDateMap,
  }
}

function snapshotsByDate(snapshots: AccountSnapshot[]) {
  return Object.fromEntries(snapshots.map((snapshot) => [snapshot.date, snapshot]))
}

function mergeHistorySnapshots(current: AccountSnapshot[], next: AccountSnapshot[]) {
  const dates = new Set(current.map((snapshot) => snapshot.date))
  return [...current, ...next.filter((snapshot) => !dates.has(snapshot.date))]
}
