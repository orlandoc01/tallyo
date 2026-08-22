import { ASSET_LATEST_SNAPSHOT_QUERY } from '../../graphql/queries'
import { useEntityQuery } from '../../hooks/useListQuery'
import { usePermissions } from '../../hooks/usePermissions'
import type { Asset } from '../../types/graphql'
import { accountMaskedName } from '../../utils/accounts'
import { formatSignedCurrency } from '../../utils/currency'
import { ArrowUpRightLink } from '../common/Button'
import { QueryGate } from '../common/QueryGate'
import { displayAmount } from './amountDisplay'

type AssetLatestSnapshotNode = { __typename?: string; latestSnapshot?: Asset['latestSnapshot'] }

export function AssetAccountsList({ assetId, amountsHidden }: { assetId: string; amountsHidden: boolean }) {
  const { canRead } = usePermissions()
  const canOpenValuation = canRead('wealth') && canRead('holdings')
  const { data, fetching, error, refetch } = useEntityQuery<AssetLatestSnapshotNode, { assetId: string }>(
    { query: ASSET_LATEST_SNAPSHOT_QUERY, variables: { assetId }, requestPolicy: 'cache-and-network' },
    'node',
  )
  const holdings = data?.latestSnapshot?.holdings ?? []

  return (
    <section className="space-y-2" aria-label="Accounts">
      <h3 className="text-sm font-semibold text-neutral-700">Accounts</h3>
      <QueryGate
        data={data}
        empty={holdings.length === 0}
        emptyTitle="Not held in any account."
        error={error}
        errorPrefix="Could not load accounts"
        fetching={fetching}
        loadingLabel="Loading accounts"
        onRetry={() => refetch({ requestPolicy: 'network-only' })}
      >
        <div className="space-y-2">
          {holdings.map((holding) => {
            const label = accountMaskedName(holding.account)
            return (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-neutral-100 px-3 py-2 text-sm" key={holding.account.id}>
                <span className="min-w-0 truncate font-medium text-neutral-800">{label}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-semibold text-neutral-950">{displayAmount(amountsHidden, formatSignedCurrency(holding.valueUSD))}</span>
                  {canOpenValuation ? (
                    <ArrowUpRightLink label={`Open ${label} valuation page`} to={`/accounts/${holding.account.id}/valuation`} />
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </QueryGate>
    </section>
  )
}
