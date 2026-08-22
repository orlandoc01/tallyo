import { createContext } from 'react'
import type { MouseEvent } from 'react'
import type { LinkProps } from 'react-router'

export interface SectionHistoryContextValue {
  peek: (section: string) => string | undefined
  stickyNavProps: (defaultTo: string, onClick?: (event: MouseEvent<HTMLAnchorElement>) => void) => Pick<LinkProps, 'to' | 'onClick'>
}

export const SectionHistoryContext = createContext<SectionHistoryContextValue | null>(null)
