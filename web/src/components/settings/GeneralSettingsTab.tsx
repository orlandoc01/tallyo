import clsx from 'clsx'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import type { ElementType } from 'react'
import { useColorTheme, COLOR_THEMES } from '../../hooks/useColorTheme'
import { useIsMobile } from '../../hooks/useIsMobile'
import { usePermissions } from '../../hooks/usePermissions'
import { useTheme, type Theme } from '../../hooks/useTheme'
import { Card, SectionLabel } from '../common/FormControls'
import { GeneralTrackingSection } from './GeneralTrackingSection'
import { LayoutSection } from './LayoutSection'
import { OwnersSection } from './OwnersSection'
import { TimezoneSection } from './TimezoneSection'

const THEME_OPTIONS: { value: Theme; label: string; description: string; icon: ElementType }[] = [
  { value: 'light', label: 'Light', description: 'Always light', icon: Sun },
  { value: 'dark', label: 'Dark', description: 'Always dark', icon: Moon },
  { value: 'system', label: 'System', description: 'Match device', icon: Monitor },
]

const sectionClass = 'py-5 first:pt-0 last:pb-0'

const selectableCardClass = (selected: boolean) => clsx(
  'rounded-md border transition',
  selected ? 'border-brand-600 bg-brand-600/[0.08]' : 'border-border hover:bg-raised',
)

export function GeneralSettingsTab() {
  const { theme, setTheme } = useTheme()
  const { colorTheme, setColorTheme } = useColorTheme()
  const { canRead, canWrite } = usePermissions()
  const isMobile = useIsMobile()
  const canReadSettings = canRead('settings')
  const canWriteSettings = canWrite('settings')
  const canReadOwners = canRead('owners')

  return (
    <Card as="section" className="divide-y divide-border" padded>
      <section className={sectionClass}>
        <SectionLabel>Theme</SectionLabel>
        <div className="mt-3 grid grid-cols-3 gap-2 lg:grid-cols-[repeat(auto-fill,minmax(130px,1fr))]">
          {COLOR_THEMES.map((opt) => {
            const selected = colorTheme === opt.value
            return (
              <button
                className={clsx(selectableCardClass(selected), 'flex h-11 items-center gap-2.5 px-3 text-[13px] font-medium', selected ? 'text-text-1' : 'text-text-2')}
                key={opt.value}
                onClick={() => setColorTheme(opt.value)}
                title={opt.label}
                type="button"
              >
                <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full lg:h-5 lg:w-5" style={{ backgroundColor: opt.hex }}>
                  {selected ? <Check aria-hidden className="h-3 w-3 text-white" strokeWidth={3} /> : null}
                </span>
                <span className="truncate">{opt.label}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className={sectionClass}>
        <SectionLabel>Appearance</SectionLabel>
        <div className="mt-3 grid grid-cols-3 gap-2 lg:max-w-[520px] lg:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
          {THEME_OPTIONS.map((opt) => {
            const Icon = opt.icon
            const selected = theme === opt.value
            return (
              <button
                className={clsx(selectableCardClass(selected), 'flex flex-col items-center gap-1 px-2 py-3 text-center lg:items-start lg:p-3.5 lg:text-left')}
                key={opt.value}
                onClick={() => setTheme(opt.value)}
                type="button"
              >
                <Icon aria-hidden className={clsx('h-[18px] w-[18px]', selected ? 'text-accent' : 'text-text-muted')} strokeWidth={1.6} />
                <span className="mt-1 text-[13px] font-semibold text-text-1">{opt.label}</span>
                <span className="text-[11px] text-text-muted lg:text-xs">{opt.description}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className={sectionClass}><TimezoneSection canWriteSettings={canWriteSettings} /></section>
      {canReadSettings ? <section className={sectionClass}><GeneralTrackingSection canWriteSettings={canWriteSettings} /></section> : null}
      {isMobile ? <section className={sectionClass}><SectionLabel>Layout</SectionLabel><LayoutSection /></section> : null}
      {canReadOwners ? <section className={sectionClass}><SectionLabel>Owners</SectionLabel><OwnersSection canWriteOwners={canWrite('owners')} /></section> : null}
    </Card>
  )
}
