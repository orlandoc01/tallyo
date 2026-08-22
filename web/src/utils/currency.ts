export function formatCurrencyCompact(amount: number): string {
  const abs = Math.abs(amount)
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (abs >= 1_000) return `$${(abs / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return `$${abs.toFixed(0)}`
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount))
}

const preciseUnitPriceFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: 6,
})
const scientificUnitPriceFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumSignificantDigits: 6,
  notation: 'scientific',
})

export function formatUnitPrice(amount: number) {
  const magnitude = Math.abs(amount)
  if (magnitude !== 0 && (magnitude < 1e-6 || magnitude >= 1e12)) {
    return scientificUnitPriceFormatter.format(magnitude)
  }
  if (magnitude !== 0 && magnitude < 0.01) {
    return preciseUnitPriceFormatter.format(magnitude)
  }
  return formatCurrency(magnitude)
}

export function formatTransactionAmount(amount: number) {
  return amount < 0 ? `+${formatCurrency(amount)}` : formatCurrency(amount)
}

export function formatSignedCurrency(amount: number) {
  if (amount === 0) {
    return formatCurrency(0)
  }

  return `${amount > 0 ? '' : '-'}${formatCurrency(amount)}`
}

export function formatPercentChange(value: number) {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(1)}%`
}

export function transactionAmountClassName(amount: number) {
  return amount < 0 ? 'text-emerald-700' : 'text-neutral-950'
}
