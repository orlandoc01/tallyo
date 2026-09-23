import { describe, expect, it } from 'vitest'
import { categoryTint } from './categoryTint'

describe('categoryTint', () => {
  it('is deterministic per category id', () => {
    expect(categoryTint({ id: '17' })).toBe(categoryTint({ id: '17' }))
    expect(categoryTint({ id: '17' })).not.toBe('gray')
  })

  it('maps the uncategorized id to gray', () => {
    expect(categoryTint({ id: '0' })).toBe('gray')
  })
})
