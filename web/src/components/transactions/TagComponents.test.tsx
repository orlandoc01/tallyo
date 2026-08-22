import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { tags } from '../../mocks/fixtures'
import { usePermissions } from '../../hooks/usePermissions'
import { allowAllPermissionResult } from '../../test/permissions'
import { captureMutation, mockQuery } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import type { Tag } from '../../types/graphql'
import { TagsTab } from '../settings/TagsTab'
import { CreateTagModal } from './CreateTagModal'
import { TagChip, TagPicker } from './TagPicker'

vi.mock('../../hooks/usePermissions', async () => (await import('../../test/permissions')).allowAllPermissions())

// The CreateTag/UpdateTag mutations select only TagFields, so urql's cache strips
// fields outside that fragment before the modal hands the tag to onSaved.
function tagFieldsProjection(tag: Tag) {
  return { __typename: tag.__typename, id: tag.id, name: tag.name, color: tag.color }
}

describe('tag components', () => {
  afterEach(() => {
    vi.mocked(usePermissions).mockReturnValue(allowAllPermissionResult)
  })

  it('renders chips and toggles tags in the picker', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    const onToggle = vi.fn()
    const onCreate = vi.fn()

    render(
      <>
        <TagChip tag={tags[0]} onRemove={onRemove} />
        <TagPicker tags={tags} selectedTagIds={[tags[0].id]} onToggle={onToggle} onCreate={onCreate} />
      </>,
    )

    await user.click(screen.getByRole('button', { name: `Remove ${tags[0].name}` }))
    await user.click(screen.getByRole('button', { name: new RegExp(tags[1].name, 'i') }))
    await user.click(screen.getByRole('button', { name: /create new tag/i }))

    expect(onRemove).toHaveBeenCalled()
    expect(onToggle).toHaveBeenCalledWith(tags[1])
    expect(onCreate).toHaveBeenCalled()
  })

  it('creates a tag from the modal', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const savedTag: Tag = { __typename: 'Tag', id: 'tag-new', name: 'Client', color: '#EF4444', transactionCount: 0 }
    const createTag = captureMutation('CreateTag', { createTag: { __typename: 'CreateTagPayload', tag: savedTag } })

    render(<CreateTagModal onClose={vi.fn()} onSaved={onSaved} />, { wrapper: GraphqlTestProvider })

    await user.type(screen.getByLabelText(/name/i), ' Client ')
    await user.click(screen.getByRole('button', { name: /color #ef4444/i }))
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(createTag.variables).toEqual({ input: { name: 'Client', color: '#EF4444' } }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(tagFieldsProjection(savedTag)))
  })

  it('updates a tag from the modal', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const savedTag: Tag = { ...tags[0], name: 'Work stuff' }
    const updateTag = captureMutation('UpdateTag', { updateTag: { __typename: 'UpdateTagPayload', tag: savedTag } })

    render(<CreateTagModal tag={tags[0]} onClose={vi.fn()} onSaved={onSaved} />, { wrapper: GraphqlTestProvider })

    const name = screen.getByLabelText(/name/i)
    await user.clear(name)
    await user.type(name, 'Work stuff')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(updateTag.variables).toEqual({ input: { id: tags[0].id, name: 'Work stuff', color: tags[0].color } }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(tagFieldsProjection(savedTag)))
  })

  it('renders and deletes tags from settings', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockQuery('Tags', { tags: { __typename: 'TagList', items: tags } })
    const deleteTag = captureMutation('DeleteTag', { deleteTag: { __typename: 'DeleteTagPayload', success: true } })

    render(<TagsTab />, { wrapper: GraphqlTestProvider })

    expect(await screen.findByText(tags[0].name)).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /delete/i })[0])

    await waitFor(() => expect(deleteTag.variables).toEqual({ id: tags[0].id }))
    expect(confirmSpy).toHaveBeenCalledWith(`Delete tag ${tags[0].name}?`)
    confirmSpy.mockRestore()
  })

  it('creates a tag from settings', async () => {
    const user = userEvent.setup()
    const savedTag: Tag = { __typename: 'Tag', id: 'tag-client', name: 'Client', color: '#3B82F6', transactionCount: 0 }
    mockQuery('Tags', { tags: { __typename: 'TagList', items: tags } })
    const createTag = captureMutation('CreateTag', { createTag: { __typename: 'CreateTagPayload', tag: savedTag } })

    render(<TagsTab />, { wrapper: GraphqlTestProvider })

    await user.click(await screen.findByRole('button', { name: /new tag/i }))
    await user.type(screen.getByRole('textbox', { name: /name/i }), 'Client')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(createTag.variables).toEqual({ input: { name: 'Client', color: '#3B82F6' } }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('edits a tag from settings', async () => {
    const user = userEvent.setup()
    const savedTag: Tag = { ...tags[0], name: 'Work travel' }
    mockQuery('Tags', { tags: { __typename: 'TagList', items: tags } })
    const updateTag = captureMutation('UpdateTag', { updateTag: { __typename: 'UpdateTagPayload', tag: savedTag } })

    render(<TagsTab />, { wrapper: GraphqlTestProvider })

    await user.click((await screen.findAllByRole('button', { name: /edit/i }))[0])
    const name = screen.getByRole('textbox', { name: /name/i })
    await user.clear(name)
    await user.type(name, 'Work travel')
    await user.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(updateTag.variables).toEqual({ input: { id: tags[0].id, name: 'Work travel', color: tags[0].color } }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes tag modals from settings', async () => {
    const user = userEvent.setup()

    mockQuery('Tags', { tags: { __typename: 'TagList', items: tags } })

    render(<TagsTab />, { wrapper: GraphqlTestProvider })

    await user.click(await screen.findByRole('button', { name: /new tag/i }))
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByText('Create tag')).not.toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /edit/i })[0])
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByText('Edit tag')).not.toBeInTheDocument()
  })

  it('hides tag write controls from settings without tag write scope', async () => {
    vi.mocked(usePermissions).mockReturnValue({
      canRead: () => true,
      canWrite: (resource) => resource !== 'tags',
      hasScope: () => true,
    })

    mockQuery('Tags', { tags: { __typename: 'TagList', items: tags } })

    render(<TagsTab />, { wrapper: GraphqlTestProvider })

    expect(await screen.findByText(tags[0].name)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new tag/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })
})
