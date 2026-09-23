import clsx from 'clsx'
import { useState } from 'react'
import { tagTintBgClass, type TagTint } from '../../utils/tagTints'

const sizeClass = { 28: 'h-7 w-7 text-xs', 40: 'h-10 w-10 text-base' } as const

type AvatarSize = keyof typeof sizeClass

export function Avatar({ name, size = 28, src, tint = 'gray' }: {
  name: string
  size?: AvatarSize
  src?: string | null
  tint?: TagTint
}) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null)
  const base = clsx('flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold', sizeClass[size])

  if (src && brokenSrc !== src) {
    return <img alt={name} className={clsx(base, 'bg-surface object-contain')} onError={() => setBrokenSrc(src)} src={src} />
  }
  return (
    <span aria-hidden className={clsx(base, tagTintBgClass[tint], 'text-text-1')}>
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

export function EmojiAvatar({ emoji, tint }: { emoji: string; tint: TagTint }) {
  return (
    <span aria-hidden className={clsx('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-base', tagTintBgClass[tint])}>
      {emoji}
    </span>
  )
}
