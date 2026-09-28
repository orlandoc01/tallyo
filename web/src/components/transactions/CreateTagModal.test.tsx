import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { tags } from '../../mocks/fixtures'
import { captureMutation } from '../../test/msw'
import { GraphqlTestProvider } from '../../test/renderWithProviders'
import { CreateTagModal } from './CreateTagModal'

vi.mock('../../hooks/useIsMobile', () => ({ useIsMobile: () => true }))

describe('CreateTagModal on mobile', () => {
  it('renders the create sheet with name and color rows', () => {
    render(<CreateTagModal onClose={vi.fn()} onSaved={vi.fn()} />, { wrapper: GraphqlTestProvider })

    const sheet = screen.getByRole('dialog', { name: 'Create tag' })
    expect(within(sheet).queryByRole('button', { name: 'Close filters' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^name/i })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^color/i })).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('creates a tag with a picked color', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const createTag = captureMutation<{ name: string; color: string }>('CreateTag', {
      createTag: { __typename: 'CreateTagPayload', tag: { __typename: 'Tag', id: 'tag-new', name: 'Client', color: '#EF4444' } },
    })
    render(<CreateTagModal onClose={vi.fn()} onSaved={onSaved} />, { wrapper: GraphqlTestProvider })

    await user.click(screen.getByRole('button', { name: /^name/i }))
    await user.type(screen.getByRole('textbox', { name: 'Name' }), ' Client ')
    await user.click(screen.getByRole('button', { name: /^color/i }))
    await user.click(screen.getByRole('button', { name: /color #ef4444/i }))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(createTag.input).toEqual({ name: 'Client', color: '#EF4444' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'tag-new', name: 'Client' })))
  })

  it('edits an existing tag and closes on the scrim', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const updateTag = captureMutation<{ id: string; name: string; color: string }>('UpdateTag', {
      updateTag: { __typename: 'UpdateTagPayload', tag: { ...tags[0], name: 'Work stuff' } },
    })
    render(<CreateTagModal onClose={onClose} onSaved={vi.fn()} tag={tags[0]} />, { wrapper: GraphqlTestProvider })

    expect(screen.getByRole('dialog', { name: 'Edit tag' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^name/i }))
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Work stuff')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateTag.input).toEqual({ id: tags[0].id, name: 'Work stuff', color: tags[0].color }))

    await user.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
