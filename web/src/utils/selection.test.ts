import { describe, expect, it } from 'vitest'
import { nextGroupSelectedIds, nextSelectedIds, toggleSelectedIds } from './selection'

describe('selection helpers', () => {
  it('adds and removes single ids', () => {
    expect(nextSelectedIds(['a'], 'b', true, 'multi')).toEqual(['a', 'b'])
    expect(nextSelectedIds(['a', 'b'], 'a', false, 'multi')).toEqual(['b'])
    expect(nextSelectedIds(['a'], 'b', true, 'single')).toEqual(['b'])
  })

  it('applies a group selection', () => {
    expect(nextGroupSelectedIds(['a'], ['b', 'c'], true)).toEqual(['a', 'b', 'c'])
    expect(nextGroupSelectedIds(['a', 'b'], ['a'], false)).toEqual(['b'])
  })

  it('toggles a set as one unit', () => {
    expect(toggleSelectedIds(['a'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
    expect(toggleSelectedIds(['a', 'b', 'c'], ['b', 'c'])).toEqual(['a'])
    expect(toggleSelectedIds(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
    expect(toggleSelectedIds(['a'], [])).toEqual(['a'])
  })
})
