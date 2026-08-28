export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div aria-live="assertive" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800" role="alert">
      <div className="font-semibold">Something went wrong</div>
      <p className="mt-1">{message}</p>
      {onRetry ? (
        <button className="mt-3 rounded-xl bg-red-700 px-3 py-2 font-semibold text-white" onClick={onRetry} type="button">
          Retry
        </button>
      ) : null}
    </div>
  )
}
