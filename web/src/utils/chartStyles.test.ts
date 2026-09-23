import { describe, expect, it } from 'vitest'
import { clampTooltipX } from './chartStyles'

describe('clampTooltipX', () => {
  it('keeps the tooltip between 15% and 85% of the width', () => {
    expect(clampTooltipX(10, 400)).toBe(60)
    expect(clampTooltipX(200, 400)).toBe(200)
    expect(clampTooltipX(395, 400)).toBe(340)
  })
})
