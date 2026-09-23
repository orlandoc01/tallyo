import clsx from 'clsx'
import type { MouseEvent, ReactNode, Ref } from 'react'
import type { Category } from '../../types/graphql'
import { categoryTint } from '../../utils/categoryTint'
import { tagTintClass, type TagTint } from '../../utils/tagTints'

const tagClass = 'inline-flex items-center gap-1 whitespace-nowrap rounded border px-2 py-0.5 text-xs'
const badgeClass = 'inline-flex items-center whitespace-nowrap rounded border px-1.5 text-[10px] font-semibold leading-4 tracking-[0.5px]'

export function Tag({ children, className, size = 'md', tint = 'gray' }: { children: ReactNode; className?: string; size?: 'md' | 'badge'; tint?: TagTint }) {
  return <span className={clsx(size === 'badge' ? badgeClass : tagClass, tagTintClass[tint], className)}>{children}</span>
}

export function CategoryTag({ category, className, disabled = false, label, onClick, ref }: {
  category: Pick<Category, 'id' | 'emoji' | 'name'>
  className?: string
  disabled?: boolean
  label?: string
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
  ref?: Ref<HTMLButtonElement>
}) {
  const content = <><span aria-hidden>{category.emoji}</span><span className="truncate">{label ?? category.name}</span></>
  const classes = clsx(tagClass, 'max-w-full', tagTintClass[categoryTint(category)], className)
  if (!onClick) return <span className={classes}>{content}</span>
  return (
    <button className={clsx(classes, 'disabled:cursor-not-allowed disabled:opacity-60')} disabled={disabled} onClick={onClick} ref={ref} type="button">
      {content}
    </button>
  )
}

export function TickerChip({ children }: { children: string }) {
  return (
    <span aria-hidden className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[9px] font-semibold uppercase text-accent lg:h-[22px] lg:w-[22px]">
      {children.slice(0, 4)}
    </span>
  )
}
