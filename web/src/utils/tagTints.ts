export type TagTint = 'blue' | 'green' | 'pink' | 'violet' | 'amber' | 'teal' | 'gray' | 'red'

export const tagTintClass: Record<TagTint, string> = {
  blue: 'border-[var(--tint-blue-border)] bg-[var(--tint-blue-bg)] text-[var(--tint-blue-text)]',
  green: 'border-[var(--tint-green-border)] bg-[var(--tint-green-bg)] text-[var(--tint-green-text)]',
  pink: 'border-[var(--tint-pink-border)] bg-[var(--tint-pink-bg)] text-[var(--tint-pink-text)]',
  violet: 'border-[var(--tint-violet-border)] bg-[var(--tint-violet-bg)] text-[var(--tint-violet-text)]',
  amber: 'border-[var(--tint-amber-border)] bg-[var(--tint-amber-bg)] text-[var(--tint-amber-text)]',
  teal: 'border-[var(--tint-teal-border)] bg-[var(--tint-teal-bg)] text-[var(--tint-teal-text)]',
  gray: 'border-[var(--tint-gray-border)] bg-[var(--tint-gray-bg)] text-[var(--tint-gray-text)]',
  red: 'border-[var(--tint-red-border)] bg-[var(--tint-red-bg)] text-[var(--tint-red-text)]',
}

export const tagTintBgClass: Record<TagTint, string> = {
  blue: 'bg-[var(--tint-blue-bg)]',
  green: 'bg-[var(--tint-green-bg)]',
  pink: 'bg-[var(--tint-pink-bg)]',
  violet: 'bg-[var(--tint-violet-bg)]',
  amber: 'bg-[var(--tint-amber-bg)]',
  teal: 'bg-[var(--tint-teal-bg)]',
  gray: 'bg-[var(--tint-gray-bg)]',
  red: 'bg-[var(--tint-red-bg)]',
}
