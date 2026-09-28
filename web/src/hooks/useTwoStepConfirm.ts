import { useEffect, useState } from 'react'

const CONFIRM_WINDOW_MS = 4000

export function useTwoStepConfirm() {
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), CONFIRM_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [confirming])
  return { confirming, arm: () => setConfirming(true), reset: () => setConfirming(false) }
}
