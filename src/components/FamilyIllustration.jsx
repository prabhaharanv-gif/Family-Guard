import familyMark from '../assets/family-mark.png'

/**
 * FamilyIllustration
 *
 * Decorative watermark that fills the empty space under a short family list:
 * the app icon's own artwork (a roof over a family of four), in the app's
 * maroon at low opacity so it reads as a soft rose shape on the cream page and
 * never competes with the member cards above it.
 *
 * It is the same picture as the launcher icon, so the Family page echoes the
 * icon people tap to open the app. The PNG is a transparent, maroon copy of that
 * artwork (see src/assets/family-mark.png); the opacity does the softening.
 *
 * Sized to about the height of the drawing it replaced, which keeps the invite
 * button clear of it.
 *
 * aria-hidden and an empty alt — it is purely decorative and adds nothing for a
 * screen reader.
 */
export default function FamilyIllustration({ width = 190, opacity = 0.14 }) {
  return (
    <img
      src={familyMark}
      alt=""
      aria-hidden="true"
      draggable={false}
      width={width}
      style={{ display: 'block', maxWidth: '100%', height: 'auto', opacity, userSelect: 'none', pointerEvents: 'none' }}
    />
  )
}
