import clsx from 'clsx'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import type { ElementType } from 'react'
import { useColorTheme, COLOR_THEMES } from '../../hooks/useColorTheme'
import { useIsMobile } from '../../hooks/useIsMobile'
import { usePermissions } from '../../hooks/usePermissions'
import { useTheme, type Theme } from '../../hooks/useTheme'
import { SectionLabel } from '../common/FormControls'
import { GeneralTrackingSection } from './GeneralTrackingSection'
import { LayoutSection } from './LayoutSection'
import { OwnersSection } from './OwnersSection'
import { TimezoneSection } from './TimezoneSection'

const THEME_OPTIONS: { value: Theme; label: string; description: string; icon: ElementType }[] = [
  { value: 'light', label: 'Light', description: 'Always light', icon: Sun },
  { value: 'dark', label: 'Dark', description: 'Always dark', icon: Moon },
  { value: 'system', label: 'System', description: 'Match device', icon: Monitor },
]

export function GeneralSettingsTab() {
  const { theme, setTheme } = useTheme()
  const { colorTheme, setColorTheme } = useColorTheme()
  const { canRead, canWrite } = usePermissions()
  const isMobile = useIsMobile()
  const canReadSettings = canRead('settings')
  const canWriteSettings = canWrite('settings')
  const canReadOwners = canRead('owners')

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionLabel>Theme</SectionLabel>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {COLOR_THEMES.map((opt) => {
            const selected = colorTheme === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setColorTheme(opt.value)}
                className={clsx(
                  'flex flex-col items-center gap-2 rounded-xl border py-3 text-center transition',
                  selected ? 'border-neutral-300 bg-white shadow-sm' : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50',
                )}
                title={opt.label}
              >
                <span className="relative flex h-7 w-7 items-center justify-center rounded-full" style={{ backgroundColor: opt.hex }}>
                  {selected && <Check className="h-4 w-4 text-white" strokeWidth={2.5} />}
                </span>
                <span className={clsx('text-xs font-semibold', selected ? 'text-neutral-900' : 'text-neutral-500')}>{opt.label}</span>
              </button>
            )
          })}
        </div>
      </section>

      <div className="border-t border-neutral-200" />

      <section className="space-y-3">
        <SectionLabel>Appearance</SectionLabel>
        <div className="grid max-w-md grid-cols-3 gap-3">
          {THEME_OPTIONS.map((opt) => {
            const Icon = opt.icon
            const selected = theme === opt.value
            return (
              <button
                className={clsx(
                  'flex flex-col items-center gap-2 rounded-xl border px-3 py-4 text-center transition',
                  selected ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500 text-brand-700' : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50',
                )}
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                type="button"
              >
                <Icon className="h-5 w-5" />
                <span className="text-sm font-semibold">{opt.label}</span>
                <span className="text-xs text-neutral-500">{opt.description}</span>
              </button>
            )
          })}
        </div>
      </section>

      <div className="border-t border-neutral-200" />
      <TimezoneSection canWriteSettings={canWriteSettings} />
      <div className="border-t border-neutral-200" />

      {canReadSettings ? <><GeneralTrackingSection canWriteSettings={canWriteSettings} /><div className="border-t border-neutral-200" /></> : null}
      {isMobile ? <><section className="space-y-3"><SectionLabel>Layout</SectionLabel><LayoutSection /></section><div className="border-t border-neutral-200" /></> : null}
      {canReadOwners ? <><section className="space-y-3"><SectionLabel>Owners</SectionLabel><OwnersSection canWriteOwners={canWrite('owners')} /></section><div className="border-t border-neutral-200" /></> : null}
    </div>
  )
}
