import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDLE_TIMEOUT_MS, IDLE_WARNING_MS, LAST_ACTIVITY_KEY, isPastIdleTimeout, markActivity, useIdleTimeout } from './useIdleTimeout'

describe('useIdleTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
    localStorage.clear()
  })

  it('warns before idling and idles after timeout', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const onWarn = vi.fn()
    const onIdle = vi.fn()

    renderHook(() => useIdleTimeout({ enabled: true, onWarn, onIdle }))

    act(() => { vi.advanceTimersByTime(IDLE_WARNING_MS) })
    expect(onWarn).toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(IDLE_TIMEOUT_MS - IDLE_WARNING_MS) })
    expect(onIdle).toHaveBeenCalled()
  })

  it('tracks persisted last activity', () => {
    markActivity(1000)

    expect(localStorage.getItem(LAST_ACTIVITY_KEY)).toBe('1000')
    expect(isPastIdleTimeout(1000 + IDLE_TIMEOUT_MS + 1)).toBe(true)
  })
})
