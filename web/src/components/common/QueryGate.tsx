import type { ReactNode } from 'react'

import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { LoadingSpinner } from './LoadingSpinner'

export function QueryGate({
  children,
  data,
  empty,
  emptyAction,
  emptyDescription,
  emptyTitle,
  error,
  errorPrefix,
  fetching,
  loadingLabel,
  onRetry,
}: {
  children?: ReactNode
  data?: unknown
  empty: boolean
  emptyAction?: ReactNode
  emptyDescription?: string
  emptyTitle: string
  error?: { message: string }
  errorPrefix?: string
  fetching: boolean
  loadingLabel?: string
  onRetry?: () => void
}) {
  if (fetching && data === undefined) return <LoadingSpinner label={loadingLabel} />
  if (error) return <ErrorState message={errorPrefix ? `${errorPrefix}: ${error.message}` : error.message} onRetry={onRetry} />
  if (empty) return <EmptyState action={emptyAction} title={emptyTitle} description={emptyDescription} />
  return <>{children}</>
}
