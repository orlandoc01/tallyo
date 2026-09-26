import { useMutation, useQuery } from 'urql'
import { CHANGE_ACCOUNT_SNAPSHOT_MUTATION } from '../../graphql/mutations'
import { ASSETS_QUERY } from '../../graphql/queries'
import { emptyList } from '../../hooks/useListQuery'
import { usePermissions } from '../../hooks/usePermissions'
import type { Account, AccountSnapshot, Asset, AssetList, AssetsInput } from '../../types/graphql'
import { USD_ASSET_ID, type SnapshotLine } from './accountSnapshotLines'

// Permissions, the manual-holding asset catalog and the save mutation shared by
// the desktop snapshot editor and the mobile expanded snapshot panel.
export function useSnapshotEditorResources(account: Account) {
  const { canRead, canWrite } = usePermissions()
  const canReadAssets = canRead('assets')
  const canWriteWealth = canWrite('wealth')
  const [assetsResult] = useQuery<{ assets: AssetList }, { input: AssetsInput }>({
    query: ASSETS_QUERY,
    variables: { input: { includeHistorical: true } },
    pause: !account.manual || !canReadAssets || !canWriteWealth,
  })
  const [, changeSnapshot] = useMutation(CHANGE_ACCOUNT_SNAPSHOT_MUTATION)
  const usdAsset = assetsResult.data?.assets.items.find((asset) =>
    asset.id === USD_ASSET_ID || (asset.assetType === 'CURRENCY' && asset.identifier === 'USD'))

  async function saveLines(snapshot: AccountSnapshot, lines: SnapshotLine[]) {
    const mutationResult = await changeSnapshot({
      input: {
        snapshotId: snapshot.id,
        holdings: lines.map((line) => ({ assetId: line.asset.id, quantity: line.quantity, valueUSD: line.valueUSD })),
      },
    })
    const updated = mutationResult.data?.changeAccountSnapshot as { snapshot?: AccountSnapshot; account?: Account } | undefined
    return { error: mutationResult.error?.message ?? null, snapshot: updated?.snapshot, account: updated?.account }
  }

  return {
    assets: assetsResult.data?.assets.items ?? emptyList<Asset>(),
    assetsError: assetsResult.error?.message ?? null,
    assetsFetching: assetsResult.fetching,
    balanceOnly: account.manual && (account.type === 'CREDIT' || account.type === 'LOAN' || account.type === 'DEPOSITORY'),
    canManageManualHoldings: account.manual && canWriteWealth,
    canReadAssets,
    canWriteWealth,
    liabilityBalance: account.type === 'CREDIT' || account.type === 'LOAN',
    saveLines,
    usdAsset,
  }
}
