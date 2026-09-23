import { FlaskConical } from 'lucide-react'

export const DEMO_REPO_URL = 'https://github.com/orlandoc01/tallyo'

export function DemoBanner() {
  if (import.meta.env.MODE !== 'demo') return null
  return (
    <p className="mb-4 flex items-start gap-2 rounded-md border border-border-strong bg-raised px-3 py-2 text-[13px] text-text-2" role="status">
      <FlaskConical aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <span>
        <strong>Demo mode.</strong> All data is fictional and lives in your browser — edits reset on reload, and nothing that needs a real server (bank sync, sign-in) works here.{' '}
        <a className="font-semibold underline" href={DEMO_REPO_URL} rel="noreferrer" target="_blank">Get Tallyo on GitHub</a>
      </span>
    </p>
  )
}
