import { useId, useState } from 'react'
import { SearchInput } from './FormControls'
import { MobileFilterFooter } from './MobileFilterFooter'
import { MobileSheet } from './MobileFilterDropdown'
import { SheetPickList } from './SheetRows'

const SEARCH_THRESHOLD = 12

export function PickerSheet<T extends string>({ onChange, onClose, options, title, value }: {
  onChange: (value: T) => void
  onClose: () => void
  options: ReadonlyArray<{ id: T; label: string }>
  title: string
  value: T
}) {
  const labelledBy = useId()
  const [search, setSearch] = useState('')
  const normalized = search.trim().toLowerCase()
  const visible = normalized ? options.filter((option) => option.label.toLowerCase().includes(normalized)) : options
  return (
    <MobileSheet
      footer={<MobileFilterFooter primaryLabel="Cancel" primaryVariant="secondary" onPrimary={onClose} />}
      hideClose
      labelledBy={labelledBy}
      maxHeight="84%"
      onClose={onClose}
      title={title}
    >
      {options.length > SEARCH_THRESHOLD ? (
        <div className="sticky top-0 z-[2] bg-surface pb-2">
          <SearchInput ariaLabel={`Search ${title.toLowerCase()}`} onChange={setSearch} placeholder={`Search ${title.toLowerCase()}`} value={search} />
        </div>
      ) : null}
      {visible.length === 0 ? <p className="py-3 text-[13px] text-text-muted">No matches.</p> : null}
      <SheetPickList<T> options={visible} selectedIds={[value]} variant="sheet" onChange={([id]) => { onChange(id); onClose() }} />
    </MobileSheet>
  )
}
