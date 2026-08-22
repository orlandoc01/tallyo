import { act, renderHook } from '@testing-library/react'
import { useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { createProvidersWrapper } from '../test/renderWithProviders'
import { useTransactionFilterParams } from './useTransactionFilterParams'

describe('useTransactionFilterParams', () => {
  it('reads tag IDs from the URL into the transaction filter', () => {
    const { result } = renderHook(() => useTransactionFilterParams(), { wrapper: createProvidersWrapper({ initialEntries: ['/transactions?tag_ids=tag-1,tag-2'] }) })

    expect(result.current.filter).toEqual(expect.objectContaining({ tagIds: ['tag-1', 'tag-2'] }))
  })

  it('writes and clears tag IDs in the URL with the other transaction filters', () => {
    const { result } = renderHook(() => {
      const params = useTransactionFilterParams()
      const location = useLocation()
      return { ...params, locationSearch: location.search }
    }, { wrapper: createProvidersWrapper({ initialEntries: ['/transactions?q=target'] }) })

    act(() => {
      result.current.setFilter({ isHidden: false, accountIds: ['acct-1'], tagIds: ['tag-1', 'tag-2'] })
    })

    expect(result.current.locationSearch).toBe('?q=target&account_ids=acct-1&tag_ids=tag-1%2Ctag-2')

    act(() => {
      result.current.clearFilters()
    })

    expect(result.current.locationSearch).toBe('')
  })

  it('keeps untagged selected after the URL rerender', () => {
    const { result } = renderHook(() => {
      const params = useTransactionFilterParams()
      const location = useLocation()
      return { ...params, locationSearch: location.search }
    }, { wrapper: createProvidersWrapper({ initialEntries: ['/transactions'] }) })

    act(() => {
      result.current.setFilter({ isHidden: false, untagged: true })
    })

    expect(result.current.locationSearch).toBe('?untagged=1')
    expect(result.current.filter.untagged).toBe(true)
  })
})
