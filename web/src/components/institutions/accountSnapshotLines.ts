import type { AccountSnapshot, Asset, Holding } from '../../types/graphql'

// Editable representation of a single holding within an account snapshot, plus
// the pure transforms between snapshots/holdings and these lines. Shared by the
// snapshot editor and its row component.
export interface SnapshotLine {
  asset: Asset
  manual: boolean
  quantity: number | null
  quantityText: string
  valueUSD: number
  valueText: string
  price: number | null
}

// base64url("v1:Asset:1") -- USD is seeded with local id 1 by the initial migration.
export const USD_ASSET_ID = 'djE6QXNzZXQ6MQ'

export function snapshotToLines(snapshot: AccountSnapshot): SnapshotLine[] {
  return (snapshot.holdings ?? []).map((holding) => holdingToLine(holding))
}

function holdingToLine(holding: Holding): SnapshotLine {
  const cash = isCash(holding.asset)
  const quantity = holding.quantity ?? null
  const price = quantity == null ? null : cash ? 1 : quantity === 0 ? 0 : holding.valueUSD / quantity
  return {
    asset: holding.asset,
    manual: holding.manual,
    quantity,
    quantityText: quantity == null ? '' : String(quantity),
    valueUSD: holding.valueUSD,
    valueText: String(holding.valueUSD),
    price,
  }
}

export function assetToSnapshotLine(asset: Asset): SnapshotLine {
  const price = isCash(asset) ? 1 : asset.forcedUsdPrice ?? asset.currentPrice ?? 0
  return {
    asset,
    manual: true,
    quantity: 0,
    quantityText: '0',
    valueUSD: 0,
    valueText: '0',
    price,
  }
}

export function assetDisplayLabel(asset: Asset) {
  if (asset.assetType === 'SECURITY') {
    return asset.identifier || asset.name || 'Unknown asset'
  }
  return asset.name || asset.identifier || 'Unknown asset'
}

export function assetInputLabel(asset: Asset) {
  if (asset.assetType === 'SECURITY') {
    return asset.identifier || asset.name || 'Unknown asset'
  }
  return asset.name || asset.identifier || 'Unknown asset'
}

export function isCash(asset: Asset) {
  return asset.classifier === 'CASH'
}

function parseDecimal(value: string) {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

// Round a dollar amount to whole cents — mirrors the Money scalar's wire
// rounding, so a derived valuation shows exactly what gets persisted.
function roundCents(value: number) {
  return Math.round(value * 100) / 100
}

// Strip IEEE-754 noise (e.g. 33.33333333333333) from a derived quantity while
// keeping full meaningful precision across magnitudes. Quantity ships as a
// Float, so the trimmed number is exactly what goes on the wire.
function trimQuantity(value: number) {
  return value === 0 ? 0 : Number(value.toPrecision(12))
}

export function updateLineQuantity(lines: SnapshotLine[], assetID: string, value: string): SnapshotLine[] {
  return lines.map((line) => {
    if (line.asset.id !== assetID) return line
    const quantity = parseDecimal(value)
    const valueUSD = roundCents(quantity * (line.price ?? 0))
    return { ...line, quantity, quantityText: value, valueUSD, valueText: String(valueUSD) }
  })
}

export function updateLineValue(lines: SnapshotLine[], assetID: string, value: string): SnapshotLine[] {
  return lines.map((line) => {
    if (line.asset.id !== assetID) return line
    const valueUSD = roundCents(parseDecimal(value))
    // Value-only holdings (no quantity, or no usable price) just store the valuation.
    if (line.quantity == null || line.price == null || line.price <= 0) {
      return { ...line, valueUSD, valueText: value }
    }
    const quantity = trimQuantity(valueUSD / line.price)
    return { ...line, valueUSD, valueText: value, quantity, quantityText: String(quantity) }
  })
}

export function updateLineCash(lines: SnapshotLine[], assetID: string, value: string): SnapshotLine[] {
  return lines.map((line) => {
    if (line.asset.id !== assetID) return line
    // Cash: quantity == valuation; round to cents so both match the wire.
    const amount = roundCents(parseDecimal(value))
    return {
      ...line,
      quantity: amount,
      quantityText: String(amount),
      valueUSD: amount,
      valueText: value,
    }
  })
}

// Balance-only accounts edit a single synthetic USD line; liabilities store the
// balance as a positive amount regardless of the sign typed.
export function linesWithBalance(lines: SnapshotLine[], usdAsset: Asset | undefined, value: string, liability: boolean): SnapshotLine[] {
  const amount = liability ? Math.abs(parseDecimal(value)) : parseDecimal(value)
  const valueText = liability ? value.replace(/^-/, '') : value
  const base = lines[0] ?? (usdAsset ? assetToSnapshotLine(usdAsset) : null)
  if (!base) return lines
  return [{ ...base, quantity: amount, quantityText: String(amount), valueUSD: amount, valueText }]
}

export function formatHistoryDate(date: string) {
  const [year, month, day] = date.split('-')
  return `${month}/${day}/${year}`
}
