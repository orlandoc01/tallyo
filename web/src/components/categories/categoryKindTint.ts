import type { CategoryKind } from '../../types/graphql'
import type { TagTint } from '../../utils/tagTints'

export const CATEGORY_KIND_TINT: Record<CategoryKind, TagTint> = { EXPENSE: 'pink', INCOME: 'green', TRANSFER: 'blue' }
