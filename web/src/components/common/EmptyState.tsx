export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-8 text-center">
      <h2 className="text-lg font-semibold text-neutral-900">{title}</h2>
      {description ? <p className="mt-2 text-sm text-neutral-500">{description}</p> : null}
    </div>
  )
}
