import type { CategoryGroup } from '../types/graphql'

// Shapes category groups into the option model consumed by GroupedFilterCheckboxList.
export function categoryFilterOptions(categoryGroups: CategoryGroup[]) {
  return categoryGroups.map((group) => ({
    id: group.id,
    label: `${group.emoji} ${group.name}`,
    ariaLabel: group.name,
    searchText: group.name,
    summary: `${group.categories.length} ${group.categories.length === 1 ? 'category' : 'categories'}`,
    options: group.categories.map((category) => ({
      id: category.id,
      label: `${category.emoji} ${category.name}`,
      ariaLabel: category.name,
      searchText: category.name,
    })),
  }))
}
