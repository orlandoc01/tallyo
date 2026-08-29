import { useState, type FormEvent } from 'react'
import { useMutation } from 'urql'
import { DELETE_RULE_MUTATION, UPDATE_RULE_MUTATION } from '../../graphql/mutations'
import { useAccounts, useCategoryGroups, useTags } from '../../hooks/useEntityQueries'
import type { Rule, UpdateRuleInput, UpdateRulePayload } from '../../types/graphql'
import { amountToInputValue } from '../../utils/amount'
import { Button } from '../common/Button'
import { FormError } from '../common/FormControls'
import { Modal, ModalActions } from '../common/Modal'
import { ModalHeader } from '../common/ModalHeader'
import { ToggleSettingRow } from '../common/ToggleSwitch'
import { useSaveAction } from '../../hooks/useSaveAction'
import { RuleFormFields } from './RuleFormFields'
import { ruleInputFromFields, useRuleFormFields } from './useRuleFormFields'

export function EditRuleModal({
  rule,
  onClose,
  onUpdated,
  onDeleted,
}: {
  rule: Rule
  onClose: () => void
  onUpdated?: () => void
  onDeleted?: () => void
}) {
  const { accounts } = useAccounts()
  const { categoryGroups } = useCategoryGroups()
  const { tags } = useTags()
  const categories = categoryGroups.flatMap((group) => group.categories)

  const fields = useRuleFormFields({
    merchantPattern: rule.merchantPattern ?? '',
    originalPattern: rule.originalPattern ?? '',
    amountMin: amountToInputValue(rule.amountMin),
    amountMax: amountToInputValue(rule.amountMax),
    accountIds: rule.accounts?.map((a) => a.id) ?? [],
    categoryId: rule.category?.id ?? '',
    merchantName: rule.merchantName ?? '',
    tagIds: rule.tags?.map((tag) => tag.id) ?? [],
    shouldHide: rule.shouldHide ?? false,
    priority: String(rule.priority),
  })
  const [applyRetroactively, setApplyRetroactively] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { error, saving: updating, save, setError } = useSaveAction()

  const [, updateRule] = useMutation<
    { updateRule: UpdateRulePayload },
    { input: UpdateRuleInput }
  >(UPDATE_RULE_MUTATION)

  const [{ fetching: deleting }, deleteRule] = useMutation(DELETE_RULE_MUTATION)

  const hasRecurringAction = rule.shouldBeRecurring !== null && rule.shouldBeRecurring !== undefined
  const canSubmit = !!fields.categoryId || !!fields.merchantName.trim() || fields.tagIds.length > 0 || fields.shouldHide || hasRecurringAction

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (!canSubmit) {
      setError('Choose a merchant name, category, tag, or hide matching transactions before saving.')
      return
    }

    const input: UpdateRuleInput = {
      id: rule.id,
      applyRetroactively,
      ...ruleInputFromFields(fields),
    }
    if (fields.shouldHide) input.changes.isHidden = true
    if (hasRecurringAction) input.changes.isRecurring = rule.shouldBeRecurring === true
    const parsedPriority = Number(fields.priority)
    if (Number.isFinite(parsedPriority)) input.priority = parsedPriority

    await save(() => updateRule({ input }), () => { onUpdated?.(); onClose() })
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    const result = await deleteRule({ id: rule.id })
    if (result.error) {
      setError(result.error.message)
      return
    }
    onDeleted?.()
    onClose()
  }

  const fetching = updating || deleting
  const formErrorId = error ? 'edit-rule-error' : undefined

  return (
    <Modal onClose={onClose} scrollable size="lg">
      <ModalHeader onClose={onClose} subtitle="Update the rule fields. Optionally apply the new settings retroactively." title="Edit rule" />

      <form aria-describedby={formErrorId} className="mt-6 space-y-4" onSubmit={handleSubmit}>
        {error ? <FormError id={formErrorId}>{error}</FormError> : null}

        <RuleFormFields accounts={accounts} categories={categories} fields={fields} includePriority tags={tags} />

        <ToggleSettingRow checked={applyRetroactively} onChange={setApplyRetroactively} title="Apply retroactively" />

        <div className="flex items-center justify-between gap-3 pt-2">
          <Button disabled={fetching} onClick={handleDelete} type="button" variant={confirmDelete ? 'danger-solid' : 'danger'}>
            {confirmDelete ? 'Confirm delete' : 'Delete rule'}
          </Button>
          {confirmDelete ? (
            <Button onClick={() => setConfirmDelete(false)} type="button" variant="secondary">Cancel</Button>
          ) : (
            <ModalActions busy={updating} disabled={fetching || !canSubmit} onCancel={onClose} submitLabel="Save changes" />
          )}
        </div>
      </form>
    </Modal>
  )
}
