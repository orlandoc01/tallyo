import { format } from 'date-fns'
import { parseLocalDate } from './dates'

export interface LocalDateRange { dateFrom?: string; dateTo?: string }

export interface DatePreset<Id extends string> {
  id: Id
  label: string
  range: (now: Date) => LocalDateRange
}

export function datePresetHint(range: LocalDateRange) {
  const short = (value: string) => format(parseLocalDate(value), 'MMM d')
  return range.dateFrom && range.dateTo ? `${short(range.dateFrom)} – ${short(range.dateTo)}` : 'All'
}

export function presetById<Id extends string>(presets: ReadonlyArray<DatePreset<Id>>, id: Id): DatePreset<Id> {
  const preset = presets.find((candidate) => candidate.id === id)
  if (!preset) throw new Error(`Unknown date preset: ${id}`)
  return preset
}

export function selectedDatePreset<Id extends string>(presets: ReadonlyArray<DatePreset<Id>>, range: LocalDateRange, now: Date): DatePreset<Id> | undefined {
  return presets.find((preset) => {
    const candidate = preset.range(now)
    return candidate.dateFrom === range.dateFrom && candidate.dateTo === range.dateTo
  })
}
