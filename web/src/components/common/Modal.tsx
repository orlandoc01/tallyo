import clsx from 'clsx'
import type { ComponentProps, ReactNode } from 'react'
import { Button } from './Button'

/**
 * Centered modal scaffold: the dimmed backdrop plus the white dialog panel.
 * Callers supply their own header, body, and footer as children — only the
 * overlay/panel structure and dialog accessibility wiring are shared here.
 */
export function Modal({
  children,
  className,
  onClose,
  label,
  labelledBy,
  size = 'md',
  scrollable = false,
  dismissOnBackdrop = true,
}: {
  children: ReactNode
  className?: string
  onClose: () => void
  /** Accessible name for the dialog. Omit when the content labels itself via `labelledBy`. */
  label?: string
  /** id of an element that labels the dialog (alternative to `label`). */
  labelledBy?: string
  size?: 'md' | 'lg'
  /** Top-align and let the overlay scroll, for forms taller than the viewport. */
  scrollable?: boolean
  /** Close when the backdrop is clicked. Disable for flows that shouldn't be dismissed by accident. */
  dismissOnBackdrop?: boolean
}) {
  return (
    <div
      className={clsx(
        'fixed inset-0 z-40 flex justify-center p-4 pt-16 lg:p-4',
        scrollable ? 'items-start overflow-y-auto' : 'items-center',
      )}
      onClick={dismissOnBackdrop ? onClose : undefined}
      role="presentation"
    >
      <div aria-hidden className="fixed inset-x-0 bottom-0 top-12 bg-neutral-950/40 lg:inset-0" />
      <section
        aria-label={label}
        aria-labelledby={labelledBy}
        aria-modal="true"
        className={clsx(
          'relative w-full rounded-2xl bg-white p-6 shadow-2xl',
          size === 'lg' ? 'max-w-lg' : 'max-w-md',
          scrollable && 'my-auto',
          className,
        )}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        {children}
      </section>
    </div>
  )
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return <div className="flex justify-end gap-3 border-t border-neutral-100 pt-4">{children}</div>
}

export function ModalActions({
  busy = false,
  busyIcon,
  busyLabel = 'Saving...',
  cancelDisabled = false,
  className,
  disabled = false,
  onCancel,
  onSubmit,
  submitLabel = 'Save',
  submitType = 'submit',
  submitVariant = 'primary',
}: {
  busy?: boolean
  busyIcon?: ReactNode
  busyLabel?: string
  cancelDisabled?: boolean
  className?: string
  disabled?: boolean
  onCancel: () => void
  onSubmit?: () => void
  submitLabel?: string
  submitType?: 'button' | 'submit'
  submitVariant?: ComponentProps<typeof Button>['variant']
}) {
  return (
    <div className={clsx('flex justify-end gap-3', className)}>
      <Button disabled={cancelDisabled} onClick={onCancel} type="button" variant="secondary">Cancel</Button>
      <Button className={busyIcon ? 'gap-2' : undefined} disabled={disabled} onClick={onSubmit} type={submitType} variant={submitVariant}>
        {busy ? busyIcon : null}{busy ? busyLabel : submitLabel}
      </Button>
    </div>
  )
}
