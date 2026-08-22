import { useState } from 'react'
import type { CreateRuleInput, TransactionUpdates } from '../../types/graphql'
import { parseOptionalAmount } from '../../utils/amount'

interface RuleFormInitial {
  merchantPattern: string
  originalPattern: string
  amountMin: string
  amountMax: string
  accountIds: string[]
  categoryId: string
  merchantName: string
  tagIds: string[]
  shouldHide: boolean
  priority: string
}

export interface RuleFormFieldsState extends RuleFormInitial {
  setMerchantPattern: (value: string) => void
  setOriginalPattern: (value: string) => void
  setAmountMin: (value: string) => void
  setAmountMax: (value: string) => void
  setAccountIds: (value: string[]) => void
  setCategoryId: (value: string) => void
  setMerchantName: (value: string) => void
  setTagIds: (value: string[]) => void
  setShouldHide: (value: boolean) => void
  setPriority: (value: string) => void
}

export function useRuleFormFields(initial: RuleFormInitial): RuleFormFieldsState {
  const [merchantPattern, setMerchantPattern] = useState(initial.merchantPattern)
  const [originalPattern, setOriginalPattern] = useState(initial.originalPattern)
  const [amountMin, setAmountMin] = useState(initial.amountMin)
  const [amountMax, setAmountMax] = useState(initial.amountMax)
  const [accountIds, setAccountIds] = useState<string[]>(initial.accountIds)
  const [categoryId, setCategoryId] = useState(initial.categoryId)
  const [merchantName, setMerchantName] = useState(initial.merchantName)
  const [tagIds, setTagIds] = useState<string[]>(initial.tagIds)
  const [shouldHide, setShouldHide] = useState(initial.shouldHide)
  const [priority, setPriority] = useState(initial.priority)

  return {
    merchantPattern, setMerchantPattern,
    originalPattern, setOriginalPattern,
    amountMin, setAmountMin,
    amountMax, setAmountMax,
    accountIds, setAccountIds,
    categoryId, setCategoryId,
    merchantName, setMerchantName,
    tagIds, setTagIds,
    shouldHide, setShouldHide,
    priority, setPriority,
  }
}

// The pattern/account/amount/change fields are shared by CreateRuleInput and
// UpdateRuleInput; only set keys that the user actually filled in.
type SharedRuleInput = Pick<CreateRuleInput, 'merchantPattern' | 'originalPattern' | 'accountIds' | 'amountMin' | 'amountMax'> & { changes: TransactionUpdates }

export function ruleInputFromFields(fields: RuleFormFieldsState): SharedRuleInput {
  const input: SharedRuleInput = { changes: {} }
  if (fields.categoryId) input.changes.categoryId = fields.categoryId
  if (fields.tagIds.length) input.changes.tagIds = fields.tagIds
  const trimmedMerchantName = fields.merchantName.trim()
  if (trimmedMerchantName) input.changes.merchantName = trimmedMerchantName
  const trimmedMerchant = fields.merchantPattern.trim()
  const trimmedOriginal = fields.originalPattern.trim()
  if (trimmedMerchant) input.merchantPattern = trimmedMerchant
  if (trimmedOriginal) input.originalPattern = trimmedOriginal
  if (fields.accountIds.length) input.accountIds = fields.accountIds
  const parsedMin = parseOptionalAmount(fields.amountMin)
  const parsedMax = parseOptionalAmount(fields.amountMax)
  if (parsedMin !== undefined) input.amountMin = parsedMin
  if (parsedMax !== undefined) input.amountMax = parsedMax
  return input
}
