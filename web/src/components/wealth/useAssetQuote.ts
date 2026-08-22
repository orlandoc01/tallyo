import { useRef, useState } from 'react'
import { useClient } from 'urql'
import { ASSET_QUOTE_QUERY } from '../../graphql/queries'

type AssetQuote = {
  price: number
  asOf: string
}

// A monotonic request ID guards against a slow response for ticker A landing
// after the user has already typed ticker B, turned Custom Tracking off, or
// changed asset type: clearQuote() bumps the ID, so a completion whose ID is
// no longer current is dropped instead of applying a stale price/multiplier.
export function useAssetQuote() {
  const client = useClient()
  const requestId = useRef(0)
  const [isQuoting, setIsQuoting] = useState(false)
  const [quote, setQuote] = useState<AssetQuote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)

  function clearQuote() {
    requestId.current += 1
    setIsQuoting(false)
    setQuote(null)
    setQuoteError(null)
  }

  async function verifyTicker(ticker: string) {
    const trimmedTicker = ticker.trim()
    if (!trimmedTicker) return null

    const thisRequestId = ++requestId.current
    setIsQuoting(true)
    setQuote(null)
    setQuoteError(null)
    const result = await client
      .query<{ assetQuote: { priceUSD: number; asOf: string } }>(ASSET_QUOTE_QUERY, { ticker: trimmedTicker })
      .toPromise()

    if (thisRequestId !== requestId.current) return null

    setIsQuoting(false)
    if (result.error || !result.data?.assetQuote) {
      setQuoteError('Could not fetch price')
      return null
    }

    const nextQuote = { price: result.data.assetQuote.priceUSD, asOf: result.data.assetQuote.asOf }
    setQuote(nextQuote)
    return nextQuote
  }

  return { clearQuote, isQuoting, quote, quoteError, verifyTicker }
}
