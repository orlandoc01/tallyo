import { useQuery, type UseQueryArgs, type UseQueryExecute, type UseQueryState } from 'urql'
import type { AnyVariables } from '@urql/core'

const EMPTY_ITEMS = Object.freeze([]) as unknown as never[]

type QueryBase = {
  fetching: boolean
  error: UseQueryState['error']
  refetch: UseQueryExecute
}

type ListQueryData<T> = Record<string, { items: T[] }>
type EntityQueryData<T> = Record<string, T>

export function emptyList<T>() {
  return EMPTY_ITEMS as T[]
}

export function useListQuery<T, Variables extends AnyVariables = void>(
  args: UseQueryArgs<Variables, ListQueryData<T>>,
  field: string,
): QueryBase & { items: T[] } {
  const [result, refetch] = useQuery<ListQueryData<T>, Variables>(args)

  return {
    items: result.data?.[field]?.items ?? emptyList<T>(),
    fetching: result.fetching,
    error: result.error,
    refetch,
  }
}

export function useEntityQuery<T, Variables extends AnyVariables = void>(
  args: UseQueryArgs<Variables, EntityQueryData<T>>,
  field: string,
): QueryBase & { data: T | undefined } {
  const [result, refetch] = useQuery<EntityQueryData<T>, Variables>(args)

  return {
    data: result.data?.[field],
    fetching: result.fetching,
    error: result.error,
    refetch,
  }
}
