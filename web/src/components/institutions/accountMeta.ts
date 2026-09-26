import type { Account } from '../../types/graphql'
import { formatDatetimeAsLocalDate } from '../../utils/dates'
import type { SheetKeyValue } from '../common/SheetHero'

export function accountMetaRows(account: Account, institution: string): SheetKeyValue[] {
  return [
    ...(account.typeLocked ? [] : [{ k: 'Institution', v: institution }]),
    { k: 'Created', v: formatDatetimeAsLocalDate(account.createdAt) },
    { k: 'Updated', v: formatDatetimeAsLocalDate(account.updatedAt) },
  ]
}
