import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProvidersWrapper } from '../test/renderWithProviders'
import { useCashFlowFilterParams } from './useCashFlowFilterParams'
import { useSpendingFilterParams } from './useSpendingFilterParams'

describe('report filter params', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults spending breakdown to bars while allowing explicit pie', () => {
    const { result: defaultResult } = renderHook(() => useSpendingFilterParams('breakdown'), { wrapper: createProvidersWrapper({ initialEntries: ['/expenses/breakdown'] }) })
    const { result: pieResult } = renderHook(() => useSpendingFilterParams('breakdown'), { wrapper: createProvidersWrapper({ initialEntries: ['/expenses/breakdown?chart=pie'] }) })

    expect(defaultResult.current.breakdownView).toBe('bar')
    expect(pieResult.current.breakdownView).toBe('pie')
  })

  it('applies the last three yearly periods when spending trends granularity changes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 4))

    const { result } = renderHook(() => useSpendingFilterParams('trends'), { wrapper: createProvidersWrapper({ initialEntries: ['/expenses/trends'] }) })

    act(() => {
      result.current.setGranularity('YEARLY')
    })

    expect(result.current.granularity).toBe('YEARLY')
    expect(result.current.dateFrom).toBe('2024-01-01')
    expect(result.current.dateTo).toBe('2026-12-31')
  })

  it('keeps user-selected spending trend dates after the granularity default is applied', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 4))

    const { result } = renderHook(() => useSpendingFilterParams('trends'), { wrapper: createProvidersWrapper({ initialEntries: ['/expenses/trends'] }) })

    act(() => {
      result.current.setGranularity('YEARLY')
    })
    act(() => {
      result.current.setMany({ dateFrom: '2025-01-01', dateTo: '2025-12-31' })
    })

    expect(result.current.granularity).toBe('YEARLY')
    expect(result.current.dateFrom).toBe('2025-01-01')
    expect(result.current.dateTo).toBe('2025-12-31')
  })

  it('applies the last three quarterly periods when cash flow granularity changes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 4))

    const { result } = renderHook(() => useCashFlowFilterParams(), { wrapper: createProvidersWrapper({ initialEntries: ['/cash-flow'] }) })

    act(() => {
      result.current.setGranularity('QUARTERLY')
    })

    expect(result.current.granularity).toBe('QUARTERLY')
    expect(result.current.dateFrom).toBe('2025-07-01')
    expect(result.current.dateTo).toBe('2026-03-31')
  })
})
