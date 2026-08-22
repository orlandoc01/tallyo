import { CONFIGURATION_QUERY } from '../graphql/queries'
import type { Configuration } from '../types/graphql'
import { useEntityQuery } from './useListQuery'

export function useConfiguration(enabled: boolean) {
  const { data: configuration, ...result } = useEntityQuery<Configuration>({ query: CONFIGURATION_QUERY, pause: !enabled }, 'configuration')
  return { ...result, configuration }
}
