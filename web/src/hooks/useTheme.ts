import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'tallyo-theme'

function resolvedIsDark(theme: Theme): boolean {
  if (theme === 'dark') return true
  if (theme === 'light') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', resolvedIsDark(theme))
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(
    () => (localStorage.getItem(STORAGE_KEY) as Theme) ?? 'system',
  )
  const [isDark, setIsDark] = useState(() =>
    resolvedIsDark((localStorage.getItem(STORAGE_KEY) as Theme) ?? 'system'),
  )

  useEffect(() => {
    const dark = resolvedIsDark(theme)
    setIsDark(dark)
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    /* v8 ignore next 4 -- @preserve */
    const handler = () => {
      setIsDark(mq.matches)
      applyTheme('system')
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  function setTheme(next: Theme) {
    localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
  }

  return { theme, setTheme, isDark }
}
