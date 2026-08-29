import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEMO_REPO_URL, DemoBanner } from './DemoBanner'

describe('DemoBanner', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('renders nothing outside demo mode', () => {
    const { container } = render(<DemoBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('links to the repo in demo mode', () => {
    vi.stubEnv('MODE', 'demo')
    render(<DemoBanner />)
    expect(screen.getByRole('status')).toHaveTextContent('Demo mode')
    expect(screen.getByRole('link', { name: 'Get Tallyo on GitHub' })).toHaveAttribute('href', DEMO_REPO_URL)
  })
})
