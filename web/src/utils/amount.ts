/** Formats an optional amount for a controlled number input (`''` when unset). */
export function amountToInputValue(value?: number | null): string {
  return value == null ? '' : String(value)
}

/** Parses a number input back to a finite number, or `undefined` when blank/invalid. */
export function parseOptionalAmount(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const standardQuantityFormatter = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 8 })
const scientificQuantityFormatter = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6, notation: 'scientific' })

export function formatQuantity(quantity: number) {
  const magnitude = Math.abs(quantity)
  const formatter = magnitude !== 0 && (magnitude < 1e-6 || magnitude >= 1e12)
    ? scientificQuantityFormatter
    : standardQuantityFormatter
  return formatter.format(quantity)
}
