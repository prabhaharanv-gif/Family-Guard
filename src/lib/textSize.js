/**
 * textSize.js
 *
 * Profile -> Text size: the size of Kinest's text on its own, without touching the
 * rest of the phone.
 *
 * Why it exists: the app is laid out for a phone at its normal text size. A phone
 * with a large system font or display size scales every word with it, so text
 * wraps and the cards look cramped. The native side (TextSizePlugin) sets the
 * WebView's text zoom and re-applies it on every launch.
 *
 * Android only. On the web there is nothing to set, so every call is a no-op.
 */
import { Capacitor, registerPlugin } from '@capacitor/core'

const TextSize = registerPlugin('TextSize')

/** The choices, in the order they are shown. `percent` is only for the label's sake. */
export const TEXT_SIZES = [
  { id: 'small',  percent: 85  },
  { id: 'normal', percent: 100 },
  { id: 'large',  percent: 115 },

]

export const DEFAULT_TEXT_SIZE = 'normal'

export const isTextSizeAvailable = () => Capacitor.isNativePlatform()

/** The saved level, or the default when none is saved or the plugin is missing (an older build). */
export async function getTextSize() {
  if (!isTextSizeAvailable()) return DEFAULT_TEXT_SIZE
  try {
    const { level } = await TextSize.getLevel()
    return TEXT_SIZES.some(s => s.id === level) ? level : DEFAULT_TEXT_SIZE
  } catch {
    return DEFAULT_TEXT_SIZE
  }
}

/** Saves and applies a level. Returns the level that took effect. */
export async function setTextSize(level) {
  if (!isTextSizeAvailable()) return DEFAULT_TEXT_SIZE
  const safe = TEXT_SIZES.some(s => s.id === level) ? level : DEFAULT_TEXT_SIZE
  try {
    const r = await TextSize.setLevel({ level: safe })
    return r?.level || safe
  } catch {
    return DEFAULT_TEXT_SIZE
  }
}
