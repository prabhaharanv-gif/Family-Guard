import { useEffect, useState } from 'react'

/**
 * True while the soft keyboard is on screen and the caret is in a field.
 *
 * The keyboard and the bottom nav together were taking half the screen in a
 * chat: four message bubbles visible above a keyboard, a tab bar wedged
 * between them. The nav has nothing to offer mid-sentence, so it steps out.
 *
 * ── Why the viewport height, and not visualViewport ────────────────────────
 * MainActivity is portrait-locked and the window RESIZES for the keyboard
 * rather than panning — that is visible in the layout, where the tab bar ends
 * up sitting above the keyboard instead of being pushed off the bottom. When
 * the window itself resizes, visualViewport.height just tracks innerHeight and
 * the gap between the two stays zero with the keyboard up or down, so the
 * usual visualViewport trick detects nothing. The honest signal is that the
 * viewport is far shorter than the tallest it has ever been.
 *
 * ── Why focus as well ──────────────────────────────────────────────────────
 * Height alone would also fire when a desktop browser window is dragged
 * shorter. And it has to be height rather than focus alone, because BACK now
 * closes the keyboard while leaving the caret in the field: on focus alone the
 * nav would stay hidden with no keyboard on screen and no way to bring it
 * back. Together they say what is actually true — there is a keyboard, and it
 * belongs to something the person is typing into.
 */

/** Taller than any transient browser chrome, shorter than any keyboard. */
const MIN_KEYBOARD_PX = 160

const isEditable = (el) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)

export function useKeyboardOpen() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // Portrait-locked, so the tallest viewport ever seen is the no-keyboard
    // height. Taken as a starting point rather than a constant because the
    // first render can happen while a keyboard is already up.
    let tallest = window.innerHeight

    const check = () => {
      tallest = Math.max(tallest, window.innerHeight)
      const shrunk = tallest - window.innerHeight > MIN_KEYBOARD_PX
      setOpen(shrunk && isEditable(document.activeElement))
    }

    window.addEventListener('resize', check)
    window.visualViewport?.addEventListener('resize', check)
    // Focus moves without the viewport changing — tapping straight from one
    // field to a button, for one.
    document.addEventListener('focusin', check)
    document.addEventListener('focusout', check)

    return () => {
      window.removeEventListener('resize', check)
      window.visualViewport?.removeEventListener('resize', check)
      document.removeEventListener('focusin', check)
      document.removeEventListener('focusout', check)
    }
  }, [])

  return open
}
