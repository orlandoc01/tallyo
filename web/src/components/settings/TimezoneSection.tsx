import { useMemo } from 'react'
import { useMutation, useQuery } from 'urql'

import { refreshAccessToken } from '../../auth/tokenStore'
import { UPDATE_CONFIGURATION_MUTATION } from '../../graphql/mutations'
import { INSTANCE_TIMEZONE_QUERY } from '../../graphql/queries'
import type { Configuration, UpdateConfigurationInput } from '../../types/graphql'
import { ErrorState } from '../common/ErrorState'
import { SectionLabel, SelectField } from '../common/FormControls'

const fallbackTimezones = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'UTC',
]

export function TimezoneSection({ canWriteSettings }: { canWriteSettings: boolean }) {
  const [queryResult, reexecuteQuery] = useQuery<{ instanceTimezone: string }>({ query: INSTANCE_TIMEZONE_QUERY })
  const [mutationResult, updateConfiguration] = useMutation<
    { updateConfiguration: { configuration: Configuration } },
    { input: UpdateConfigurationInput }
  >(UPDATE_CONFIGURATION_MUTATION)
  const timezones = useMemo(() => supportedTimezones(queryResult.data?.instanceTimezone), [queryResult.data?.instanceTimezone])
  const timezone = queryResult.data?.instanceTimezone ?? 'America/New_York'

  async function changeTimezone(nextTimezone: string) {
    const result = await updateConfiguration({ input: { locale: { timezone: nextTimezone } } })
    if (!result.error) {
      await refreshAccessToken()
      reexecuteQuery({ requestPolicy: 'network-only' })
    }
  }

  return (
    <div>
      <SectionLabel>Timezone</SectionLabel>
      <p className="mt-0.5 text-xs text-text-muted">Used by reports, budgets, and daily balance snapshots.</p>

      {queryResult.error ? <ErrorState message={queryResult.error.message} /> : null}
      {mutationResult.error ? <ErrorState message={mutationResult.error.message} /> : null}

      {canWriteSettings ? (
        <SelectField className="mt-3.5 max-w-[360px]" disabled={queryResult.fetching || mutationResult.fetching} label="Instance timezone" onChange={(nextTimezone) => { void changeTimezone(nextTimezone) }} options={timezones} value={timezone} />
      ) : (
        <div className="mt-3.5 max-w-[360px]">
          <span className="text-xs text-text-muted">Instance timezone</span>
          <div className="mt-1 flex h-9 items-center rounded-md border border-border-strong bg-surface px-3 text-[13px] text-text-1 dark:bg-bg lg:h-8">
            {queryResult.fetching ? 'Loading timezone...' : timezone}
          </div>
        </div>
      )}
    </div>
  )
}

function supportedTimezones(current: string | undefined) {
  const intlWithTimezones = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
  const zones = intlWithTimezones.supportedValuesOf?.('timeZone') ?? fallbackTimezones
  const all = current && !zones.includes(current) ? [current, ...zones] : zones
  return all.slice().sort((a, b) => a.localeCompare(b))
}
