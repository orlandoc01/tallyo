import { SearchableGroupedFilterCheckboxList } from '../common/SearchableFilterCheckboxList'
import { categoryFilterOptions } from '../../utils/categoryFilter'
import type { CategoryGroup } from '../../types/graphql'

export function CategoryChecklist({
  categoryGroups,
  onChange,
  selectedCategoryIds,
}: {
  categoryGroups: CategoryGroup[]
  onChange: (categoryIds: string[]) => void
  selectedCategoryIds: string[]
}) {
  return (
    <SearchableGroupedFilterCheckboxList
      emptyMessage="No categories found."
      groups={categoryFilterOptions(categoryGroups)}
      optionsClassName="space-y-4"
      searchLabel="Category search"
      searchPlaceholder="Search categories"
      selectAllAriaLabel="Select all categories"
      selectedIds={selectedCategoryIds}
      onChange={onChange}
    />
  )
}

export function MobileCategoryChecklist(props: Parameters<typeof CategoryChecklist>[0]) {
  return <CategoryChecklist {...props} />
}
