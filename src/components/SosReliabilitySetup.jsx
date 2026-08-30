import { useState, useEffect, useCallback } from 'react'
import { registerPlugin, Capacitor } from '@capacitor/core'
import { useT } from '../i18n'

const SOSAlarm  = registerPlugin('SOSAlarm')
const CallAlarm = registerPlugin('CallAlarm')

const STORAGE_KEY = 'sos_oem_setup_done_v1'

/**
 * SosReliabilitySetup
 *
 * On restrictive OEMs (Xiaomi/Redmi/POCO, OPPO/Realme, Vivo, Huawei/Honor), a
 * killed app cannot show the full-screen SOS alert over the lock screen unless
 * the user manually enables "Autostart" and "Display pop-up windows while
 * running in background". These live on OEM-specific settings pages.
 *
 * This one-time gate detects those devices and walks the user to the right
 * pages. It stores a flag once completed so it never nags again. It renders
 * nothing on stock Android or once the user has dismissed it.
 */
export default function SosReliabilitySetup() {
  const t = useT()
  const [info, setInfo]       = useState(null)
  const [visible, setVisible] = useState(false)
  const [step, setStep]       = useState(0)
  const [overlayOk, setOverlayOk] = useState(true)

  // Re-checked on every return to the app, not just at startup: the user
  // leaves to a system settings page to grant these, so the only moment we
  // can see the result is when they come back. Without this the setup sheet
  // stayed on screen even after everything had been granted.
  const evaluate = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return
    try { if (localStorage.getItem(STORAGE_KEY) === '1') { setVisible(false); return } } catch {}

    let device = null
    try { device = await SOSAlarm.getDeviceInfo() } catch { return }

    let canOverlay = true
    try { canOverlay = (await CallAlarm.canDrawOverlays())?.granted !== false } catch {}

    setInfo(device)
    setOverlayOk(canOverlay)

    // Autostart cannot be read back on MIUI/ColorOS — there is no API for it —
    // so completion is judged on the permissions we CAN verify. Gating on the
    // unverifiable one would mean the sheet could never close by itself.
    const fsiOk = device.canUseFullScreenIntent !== false
    if (fsiOk && canOverlay) {
      try { localStorage.setItem(STORAGE_KEY, '1') } catch {}
      setVisible(false)
      return
    }

    if (device.isRestrictive || !fsiOk || !canOverlay) setVisible(true)
  }, [])

  useEffect(() => {
    evaluate()
    const onVisible = () => { if (document.visibilityState === 'visible') evaluate() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [evaluate])

  if (!visible || !info) return null

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, '1') } catch {}
    setVisible(false)
  }

  const openAutostart = () => { try { SOSAlarm.openAutostartSettings() } catch {} }
  const openAppDetails = () => { try { SOSAlarm.openAppDetailsSettings() } catch {} }
  const openFsi = () => { try { SOSAlarm.openFullScreenIntentSettings() } catch {} }
  const openOverlay = () => { try { CallAlarm.openOverlaySettings() } catch {} }

  const oemLabel = {
    xiaomi: 'Xiaomi / Redmi / POCO',
    oppo:   'OPPO / Realme',
    vivo:   'Vivo',
    huawei: 'Huawei / Honor',
    other:  'your device',
  }[info.oem] || 'your device'

  // OEM-specific instruction for the pop-up permission
  const popupHint = {
    xiaomi: 'Tap "Other permissions" → turn ON "Display pop-up windows while running in background" and "Show on lock screen".',
    oppo:   'Enable "Allow floating windows" / "Display pop-up window while running in background".',
    vivo:   'Enable "Display pop-up window while running in background" and "Show on lock screen".',
    huawei: 'Enable "Show pop-up windows while running in background".',
    other:  'Allow "Display over other apps" / "Appear on top".',
  }[info.oem] || 'Allow "Display over other apps".'

  const steps = [
    {
      title: '🔓 Allow Autostart',
      body: `On ${oemLabel} phones, Famora must be allowed to start on its own so SOS alerts arrive even when the app is closed.`,
      action: { label: t('reliability.openAutostart'), fn: openAutostart },
      hint: 'Find Famora in the list and turn it ON, then come back here.',
    },
    {
      title: '🪟 Allow Pop-up Alerts',
      body: 'Famora needs permission to show the full-screen SOS alert over your lock screen.',
      action: { label: t('reliability.openPermissions'), fn: openAppDetails },
      hint: popupHint,
    },
    ...(!overlayOk ? [{
      title: '🔔 Allow Display Over Other Apps',
      body: 'This lets an incoming call take over the screen while you are using the phone, instead of appearing as a small banner.',
      action: { label: t('reliability.openSetting'), fn: openOverlay },
      hint: 'Turn ON "Display over other apps" (also called "Appear on top") for Famora, then come back here.',
    }] : []),
    ...(info.canUseFullScreenIntent === false ? [{
      title: '📲 Allow Full-Screen Alerts',
      body: 'Your Android version requires granting full-screen notifications for SOS to appear over the lock screen.',
      action: { label: t('reliability.openFullScreen'), fn: openFsi },
      hint: 'Turn ON "Allow full screen notifications" for Famora.',
    }] : []),
  ]

  const current = steps[step]
  const isLast  = step === steps.length - 1

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100000,
      background: 'rgba(13,12,29,0.72)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div style={{
        width: '100%', maxWidth: 460, background: '#fff',
        borderRadius: '24px 24px 0 0', padding: '24px 20px 28px',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.25)',
        animation: 'sosSetupUp 0.28s ease',
      }}>
        <style>{`@keyframes sosSetupUp{from{transform:translateY(40px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>

        {/* Progress dots */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 18 }}>
          {steps.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 22 : 7, height: 7, borderRadius: 4,
              background: i === step ? '#951345' : '#E7DCE2',
              transition: 'all 0.2s',
            }} />
          ))}
        </div>

        <div style={{
          fontSize: 12, fontWeight: 800, color: '#951345',
          letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8,
        }}>
          One-time safety setup
        </div>

        <div style={{ fontSize: 21, fontWeight: 800, color: '#0D0C1D', marginBottom: 10 }}>
          {current.title}
        </div>

        <p style={{ fontSize: 14, color: '#4B4B63', lineHeight: 1.55, marginBottom: 14 }}>
          {current.body}
        </p>

        <div style={{
          background: '#FDF5F8', border: '1px solid #F0E4EA',
          borderRadius: 12, padding: '12px 14px', marginBottom: 20,
          fontSize: 13, color: '#7A5563', lineHeight: 1.5,
        }}>
          💡 {current.hint}
        </div>

        <button onClick={current.action.fn} style={{
          width: '100%', padding: 15, borderRadius: 14,
          background: 'linear-gradient(135deg, #951345, #B01650)',
          border: 'none', color: '#fff', fontWeight: 800, fontSize: 15,
          fontFamily: 'inherit', cursor: 'pointer', marginBottom: 12,
          boxShadow: '0 6px 18px rgba(149,19,69,0.32)',
        }}>
          {current.action.label}
        </button>

        <div style={{ display: 'flex', gap: 10 }}>
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} style={{
              flex: 1, padding: 13, borderRadius: 14, background: '#F8F7FF',
              border: '1px solid #EDE9FF', color: '#6B7280', fontWeight: 700,
              fontFamily: 'inherit', fontSize: 14, cursor: 'pointer',
            }}>Back</button>
          )}
          {!isLast ? (
            <button onClick={() => setStep(s => s + 1)} style={{
              flex: 2, padding: 13, borderRadius: 14,
              background: '#0D0C1D', border: 'none', color: '#fff',
              fontWeight: 700, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer',
            }}>I've done this — Next</button>
          ) : (
            <button onClick={dismiss} style={{
              flex: 2, padding: 13, borderRadius: 14,
              background: '#0D0C1D', border: 'none', color: '#fff',
              fontWeight: 700, fontFamily: 'inherit', fontSize: 14, cursor: 'pointer',
            }}>Done</button>
          )}
        </div>

        <button onClick={dismiss} style={{
          width: '100%', marginTop: 12, padding: 8, background: 'none',
          border: 'none', color: '#9CA3AF', fontSize: 13, fontFamily: 'inherit',
          cursor: 'pointer', textDecoration: 'underline',
        }}>
          Skip for now
        </button>
      </div>
    </div>
  )
}
