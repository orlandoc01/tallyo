export function getAssetPriceValidation(trackingMultiplier: string, forcedUsdPrice: string) {
  const trackingMultiplierValue = Number(trackingMultiplier)
  const forcedUsdPriceValue = Number(forcedUsdPrice)
  return {
    trackingMultiplierValue,
    isTrackingMultiplierValid: trackingMultiplier.trim() !== '' && Number.isFinite(trackingMultiplierValue) && trackingMultiplierValue > 0,
    forcedUsdPriceValue,
    isForcedUsdPriceValid: forcedUsdPrice.trim() !== '' && Number.isFinite(forcedUsdPriceValue),
  }
}

// Custom Tracking requires a nonblank ticker that differs from the asset's
// own identifier (case-insensitively) - the same self-reference the backend
// normalizes away. One message covers both failure modes per design: it's
// actionable either way ("Use a different ticker or turn off Custom Tracking").
export function getTrackingTickerError(customTracking: boolean, trackingTicker: string, identifier: string): string | null {
  if (!customTracking) return null
  const trimmedTicker = trackingTicker.trim()
  const trimmedIdentifier = identifier.trim()
  if (!trimmedTicker || trimmedTicker.toUpperCase() === trimmedIdentifier.toUpperCase()) {
    return 'Use a different ticker or turn off Custom Tracking.'
  }
  return null
}
