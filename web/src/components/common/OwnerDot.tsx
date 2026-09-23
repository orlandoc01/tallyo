import { ownerBadgeClassName } from '../../utils/colors'

export function OwnerDot({ name }: { name: string }) {
  return <span aria-hidden className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${ownerBadgeClassName(name)}`}>{name.charAt(0).toUpperCase()}</span>
}
