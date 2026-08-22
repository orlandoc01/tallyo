import { useDeferredValue, useState } from 'react'
import { Link } from 'react-router'
import { FilterCheckboxList, type FilterCheckboxOption } from '../common/FilterCheckboxList'
import { TextField } from '../common/FormControls'
import { formatUnitPrice } from '../../utils/currency'
import type { Asset } from '../../types/graphql'
import { assetDisplayLabel } from './accountSnapshotLines'

export function SnapshotAssetPicker({
  assets,
  excludedAssetIds,
  fetching,
  errorMessage,
  onSelect,
}: {
  assets: Asset[]
  excludedAssetIds: Set<string>
  fetching: boolean
  errorMessage: string | null
  onSelect: (asset: Asset) => void
}) {
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const visibleAssets = filterAssets(assets, excludedAssetIds, deferredSearch)
  const options = visibleAssets.map(assetOption)

  function handleAddClick() {
    setAdding((current) => {
      const next = !current
      setOpen(next)
      if (!next) setSearch('')
      return next
    })
  }

  function handleChange(selectedIds: string[]) {
    const asset = visibleAssets.find((item) => item.id === selectedIds[0])
    if (!asset) return
    onSelect(asset)
    setAdding(false)
    setOpen(false)
    setSearch('')
  }

  return (
    <div className="space-y-2">
      {adding ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 rounded-xl border border-neutral-100 px-3 py-2 text-sm">
          <div className="relative min-w-0">
            <button
              aria-expanded={open}
              aria-label="Select holding asset"
              className="w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-left text-sm font-medium text-neutral-700 hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
              onClick={() => setOpen((current) => !current)}
              type="button"
            >
              Select asset
            </button>
            {open ? (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
                <div className="absolute left-0 z-20 mt-2 w-80 rounded-2xl border border-neutral-200 bg-white p-4 shadow-xl">
                  <div className="space-y-3">
                    <Link
                      className="block rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-sm font-semibold text-brand-700 hover:bg-brand-100"
                      to="/settings/assets?new=1"
                    >
                      Create New
                    </Link>
                    <TextField hideLabel label="Search assets" onChange={setSearch} placeholder="Search assets..." type="search" value={search} />
                    {fetching ? <p className="text-sm text-neutral-500">Loading assets...</p> : null}
                    {errorMessage ? <p className="text-sm text-red-600">Could not load assets: {errorMessage}</p> : null}
                    {!fetching && !errorMessage && options.length === 0 ? (
                      <p className="text-sm text-neutral-500">No available assets match this search.</p>
                    ) : null}
                    {options.length > 0 ? (
                      <FilterCheckboxList options={options} selectedIds={[]} selectionMode="single" onChange={handleChange} />
                    ) : null}
                  </div>
                </div>
              </>
            ) : null}
          </div>
          <label className="w-28 text-right text-xs font-medium text-neutral-600 sm:w-32">
            <span className="sr-only">Quantity</span>
            <input
              aria-label="Quantity for new holding"
              className="w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-right text-sm tabular-nums disabled:bg-neutral-50 disabled:text-neutral-500"
              disabled
              readOnly
              type="number"
              value="0"
            />
            <div className="mt-1 text-xs font-normal tabular-nums text-neutral-500">$0.00</div>
          </label>
        </div>
      ) : null}
      <button
        aria-expanded={adding}
        className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm font-semibold text-neutral-700 hover:bg-neutral-50 sm:w-auto"
        onClick={handleAddClick}
        type="button"
      >
        Add holding
      </button>
    </div>
  )
}

function filterAssets(assets: Asset[], excludedAssetIds: Set<string>, search: string) {
  const normalizedSearch = search.trim().toLowerCase()
  return assets.filter((asset) => (
    !excludedAssetIds.has(asset.id)
    && asset.assetType !== 'REAL_ESTATE'
    && (!normalizedSearch || searchableAssetText(asset).includes(normalizedSearch))
  ))
}

function assetOption(asset: Asset): FilterCheckboxOption {
  const label = assetDisplayLabel(asset)
  return {
    id: asset.id,
    label,
    ariaLabel: `Add ${label}`,
    searchText: searchableAssetText(asset),
    description: asset.currentPrice != null
      ? `${asset.assetType} - ${asset.identifier}`
      : `${asset.assetType} - ${asset.identifier} - no price available; value starts at $0`,
    trailing: asset.currentPrice != null ? formatUnitPrice(asset.currentPrice) : 'No price',
  }
}

function searchableAssetText(asset: Asset) {
  return [asset.identifier, asset.name, asset.classifier, asset.assetType]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}
