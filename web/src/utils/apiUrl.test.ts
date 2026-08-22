import { describe, expect, it } from 'vitest'
import { getApiBaseUrl } from './apiUrl'

describe('getApiBaseUrl', () => {
  it('returns origin when no VITE_API_URL', () => {
    const original = import.meta.env.VITE_API_URL
    import.meta.env.VITE_API_URL = ''
    expect(getApiBaseUrl()).toBe(window.location.origin)
    import.meta.env.VITE_API_URL = original
  })

  it('trims configured GraphQL path', () => {
    const original = import.meta.env.VITE_API_URL
    import.meta.env.VITE_API_URL = 'https://api.example.test/query'
    expect(getApiBaseUrl()).toBe('https://api.example.test')
    import.meta.env.VITE_API_URL = original
  })
})
