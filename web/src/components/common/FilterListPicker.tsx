import type { ReactNode } from 'react'

export function FilterListPicker({ children }: { children: ReactNode }) {
  return (
    <div className="max-h-80 overflow-auto pr-1">
      {children}
    </div>
  )
}
