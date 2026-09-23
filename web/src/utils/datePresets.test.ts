import { describe, expect, it } from 'vitest'
import { datePresetHint, presetById, selectedDatePreset, type DatePreset } from './datePresets'

const presets: ReadonlyArray<DatePreset<'A' | 'B'>> = [
  { id: 'A', label: 'A', range: () => ({ dateFrom: '2026-01-01', dateTo: '2026-01-31' }) },
  { id: 'B', label: 'B', range: () => ({}) },
]

describe('datePresets', () => {
  it('formats hints and matches ranges against presets', () => {
    expect(datePresetHint({ dateFrom: '2026-01-01', dateTo: '2026-01-31' })).toBe('Jan 1 – Jan 31')
    expect(datePresetHint({})).toBe('All')
    expect(selectedDatePreset(presets, { dateFrom: '2026-01-01', dateTo: '2026-01-31' }, new Date())?.id).toBe('A')
    expect(selectedDatePreset(presets, {}, new Date())?.id).toBe('B')
    expect(selectedDatePreset(presets, { dateFrom: '2026-02-01' }, new Date())).toBeUndefined()
  })
})

describe('presetById', () => {
  it('returns the preset or throws for an unknown id', () => {
    expect(presetById(presets, 'B').label).toBe('B')
    expect(() => presetById(presets, 'C' as 'A')).toThrow('Unknown date preset: C')
  })
})
