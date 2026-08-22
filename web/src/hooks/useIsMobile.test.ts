import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useIsMobile } from './useIsMobile'

describe('useIsMobile', () => {
  it('returns false when matchMedia reports desktop', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      media: '(max-width: 1023px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
  })

  it('returns true when matchMedia reports mobile', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(max-width: 1023px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })

  it('returns false when matchMedia is not available', () => {
    const originalMatchMedia = window.matchMedia
    // @ts-expect-error — removing matchMedia for test
    delete window.matchMedia

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    window.matchMedia = originalMatchMedia
  })

  it('responds to matchMedia change events', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlers: Array<(event: any) => void> = []
    const addEventListener = vi.fn((_event: string, handler: (...args: unknown[]) => void) => {
      handlers.push(handler)
    })
    const removeEventListener = vi.fn()
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: false,
      addEventListener,
      removeEventListener,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      media: '(max-width: 1023px)',
      onchange: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)

    act(() => {
      handlers.forEach((h) => h({ matches: true }))
    })

    await waitFor(() => expect(result.current).toBe(true))
  })
})
