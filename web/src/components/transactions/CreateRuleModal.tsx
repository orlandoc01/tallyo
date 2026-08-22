import { useState, type FormEvent } from 'react'
import { useMutation } from 'urql'
import { CREATE_RULE_MUTATION } from '../../graphql/mutations'
import type { Account, CategoryGroup, CreateRuleInput, CreateRulePayload, TransactionsFilter } from '../../types/graphql'
import { amountToInputValue } from '../../utils/amount'
import { FormError } from '../common/FormControls'
import { Modal, ModalActions } from '../common/Modal'
import { ModalHeader } from '../common/ModalHeader'
import { ToggleSettingRow } from '../common/ToggleSwitch'
import { useSaveAction } from '../../hooks/useSaveAction'
import { useTags } from '../../hooks/useEntityQueries'
import { RuleFormFields } from './RuleFormFields'
import { ruleInputFromFields, useRuleFormFields } from './useRuleFormFields'

function initialAmountRange(filter: TransactionsFilter) {
  if (filter.exactAmount !== undefined) {
    return { amountMin: amountToInputValue(filter.exactAmount), amountMax: amountToInputValue(filter.exactAmount) }
  }

  return { amountMin: amountToInputValue(filter.amountMin), amountMax: amountToInputValue(filter.amountMax) }
}

export function CreateRuleModal({
  accounts,
  categoryGroups,
  filter,
  onClose,
  onCreated,
}: {
  accounts: Account[]
  categoryGroups: CategoryGroup[]
  filter: TransactionsFilter
  onClose: () => void
  onCreated?: () => void
}) {
  const amountRange = initialAmountRange(filter)
  const categories = categoryGroups.flatMap((group) => group.categories)
  const fields = useRuleFormFields({
    merchantPattern: filter.merchantPrefix ?? '',
    originalPattern: filter.originalPrefix ?? '',
    amountMin: amountRange.amountMin,
    amountMax: amountRange.amountMax,
    accountIds: filter.accountIds ?? [],
    categoryId: '',
    merchantName: '',
    tagIds: [],
    shouldHide: false,
    priority: '',
  })
  const [applyRetroactively, setApplyRetroactively] = useState(false)
  const { error, saving, save, setError } = useSaveAction()
  const [, createRule] = useMutation<
    { createRule: CreateRulePayload },
    { input: CreateRuleInput }
  >(CREATE_RULE_MUTATION)
  const { tags } = useTags()

  const canSubmit = !!fields.categoryId || !!fields.merchantName.trim() || fields.tagIds.length > 0 || fields.shouldHide

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (!canSubmit) {
      setError('Choose a merchant name, category, tag, or hide matching transactions before creating a rule.')
      return
    }

    const input: CreateRuleInput = { applyRetroactively, ...ruleInputFromFields(fields) }
    if (fields.shouldHide) input.changes.isHidden = true

    await save(() => createRule({ input }), () => { onCreated?.(); onClose() })
  }

  return (
    <Modal onClose={onClose} scrollable size="lg">
      <ModalHeader onClose={onClose} subtitle="Use the current transaction filters to prefill a backend auto-categorization rule." title="Create rule" />

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        {error ? <FormError>{error}</FormError> : null}

        <RuleFormFields accounts={accounts} categories={categories} fields={fields} tags={tags} />

        <ToggleSettingRow checked={applyRetroactively} onChange={setApplyRetroactively} title="Apply retroactively" />

        <ModalActions busy={saving} busyLabel="Creating..." className="pt-2" disabled={saving || !canSubmit} onCancel={onClose} submitLabel="Submit rule" />
      </form>
    </Modal>
  )
}
