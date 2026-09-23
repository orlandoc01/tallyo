import type { Config } from 'tailwindcss'
import colors from 'tailwindcss/colors'

const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        neutral: colors.stone,
        brand: {
          50:  'rgb(var(--brand-50)  / <alpha-value>)',
          100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)',
          300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)',
          500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)',
          700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)',
          900: 'rgb(var(--brand-900) / <alpha-value>)',
        },
        paper: token('bg'),
        bg: token('bg'),
        'bg-deep': token('bg-deep'),
        surface: token('surface'),
        'surface-2': token('surface-2'),
        raised: token('raised'),
        'raised-nav': token('raised-nav'),
        hover: token('hover'),
        border: token('border'),
        'border-strong': token('border-strong'),
        'border-emph': token('border-emph'),
        handle: token('handle'),
        text: {
          1: token('text-1'),
          2: token('text-2'),
          3: token('text-3'),
          muted: token('text-muted'),
          faint: token('text-faint'),
        },
        positive: token('positive'),
        negative: token('negative'),
        warning: token('warning'),
        'chart-line': token('chart-line'),
        accent: token('accent-text'),
        'accent-hover': token('accent-hover'),
      },
      backgroundColor: {
        overlay: 'var(--overlay)',
      },
      boxShadow: {
        dropdown: '0 8px 24px rgba(0,0,0,.45)',
        modal: '0 8px 32px rgba(0,0,0,.5)',
        sheet: '0 -8px 32px rgba(0,0,0,.5)',
        tooltip: '0 4px 12px rgba(0,0,0,.4)',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
