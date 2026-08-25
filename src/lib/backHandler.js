import { App } from '@capacitor/app'

/**
 * Global back-button manager for Capacitor (Android hardware back).
 *
 * A stack of "closers". Each open popup/sheet/modal registers a closer when it
 * mounts and unregisters when it unmounts. On hardware back:
 *   1. If any popup is open → close the top-most one (do NOT exit).
 *   2. Else if not on a root tab → let the router go back.
 *   3. Else → minimize the app (Android home) instead of killing it.
 *
 * This is initialised once from App.jsx via initBackHandler(navigate, isRoot).
 */

const closers = []   // array of { id, close }
let idSeq = 0

export function pushCloser(close) {
  const id = ++idSeq
  closers.push({ id, close })
  return id
}

export function removeCloser(id) {
  const idx = closers.findIndex(c => c.id === id)
  if (idx !== -1) closers.splice(idx, 1)
}

let initialised = false

/**
 * @param {() => boolean} isRootRoute  returns true if current route is a root tab
 * @param {() => void}    goBack        router back navigation
 */
export function initBackHandler(isRootRoute, goBack) {
  if (initialised) return
  initialised = true

  App.addListener('backButton', () => {
    // 1) Close the most recently opened popup, if any
    if (closers.length > 0) {
      const top = closers[closers.length - 1]
      top.close()
      return
    }

    // 2) If we're not on a root tab, navigate back within the app
    if (!isRootRoute()) {
      goBack()
      return
    }

    // 3) On a root tab with nothing open → minimize instead of exiting
    App.minimizeApp()
  })
}
