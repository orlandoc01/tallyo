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
    <section className="space-y-3">
      <ConfigStatus configuration={configuration} error={error} fetching={fetching} />

      {!fetching && !error && configuration ? <RuntimeCard configuration={configuration} /> : null}
    </section>
  )
}

function RuntimeCard({ configuration }: { configuration: Configuration }) {
  return (
    <Card as="section" className="max-w-[760px]">
      <SectionLabel as="h3" className="flex h-11 items-center px-4">Runtime</SectionLabel>
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
    <div className="grid h-11 grid-cols-[minmax(140px,200px)_minmax(0,1fr)] items-center gap-3 border-t border-border px-4">
      <span className="text-[13px] text-text-muted">{label}</span>
      <span className="truncate font-mono text-xs text-text-1" title={value}>{value}</span>
    </div>
  )
}
