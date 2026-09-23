import type { CSSProperties } from 'react'
import type { Asset, AssetType } from '../../types/graphql'
import { formatQuantity } from '../../utils/amount'
import { formatCurrency } from '../../utils/currency'
import type { TagTint } from '../../utils/tagTints'
import { ClickableRow } from '../common/ClickableRow'
import { DataGridHeader } from '../common/DataGrid'
import { Tag } from '../common/Tag'

const ASSET_GRID_COLUMNS = 'minmax(180px,1.4fr) minmax(220px,2fr) minmax(110px,140px) 80px'

const ASSET_KIND_TINT: Partial<Record<AssetType, TagTint>> = { CRYPTO: 'amber', REAL_ESTATE: 'violet' }

const rowStyle = { '--asset-cols': ASSET_GRID_COLUMNS } as CSSProperties

export function AssetGridHeader() {
  return (
    <div className="hidden lg:block">
      <DataGridHeader gridTemplateColumns={ASSET_GRID_COLUMNS} variant="list-first">
        <span>Name</span>
        <span>Identifier</span>
        <span className="text-right">Value</span>
        <span className="text-right">Units</span>
      </DataGridHeader>
    </div>
  )
}

export function AssetRow({ asset, onClick }: { asset: Asset; onClick: () => void }) {
  const snapshot = asset.latestSnapshot
  return (
    <ClickableRow
      className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-t border-border px-4 py-2.5 text-left transition-colors duration-150 first-of-type:border-t-0 hover:bg-raised lg:h-11 lg:gap-3 lg:py-0 lg:[grid-template-columns:var(--asset-cols)]"
      onClick={onClick}
      style={rowStyle}
    >
      <span className="min-w-0 truncate text-sm font-medium text-text-1">{asset.name ?? asset.identifier}</span>
      <span className="text-right text-sm font-medium tabular-nums text-text-1 lg:order-3">{snapshot ? formatCurrency(snapshot.totalHeldValueUSD) : '—'}</span>
      <span className="flex min-w-0 items-center gap-2 lg:order-2">
        <Tag size="badge" tint={ASSET_KIND_TINT[asset.assetType] ?? 'gray'}>{asset.assetType}</Tag>
        <span className="min-w-0 truncate font-mono text-xs text-text-muted">{asset.identifier}</span>
      </span>
      <span className="text-right text-[13px] tabular-nums text-text-muted lg:order-4">{snapshot?.totalHeldQuantity != null ? `${formatQuantity(snapshot.totalHeldQuantity)} units` : '—'}</span>
    </ClickableRow>
  )
}
