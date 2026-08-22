import { useCallback, useEffect, useRef } from 'react'

export const LAST_ACTIVITY_KEY = 'tallyo-last-activity'
export const IDLE_TIMEOUT_MS = 15 * 60 * 1000
export const IDLE_WARNING_MS = 14 * 60 * 1000

export function isPastIdleTimeout(now = Date.now()) {
  const last = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || '0')
  return last > 0 && now - last > IDLE_TIMEOUT_MS
}

export function markActivity(now = Date.now()) {
  localStorage.setItem(LAST_ACTIVITY_KEY, String(now))
}

export function useIdleTimeout({ enabled, onWarn, onIdle }: { enabled: boolean; onWarn: () => void; onIdle: () => void }) {
  const warnedRef = useRef(false)
  const onWarnRef = useRef(onWarn)
  const onIdleRef = useRef(onIdle)
  onWarnRef.current = onWarn
  onIdleRef.current = onIdle

  const reset = useCallback(() => {
    warnedRef.current = false
    markActivity()
  }, [])

  useEffect(() => {
    if (!enabled) return
    if (!localStorage.getItem(LAST_ACTIVITY_KEY)) reset()
    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'] as const
    const onActivity = () => reset()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') reset()
    }
    activityEvents.forEach((event) => window.addEventListener(event, onActivity, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - Number(localStorage.getItem(LAST_ACTIVITY_KEY) || '0')
      if (elapsed >= IDLE_TIMEOUT_MS) {
        onIdleRef.current()
      } else if (elapsed >= IDLE_WARNING_MS && !warnedRef.current) {
        warnedRef.current = true
        onWarnRef.current()
      }
    }, 1000)
    return () => {
      activityEvents.forEach((event) => window.removeEventListener(event, onActivity))
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(interval)
    }
  }, [enabled, reset])

  return reset
}
