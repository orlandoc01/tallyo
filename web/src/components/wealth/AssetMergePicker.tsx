import { useDeferredValue, useState } from 'react'
import { useClient, useMutation } from 'urql'
import { MERGE_ASSET_MUTATION } from '../../graphql/mutations'
import { ASSETS_QUERY } from '../../graphql/queries'
import type { Asset, AssetAdapterSource } from '../../types/graphql'
import { TextField } from '../common/FormControls'

type MergePickerState = {
  source: AssetAdapterSource
  assets: Asset[]
  search: string
  isLoading: boolean
  isMerging: boolean
  error: string | null
}

export function AssetMergePicker({
  asset,
  canEdit,
  onClose,
  onUpdate,
}: {
  asset: Asset
  canEdit: boolean
  onClose: () => void
  onUpdate?: (asset: Asset) => void
}) {
  const client = useClient()
  const [, mergeAsset] = useMutation(MERGE_ASSET_MUTATION)
  const [mergePicker, setMergePicker] = useState<MergePickerState | null>(null)
  const deferredMergeSearch = useDeferredValue(mergePicker?.search ?? '')
  const mergeTargetAssets = mergePicker ? mergeTargets(mergePicker.assets, asset, deferredMergeSearch) : []

  async function handleOpenMergePicker(source: AssetAdapterSource) {
    setMergePicker({ source, assets: [], search: '', isLoading: true, isMerging: false, error: null })
    const result = await client
      .query<{ assets: { items: Asset[] } }>(ASSETS_QUERY, { input: { includeHistorical: true } })
      .toPromise()
    if (result.error || !result.data?.assets) {
      const message = result.error?.message ?? 'Could not load assets'
      setMergePicker((current) => current && current.source === source
        ? { ...current, isLoading: false, error: message }
        : current)
      return
    }
    const assets = result.data.assets.items
    setMergePicker((current) => current && current.source === source
      ? { ...current, assets, isLoading: false, error: null }
      : current)
  }

  function handleMergeSearch(search: string) {
    setMergePicker((current) => current ? { ...current, search } : current)
  }

  async function handleMergeTarget(target: Asset) {
    if (!mergePicker) return
    const source = mergePicker.source
    const sourceCount = asset.adapterSources.length
    const sourceSummary = sourceCount === 1 ? 'its provider source' : `all ${sourceCount} provider sources`
    if (!window.confirm(`Merge ${assetLabel(asset)} into ${assetLabel(target)}? This moves its holdings, history, analysis, and ${sourceSummary}.`)) {
      return
    }
    setMergePicker((current) => current ? { ...current, isMerging: true, error: null } : current)
    const result = await mergeAsset({
      input: {
        sourceAdapter: source.sourceAdapter,
        sourceId: source.sourceId,
        assetId: target.id,
      },
    })
    if (result.error) {
      const message = result.error.message
      setMergePicker((current) => current ? { ...current, isMerging: false, error: message } : current)
      return
    }
    const merged = result.data?.mergeAsset?.asset
    if (merged) {
      onUpdate?.(merged)
    }
    onClose()
  }

  if (asset.adapterSources.length === 0) {
    return null
  }

  return (
    <section className="space-y-2" aria-label="Tracked by">
      <h3 className="text-sm font-semibold text-neutral-700">Tracked by</h3>
      <div className="space-y-2">
        {asset.adapterSources.map((source) => (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-xl border border-neutral-100 px-3 py-2 text-sm sm:items-center" key={`${source.sourceAdapter}:${source.sourceId}`}>
            <div className="min-w-0">
              <span className="inline-flex rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700">
                {adapterLabel(source.sourceAdapter)}
              </span>
              <code className="mt-1 block truncate text-xs text-neutral-500">{source.sourceId}</code>
            </div>
            {canEdit ? (
              <button
                className="rounded-xl border border-neutral-200 px-2.5 py-1 text-xs font-semibold text-neutral-600 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                onClick={() => handleOpenMergePicker(source)}
                type="button"
              >
                Merge
              </button>
            ) : null}
          </div>
        ))}
      </div>
      {mergePicker ? (
        <div className="space-y-3 rounded-xl border border-brand-100 bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-neutral-800">Choose surviving asset</h4>
              <p className="text-xs text-neutral-500">The selected {asset.assetType.toLowerCase()} asset survives. This asset is deleted after its history and sources move.</p>
            </div>
            <button className="text-xs font-semibold text-neutral-500 hover:text-neutral-700" onClick={() => setMergePicker(null)} type="button">
              Close
            </button>
          </div>
          <TextField ariaLabel="Search merge target assets" hideLabel label="Search merge target assets" onChange={handleMergeSearch} onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault()
          }} placeholder="Search assets..." type="search" value={mergePicker.search} />
          {mergePicker.isLoading ? <p className="text-sm text-neutral-500">Loading assets...</p> : null}
          {mergePicker.error ? <p className="text-sm text-red-600">{mergePicker.error}</p> : null}
          {!mergePicker.isLoading && !mergePicker.error && mergeTargetAssets.length === 0 ? (
            <p className="text-sm text-neutral-500">No other {asset.assetType.toLowerCase()} assets match this search.</p>
          ) : null}
          {mergeTargetAssets.length > 0 ? (
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {mergeTargetAssets.map((target) => (
                <button
                  className="block w-full rounded-xl border border-neutral-200 px-3 py-2 text-left text-sm hover:bg-neutral-50 disabled:opacity-50"
                  disabled={mergePicker.isMerging}
                  key={target.id}
                  onClick={() => handleMergeTarget(target)}
                  type="button"
                >
                  <span className="block font-medium text-neutral-800">{assetLabel(target)}</span>
                  <span className="block text-xs text-neutral-500">{target.assetType} - {target.identifier}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function adapterLabel(adapter: AssetAdapterSource['sourceAdapter']) {
  switch (adapter) {
    case 'PLAID':
      return 'Plaid'
    case 'SIMPLEFIN':
      return 'SimpleFIN'
    case 'DEBANK':
      return 'DeBank'
  }
}

function assetLabel(asset: Asset) {
  if (asset.assetType === 'SECURITY') {
    return asset.identifier || asset.name || 'Unknown asset'
  }
  return asset.name || asset.identifier || 'Unknown asset'
}

function mergeTargets(assets: Asset[], currentAsset: Asset, search: string) {
  const normalizedSearch = search.trim().toLowerCase()
  return assets.filter((candidate) => (
    candidate.id !== currentAsset.id
    && candidate.assetType === currentAsset.assetType
    && (!normalizedSearch || searchableAssetText(candidate).includes(normalizedSearch))
  ))
}

function searchableAssetText(asset: Asset) {
  return [asset.identifier, asset.name, asset.classifier, asset.assetType]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}
