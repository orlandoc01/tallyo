import { getTrackingTickerError } from './assetPriceValidation'
import type { useAssetQuote } from './useAssetQuote'

type AssetSecurityDraft = {
  customTracking: boolean
  forcePrice: boolean
  forcedUsdPrice: string
  trackingMultiplier: string
  trackingTicker: string
}

type AssetQuoteState = Pick<ReturnType<typeof useAssetQuote>, 'isQuoting' | 'quote' | 'quoteError'>

export type AssetSecurityForm = {
  canEdit: boolean
  draft: AssetSecurityDraft
  handleVerifyTicker: () => void
  quoteState: AssetQuoteState
  setCustomTracking: (customTracking: boolean) => void
  setTrackingTicker: (trackingTicker: string) => void
  trackingTickerError: string | null
  updateDraft: (draft: Partial<AssetSecurityDraft>) => void
  verifyDisabled: boolean
}

// Changing the tracked ticker (or turning tracking off) invalidates any quote shown for it.
export function securityTrackingControls({ canEdit, draft, quoteState, updateDraft }: {
  canEdit: boolean
  draft: AssetSecurityDraft & { identifier: string }
  quoteState: AssetQuoteState & { clearQuote: () => void }
  updateDraft: (draft: Partial<AssetSecurityDraft>) => void
}): Pick<AssetSecurityForm, 'setCustomTracking' | 'setTrackingTicker' | 'trackingTickerError' | 'verifyDisabled'> {
  return {
    setCustomTracking(customTracking) {
      updateDraft({ customTracking })
      quoteState.clearQuote()
    },
    setTrackingTicker(trackingTicker) {
      updateDraft({ trackingTicker })
      quoteState.clearQuote()
    },
    trackingTickerError: getTrackingTickerError(draft.customTracking, draft.trackingTicker, draft.identifier),
    verifyDisabled: quoteState.isQuoting || !canEdit || !draft.trackingTicker.trim(),
  }
}
