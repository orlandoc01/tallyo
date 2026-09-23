import { Check } from 'lucide-react'
import type { ReactNode } from 'react'
import { Card } from './FormControls'

export function EmptyState({ action, title, description }: { action?: ReactNode; title: string; description?: string }) {
  return (
    <Card variant="dashed">
      <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-raised">
        <Check aria-hidden className="h-4 w-4 text-accent" />
      </span>
      <h2 className="mt-3 text-[15px] font-semibold text-text-1">{title}</h2>
      {description ? <p className="mx-auto mt-1 max-w-[420px] text-[13px] text-text-muted [text-wrap:pretty]">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </Card>
  )
}
