import { Link } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { useT } from '../i18n'
import { APP_NAME } from '../lib/brand'

/**
 * AuthHomeLink — the way back to the public website from the sign-in screens.
 *
 * Someone who chose "Sign in on the web" on the home page used to land on the
 * login form with no way to return. This sits top-left, mirroring the language
 * picker top-right, and goes to "/".
 *
 * Web only. In the Android app "/" for a signed-out person is just the login
 * screen again (the website is never shown there), so the link would be a
 * button that does nothing.
 */
export default function AuthHomeLink() {
  const t = useT()
  if (Capacitor.isNativePlatform()) return null

  return (
    <Link
      to="/"
      aria-label={t('landing.backHome')}
      title={t('landing.backHome')}
      style={{
        position: 'absolute', top: 14, left: 14, zIndex: 50,
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '5px 14px 5px 5px', borderRadius: 999, textDecoration: 'none',
        // Same white pill as the language picker so the two read as a pair.
        background: '#FFFFFF',
        border: '1.5px solid rgba(139,13,61,0.22)',
        boxShadow: '0 4px 14px rgba(42,10,24,0.30)',
        color: 'var(--maroon)', fontFamily: 'Sora, sans-serif', fontSize: 14.5, fontWeight: 900,
        lineHeight: 1.2,
      }}
    >
      <img src="/kinest-icon.png" alt="" width={30} height={30} style={{ borderRadius: 9, display: 'block' }} />
      {APP_NAME}
    </Link>
  )
}
