import type { TagTint } from './tagTints'
import type { Category } from '../types/graphql'

export const UNCATEGORIZED_CATEGORY_ID = '0'

const TINTS: readonly TagTint[] = ['blue', 'green', 'pink', 'violet', 'amber', 'teal', 'red']

export function categoryTint(category: Pick<Category, 'id'>): TagTint {
  const id = String(category.id)
  if (id === UNCATEGORIZED_CATEGORY_ID) return 'gray'
  const hash = [...id].reduce((total, character) => (total * 31 + character.charCodeAt(0)) >>> 0, 7)
  return TINTS[hash % TINTS.length]
}
