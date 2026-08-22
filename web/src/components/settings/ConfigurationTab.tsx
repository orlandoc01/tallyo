import { useConfiguration } from '../../hooks/useConfiguration'
import { usePermissions } from '../../hooks/usePermissions'
import type { Configuration } from '../../types/graphql'
import { EmptyState } from '../common/EmptyState'
import { Card, SectionLabel } from '../common/FormControls'
import { ConfigStatus } from './ConfigFormControls'

export function ConfigurationTab() {
  const { canRead } = usePermissions()
  const canReadSettings = canRead('settings')
  const { configuration, fetching, error } = useConfiguration(canReadSettings)

  if (!canReadSettings) {
    return <EmptyState title="Settings access required" description="Your account cannot view server configuration." />
  }

  return (
    <section className="space-y-5">
      <ConfigStatus configuration={configuration} error={error} fetching={fetching} />

      {!fetching && !error && configuration ? (
        <div className="max-w-2xl">
          <RuntimeCard configuration={configuration} />
        </div>
      ) : null}
    </section>
  )
}

function RuntimeCard({ configuration }: { configuration: Configuration }) {
  return (
    <Card as="section" compact>
      <SectionLabel as="h3" className="border-b border-neutral-100 bg-neutral-50 px-4 py-3">Runtime</SectionLabel>
      <ReadOnlyRow label="Config file path" value={configuration.configFilePath} />
      <ReadOnlyRow label="Database path" value={configuration.dbPath} />
      <ReadOnlyRow label="Port" value={configuration.port} />
      <ReadOnlyRow label="Sync off" value={configuration.syncOff ? 'true' : 'false'} />
    </Card>
  )
}

function ReadOnlyRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="grid gap-1 border-b border-neutral-100 px-4 py-3 last:border-b-0 sm:grid-cols-[12rem_1fr] sm:gap-4">
      <span className="text-sm font-semibold text-neutral-700">{label}</span>
      <span className="break-all font-mono text-sm text-neutral-950">{value}</span>
    </div>
  )
}
