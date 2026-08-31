import { useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { useLocationConsentStore } from '../store/locationConsentStore'

/**
 * Google Play prominent disclosure for background location.
 *
 * Policy requirements this screen exists to satisfy:
 *   • Shown BEFORE the runtime location permission dialog, not after.
 *   • Stands alone — it is not buried in the privacy policy, a ToS, or an
 *     onboarding carousel the user swipes past.
 *   • States what is collected, that collection continues "even when the app
 *     is closed or not in use", and what the data is used for.
 *   • Offers a genuine decline that leaves the rest of the app usable.
 *
 * Declining is not a dead end: the app still works, family chat and SOS still
 * work, and the user simply does not appear on the map.
 */
export default function BackgroundLocationDisclosure() {
  const { grant, decline } = useLocationConsentStore()
  const [busy, setBusy] = useState(false)

  const handleAccept = async () => {
    setBusy(true)
    try {
      if (Capacitor.isNativePlatform()) {
        // Android requires the foreground grant before "Allow all the time"
        // can even be offered, so ask in two steps rather than one.
        await Geolocation.requestPermissions({ permissions: ['location'] })
        try {
          await Geolocation.requestPermissions({ permissions: ['coarseLocation', 'location'] })
        } catch { /* older platforms expose only the single prompt */ }
      }
    } catch {
      // A denied or dismissed system prompt is not an error we surface here —
      // consent is recorded, and the service simply gets no fixes until the
      // user grants the permission from Settings.
    } finally {
      grant()
      setBusy(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1200,
      background: '#F8F7FF',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '32px 24px 0' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>📍</div>
          <div style={{
            fontSize: 22, fontWeight: 900, color: '#0D0C1D',
            marginBottom: 8, fontFamily: 'Sora, sans-serif',
          }}>
            FamilyGuard needs your location
          </div>
        </div>

        {/* The disclosure itself — the wording here is what Play reviews. */}
        <div style={{
          background: '#fff', borderRadius: 18, padding: '18px 20px',
          marginBottom: 14, border: '1.5px solid #E8DFFF',
          boxShadow: '0 2px 12px rgba(149,19,69,0.08)',
        }}>
          <div style={{ fontSize: 14, color: '#3A1020', lineHeight: 1.65, fontWeight: 500 }}>
            FamilyGuard collects location data to show your position on your
            family's map and to attach your location to an SOS alert, <strong>even
            when the app is closed or not in use</strong>.
          </div>
        </div>

        {[
          { icon: '👨‍👩‍👧', text: 'Your location is visible only to members of your own family group — never to anyone else' },
          { icon: '🆘', text: 'If you send an SOS, your family sees where you are immediately' },
          { icon: '🔔', text: 'While background tracking is on, a permanent notification stays in your status bar' },
          { icon: '🛑', text: 'You can turn location sharing off at any time in Profile → Privacy' },
          { icon: '🚫', text: 'We never sell your location, share it with third parties, or use it for advertising' },
        ].map((item, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 14,
            background: '#fff', borderRadius: 14, padding: '14px 16px',
            marginBottom: 10, border: '1px solid #F0EAF5',
            boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
          }}>
            <span style={{ fontSize: 22, flexShrink: 0 }}>{item.icon}</span>
            <span style={{ fontSize: 13, color: '#374151', lineHeight: 1.45 }}>{item.text}</span>
          </div>
        ))}

        <div style={{ height: 8 }} />
      </div>

      {/* Actions pinned at the bottom so both choices are equally reachable */}
      <div style={{
        flexShrink: 0, padding: '16px 24px 28px',
        borderTop: '1px solid #EFEAF7', background: '#F8F7FF',
      }}>
        <button onClick={handleAccept} disabled={busy} style={{
          width: '100%', padding: 16, borderRadius: 16,
          background: 'linear-gradient(135deg, #951345, #720D35)',
          border: 'none', color: '#fff', fontWeight: 800,
          fontSize: 15, fontFamily: 'inherit',
          cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1,
          boxShadow: '0 6px 20px rgba(149,19,69,0.35)',
        }}>
          {busy ? 'Just a moment…' : 'Allow location sharing'}
        </button>

        <button onClick={decline} disabled={busy} style={{
          width: '100%', padding: '14px 16px', borderRadius: 14, marginTop: 10,
          background: 'transparent', border: '1.5px solid #E9E6FB',
          color: '#6B7280', fontWeight: 700, fontSize: 14,
          fontFamily: 'inherit', cursor: busy ? 'default' : 'pointer',
        }}>
          Not now
        </button>

        <div style={{ fontSize: 11, color: '#9CA3AF', textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>
          You can still use messages, SOS and your family group without sharing location.
        </div>
      </div>
    </div>
  )
}
