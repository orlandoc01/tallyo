import type { Tag } from '../../types/graphql'
import { SheetPickList } from '../common/SheetRows'

export function TagPickList({ onChange, selectedIds, tags }: { onChange: (tagIds: string[]) => void; selectedIds: string[]; tags: Tag[] }) {
  return (
    <SheetPickList
      options={tags.map((tag) => ({ id: tag.id, ariaLabel: tag.name, label: tag.name, leading: <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} /> }))}
      selectedIds={selectedIds}
      selectionMode="multi"
      onChange={onChange}
    />
  )
}
