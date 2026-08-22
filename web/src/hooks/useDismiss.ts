import { useEffect } from 'react'
import type { RefObject } from 'react'

// Closes a popover on Escape or on pointerdown outside the given elements.
export function useDismiss(isOpen: boolean, onDismiss: () => void, insideRefs: Array<RefObject<HTMLElement | null>>) {
  useEffect(() => {
    if (!isOpen) return

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (insideRefs.some((ref) => ref.current?.contains(target))) return
      onDismiss()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onDismiss()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
    // insideRefs are stable ref objects; re-subscribing on onDismiss identity is harmless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, onDismiss])
}
