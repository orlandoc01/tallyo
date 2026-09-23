import { useDeferredValue, useState } from 'react'
import { useClient, useMutation } from 'urql'
import { MERGE_ASSET_MUTATION } from '../../graphql/mutations'
import { ASSETS_QUERY } from '../../graphql/queries'
import type { Asset, AssetAdapterSource } from '../../types/graphql'
import { Button } from '../common/Button'
import { SectionLabel, TextField } from '../common/FormControls'
import { Tag } from '../common/Tag'

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
      <SectionLabel as="h3">Tracked by</SectionLabel>
      <div className="space-y-2">
        {asset.adapterSources.map((source) => (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-md border border-border px-3 py-2 text-sm sm:items-center" key={`${source.sourceAdapter}:${source.sourceId}`}>
            <div className="min-w-0">
              <Tag tint="teal">{adapterLabel(source.sourceAdapter)}</Tag>
              <code className="mt-1 block truncate font-mono text-xs text-text-muted">{source.sourceId}</code>
            </div>
            {canEdit ? (
              <Button onClick={() => handleOpenMergePicker(source)} size="sm" variant="secondary">Merge</Button>
            ) : null}
          </div>
        ))}
      </div>
      {mergePicker ? (
        <div className="space-y-3 rounded-md border border-brand-600 bg-surface-2 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <SectionLabel as="h4">Choose surviving asset</SectionLabel>
              <p className="text-xs text-text-muted">The selected {asset.assetType.toLowerCase()} asset survives. This asset is deleted after its history and sources move.</p>
            </div>
            <Button onClick={() => setMergePicker(null)} size="sm" variant="ghost">Close</Button>
          </div>
          <TextField ariaLabel="Search merge target assets" hideLabel label="Search merge target assets" onChange={handleMergeSearch} onKeyDown={(event) => {
            if (event.key === 'Enter') event.preventDefault()
          }} placeholder="Search assets..." type="search" value={mergePicker.search} />
          {mergePicker.isLoading ? <p className="text-[13px] text-text-muted">Loading assets...</p> : null}
          {mergePicker.error ? <p className="text-[13px] text-negative">{mergePicker.error}</p> : null}
          {!mergePicker.isLoading && !mergePicker.error && mergeTargetAssets.length === 0 ? (
            <p className="text-[13px] text-text-muted">No other {asset.assetType.toLowerCase()} assets match this search.</p>
          ) : null}
          {mergeTargetAssets.length > 0 ? (
            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {mergeTargetAssets.map((target) => (
                <button
                  className="block w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-left text-sm hover:bg-raised disabled:opacity-50"
                  disabled={mergePicker.isMerging}
                  key={target.id}
                  onClick={() => handleMergeTarget(target)}
                  type="button"
                >
                  <span className="block font-medium text-text-1">{assetLabel(target)}</span>
                  <span className="block text-xs text-text-muted">{target.assetType} - {target.identifier}</span>
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
