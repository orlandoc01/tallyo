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
    <section className="space-y-3">
      <div>
        <SectionLabel>Timezone</SectionLabel>
        <p className="mt-1 text-sm text-neutral-500">Used by reports, budgets, and daily balance snapshots.</p>
      </div>

      {queryResult.error ? <ErrorState message={queryResult.error.message} /> : null}
      {mutationResult.error ? <ErrorState message={mutationResult.error.message} /> : null}

      {canWriteSettings ? (
        <SelectField className="max-w-md" disabled={queryResult.fetching || mutationResult.fetching} label="Instance timezone" onChange={(nextTimezone) => { void changeTimezone(nextTimezone) }} options={timezones} value={timezone} />
      ) : (
        <div className="max-w-md rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-sm text-neutral-700 shadow-sm">
          {queryResult.fetching ? 'Loading timezone...' : timezone}
        </div>
      )}
    </section>
  )
}

function supportedTimezones(current: string | undefined) {
  const intlWithTimezones = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
  const zones = intlWithTimezones.supportedValuesOf?.('timeZone') ?? fallbackTimezones
  const all = current && !zones.includes(current) ? [current, ...zones] : zones
  return all.slice().sort((a, b) => a.localeCompare(b))
}
