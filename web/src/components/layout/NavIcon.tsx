import type { LucideIcon } from 'lucide-react'

export function NavIcon({ Icon, iconClassName = 'h-5 w-5 shrink-0', needsReview }: { Icon: LucideIcon; iconClassName?: string; needsReview: boolean }) {
  return (
    <span className="relative inline-flex shrink-0">
      <Icon aria-hidden className={iconClassName} />
      {needsReview ? (
        <span aria-hidden className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-black leading-none text-white ring-2 ring-white">
          !
        </span>
      ) : null}
    </span>
  )
}
