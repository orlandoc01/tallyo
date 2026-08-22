import type { Category, CategoryGroup } from '../../types/graphql'
import { CATEGORIES_QUERY, CATEGORY_GROUPS_QUERY } from '../queries'
import { invalidateRoots, mapCachedList, replaceOrAppendByID, type MutationUpdaters, type QueryCache } from './shared'

function sortCategories(categories: Category[]) {
  return [...categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

function updateCachedCategoryLists(
  cache: QueryCache,
  mapItems: (items: Category[]) => Category[],
  mapGroup: (group: CategoryGroup) => CategoryGroup,
) {
  mapCachedList<Category>(cache, 'categories', CATEGORIES_QUERY, mapItems)
  mapCachedList<CategoryGroup>(cache, 'categoryGroups', CATEGORY_GROUPS_QUERY, (items) => items.map(mapGroup))
}

export function upsertCategoryInCachedLists(cache: QueryCache, category: Category, groupID?: string) {
  updateCachedCategoryLists(
    cache,
    (items) => sortCategories(replaceOrAppendByID(items, category)),
    (group) => {
      const withoutCategory = group.categories.filter((item) => item.id !== category.id)
      if (groupID && group.id === groupID) {
        return { ...group, categories: sortCategories(replaceOrAppendByID(withoutCategory, category)) }
      }
      if (!groupID && group.categories.some((item) => item.id === category.id)) {
        return { ...group, categories: sortCategories(replaceOrAppendByID(withoutCategory, category)) }
      }
      return { ...group, categories: withoutCategory }
    },
  )
}

export function removeCategoryFromCachedLists(cache: QueryCache, categoryID: string) {
  updateCachedCategoryLists(
    cache,
    (items) => items.filter((category) => category.id !== categoryID),
    (group) => ({ ...group, categories: group.categories.filter((category) => category.id !== categoryID) }),
  )
}

export function upsertCategoryGroupInCachedLists(cache: QueryCache, group: CategoryGroup) {
  mapCachedList<CategoryGroup>(cache, 'categoryGroups', CATEGORY_GROUPS_QUERY, (items) => replaceOrAppendByID(items, group))

  if (group.categories.length === 0) return

  const categoriesByID = new Map(group.categories.map((category) => [category.id, category]))
  mapCachedList<Category>(cache, 'categories', CATEGORIES_QUERY, (items) => sortCategories(items.map((category) => categoriesByID.get(category.id) ?? category)))
}

function removeCategoryGroupFromCachedLists(cache: QueryCache, groupID: string) {
  mapCachedList<CategoryGroup>(cache, 'categoryGroups', CATEGORY_GROUPS_QUERY, (items) => items.filter((group) => group.id !== groupID))
}

export const categoryMutationUpdaters = {
  createCategory(result, args, cache) {
    const category = (result as { createCategory?: { category?: Category } }).createCategory?.category
    const groupID = (args.input as { groupId?: string } | undefined)?.groupId
    if (category) upsertCategoryInCachedLists(cache, category, groupID)
  },
  updateCategory(result, args, cache) {
    const category = (result as { updateCategory?: { category?: Category } }).updateCategory?.category
    const groupID = (args.input as { groupId?: string } | undefined)?.groupId
    if (category) upsertCategoryInCachedLists(cache, category, groupID)
  },
  deleteCategory(_result, args, cache) {
    const categoryID = typeof args.id === 'string' ? args.id : undefined
    if (categoryID) {
      removeCategoryFromCachedLists(cache, categoryID)
    } else {
      invalidateRoots(cache, 'categories', 'categoryGroups')
    }
    invalidateRoots(cache, 'rules', 'budgetReport', 'budgetReportHistory')
  },
  createCategoryGroup(result, _args, cache) {
    const group = (result as { createCategoryGroup?: { group?: CategoryGroup } }).createCategoryGroup?.group
    if (group) upsertCategoryGroupInCachedLists(cache, group)
  },
  updateCategoryGroup(result, _args, cache) {
    const group = (result as { updateCategoryGroup?: { group?: CategoryGroup } }).updateCategoryGroup?.group
    if (group) upsertCategoryGroupInCachedLists(cache, group)
  },
  deleteCategoryGroup(_result, args, cache) {
    const groupID = typeof args.id === 'string' ? args.id : undefined
    if (groupID) removeCategoryGroupFromCachedLists(cache, groupID)
    invalidateRoots(cache, 'categories', 'rules', 'budgetReport', 'budgetReportHistory')
  },
  reorderCategories(result, _args, cache) {
    const group = (result as { reorderCategories?: { group?: CategoryGroup } }).reorderCategories?.group
    if (group) {
      upsertCategoryGroupInCachedLists(cache, group)
      for (const category of group.categories) upsertCategoryInCachedLists(cache, category, group.id)
    }
  },
} satisfies MutationUpdaters
