import { describe, expect, it } from 'vitest'
import { chartPalette, colorForCategory } from './colors'

describe('category colors', () => {
  it('maps a category id to a stable palette color', () => {
    expect(colorForCategory(42)).toBe(colorForCategory(42))
    expect(chartPalette).toContain(colorForCategory(42))
  })
})
