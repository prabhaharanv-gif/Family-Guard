import { useEffect, useRef } from 'react'
import { pushCloser, removeCloser } from '../lib/backHandler'

/**
 * useBackButton
 * ----------------
 * Registers a popup/sheet/modal with the global back-button manager.
 * While `isOpen` is true, the Android hardware back button will call
 * `onClose()` (closing this popup) instead of exiting the app.
 *
 * Usage:
 *   useBackButton(showSheet, () => setShowSheet(false))
 */
export function useBackButton(isOpen, onClose) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!isOpen) return
    const id = pushCloser(() => onCloseRef.current())
    return () => removeCloser(id)
  }, [isOpen])
}
