import { SORT_OPTIONS, sortFromId, sortId } from '../components/transactions/transactionFilterPresets'
import type { TransactionSort } from '../types/graphql'
import type { ParamCodec } from './urlParams'

export const DEFAULT_SORT = SORT_OPTIONS[0].sort

export const SORT_PARAM: ParamCodec<TransactionSort> = {
  key: 'sort',
  read: (params) => sortFromId(params.get('sort') ?? ''),
  write(params, sort) {
    if (sortId(sort) === SORT_OPTIONS[0].id) params.delete('sort')
    else params.set('sort', sortId(sort))
  },
}
