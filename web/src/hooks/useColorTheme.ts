import { useEffect, useState } from 'react'

export type ColorTheme = 'teal' | 'indigo' | 'orange' | 'azure' | 'maroon'

export const COLOR_THEMES: { value: ColorTheme; label: string; hex: string }[] = [
  { value: 'teal',   label: 'Teal',   hex: '#14b8a6' },
  { value: 'indigo', label: 'Indigo', hex: '#6366f1' },
  { value: 'orange', label: 'Orange', hex: '#f97316' },
  { value: 'azure',  label: 'Azure',  hex: '#0ea5e9' },
  { value: 'maroon', label: 'Maroon', hex: '#be123c' },
]

const COLOR_THEME_STORAGE_KEY = 'tallyo-color-theme'
const COLOR_THEME_DEFAULT: ColorTheme = 'teal'

function applyColorTheme(theme: ColorTheme) {
  const html = document.documentElement
  for (const t of COLOR_THEMES) html.classList.remove(`color-${t.value}`)
  html.classList.add(`color-${theme}`)
}

export function useColorTheme() {
  const [colorTheme, setColorThemeState] = useState<ColorTheme>(
    () => (localStorage.getItem(COLOR_THEME_STORAGE_KEY) as ColorTheme) ?? COLOR_THEME_DEFAULT,
  )

  useEffect(() => {
    applyColorTheme(colorTheme)
  }, [colorTheme])

  function setColorTheme(next: ColorTheme) {
    localStorage.setItem(COLOR_THEME_STORAGE_KEY, next)
    setColorThemeState(next)
  }

  return { colorTheme, setColorTheme }
}
