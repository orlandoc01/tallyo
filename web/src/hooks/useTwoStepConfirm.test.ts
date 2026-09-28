import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTwoStepConfirm } from './useTwoStepConfirm'

describe('useTwoStepConfirm', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('arms, auto-disarms after 4 s, and resets early without a stale timer firing', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useTwoStepConfirm())
    expect(result.current.confirming).toBe(false)

    act(() => result.current.arm())
    expect(result.current.confirming).toBe(true)
    act(() => { vi.advanceTimersByTime(3999) })
    expect(result.current.confirming).toBe(true)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.confirming).toBe(false)

    act(() => result.current.arm())
    act(() => { vi.advanceTimersByTime(1000) })
    act(() => result.current.reset())
    expect(result.current.confirming).toBe(false)
    act(() => result.current.arm())
    act(() => { vi.advanceTimersByTime(3500) })
    expect(result.current.confirming).toBe(true)
  })
})
