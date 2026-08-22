import { Landmark } from 'lucide-react'
import type { Account } from '../../types/graphql'
import { formatAccountType } from '../../utils/accountSubtypes'
import { Card } from '../common/FormControls'
import { ManualAccountBadge } from './ManualAccountBadge'
import { RowIconAvatar } from './RowIconAvatar'

export function ManualAccountRow({ account, onClick }: { account: Account; onClick: (account: Account) => void }) {
  return (
    <Card as="article">
      <button className="flex w-full flex-wrap items-center justify-between gap-4 px-6 py-5 text-left" onClick={() => onClick(account)} type="button">
        <div className="flex items-center gap-4">
          <RowIconAvatar color="brand" icon={Landmark} />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-neutral-950">{account.name}</h2>
              <ManualAccountBadge />
            </div>
            <p className="text-sm text-neutral-500">
              {formatAccountType(account.type)}
              {account.subtype ? ` - ${account.subtype}` : ''}
            </p>
            <p className="mt-1 text-xs text-neutral-400">
              Manual account owned by {account.owner.name}
              {account.closed ? ' (CLOSED)' : ''}
              {account.hidden ? ' (HIDDEN)' : ''}
            </p>
          </div>
        </div>
      </button>
    </Card>
  )
}
