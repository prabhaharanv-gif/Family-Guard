import { useState, useEffect, useCallback } from 'react'
import { registerPlugin, Capacitor } from '@capacitor/core'
import { useT } from '../i18n'

const SOSAlarm  = registerPlugin('SOSAlarm')
const CallAlarm = registerPlugin('CallAlarm')

const STORAGE_KEY = 'sos_oem_setup_done_v1'
const VISITED_KEY = 'sos_oem_visited_v1'

/**
 * SosReliabilitySetup
 *
 * On restrictive OEMs (Xiaomi/Redmi/POCO, OPPO/Realme, Vivo, Huawei/Honor), a
 * killed app cannot show the full-screen SOS alert over the lock screen unless
 * the user manually enables "Autostart" and "Display pop-up windows while
 * running in background". These live on OEM-specific settings pages.
 *
 * ── Why this is one checklist and not a wizard ───────────────────────────────
 * It used to be a step-per-permission flow: a full sheet each for autostart,
 * pop-ups, overlay and full-screen intents, with Back / "I've done this — Next"
 * between them. Two problems, both of which put people off granting anything:
 *
 *   It looked like a gauntlet. Four sheets of system-permission language, with
 *   progress dots promising more, is a lot to meet before you have decided the
 *   app is worth trusting. One short list of switches asks for the same things
 *   and reads as a small job.
 *
 *   It asked for the same permission twice. The evidence-led step shown after a
 *   blocked call and the generic "Allow Pop-up Alerts" step ran the same
 *   openAppDetails() with the same hint, so someone who had just done as they
 *   were told was sent back to do it again — which reads as "it didn't work".
 *   Now there is one row per permission, and the blocked call is a line of
 *   context above the list rather than a step of its own.
 *
 * ── Disappearing on its own ─────────────────────────────────────────────────
 * Nothing here needs a "Done" tap. evaluate() re-runs on every return to the
 * app, so a permission granted in Settings is noticed on the way back and the
 * sheet closes itself.
 *
 * That is exact for the two permissions Android will answer for — overlay and
 * full-screen intents. Autostart and the pop-up permission cannot be read back
 * on MIUI or ColorOS by any API, so for those "done" means the person opened
 * that page and came back. That is a guess, and it is deliberately a generous
 * one: the alternative is a sheet that can never close by itself.
 *
 * The guess is safe because it is not the last word. When CallRingingService or
 * SOSSirenService launches its alert Activity and the Activity does not appear,
 * that IS the pop-up permission being refused, and the native side records it
 * (KEY_ALERT_BLOCKED). evaluate() reads that before honouring any stored flag,
 * clears the optimistic mark on the row it concerns, and reopens the sheet. So
 * a permission that was never really granted comes back on evidence, and one
 * that was stays gone. The next alert that does reach the screen clears the
 * flag, so this stops on its own once the phone is set up.
 *
 * Dismissing clears that evidence too — see dismiss().
 */

// Reset only by a process restart, which is exactly the cadence wanted: a
// verifiably-missing permission is raised once per app start, never repeatedly
// while someone moves between apps.
let reopenedThisLaunch = false

const readVisited = () => {
  try { return JSON.parse(localStorage.getItem(VISITED_KEY) || '{}') } catch { return {} }
}
const writeVisited = (v) => {
  try { localStorage.setItem(VISITED_KEY, JSON.stringify(v)) } catch {}
}

// ── Row icons ────────────────────────────────────────────────────────────────
// Drawn rather than emoji: the previous 📵 / 🪟 / 🔓 rendered in whatever the
// OEM's font decided, sat oddly against the app's own icons, and two of them
// said the wrong thing — 📵 means "phones prohibited", and a window pane is a
// poor stand-in for a pop-up alert.
const Icons = {
  autostart: <><circle cx="12" cy="12" r="9" /><path d="M10 8.5 L16 12 L10 15.5 Z" /></>,
  popup:     <><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 21h8" /><path d="M8.5 9.5h7v5h-7z" /></>,
  overlay:   <><rect x="3" y="7" width="12" height="12" rx="2" /><path d="M9 4h10a1 1 0 0 1 1 1v10" /></>,
  fullscreen:<><path d="M4 9V5a1 1 0 0 1 1-1h4" /><path d="M20 9V5a1 1 0 0 0-1-1h-4" /><path d="M4 15v4a1 1 0 0 0 1 1h4" /><path d="M20 15v4a1 1 0 0 1-1 1h-4" /></>,
}

function RowIcon({ shape, done }) {
  if (done) {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
        <circle cx="12" cy="12" r="10" fill="#059669" />
        <polyline points="7.5 12.4 10.6 15.4 16.5 8.9" fill="none" stroke="#fff"
                  strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#8B0D3D"
         strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      {shape}
    </svg>
  )
}

export default function SosReliabilitySetup() {
  const t = useT()
  const [info, setInfo]           = useState(null)
  const [visible, setVisible]     = useState(false)
  const [overlayOk, setOverlayOk] = useState(true)
  const [visited, setVisited]     = useState(readVisited)
  // Set by the native side after an alert failed to reach the screen.
  const [alertBlocked, setAlertBlocked] = useState(false)

  // Re-checked on every return to the app, not just at startup: the user leaves
  // to a system settings page to grant these, so coming back is the only moment
  // the result can be seen. This is what closes the sheet without a Done tap.
  const evaluate = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return

    // Asked BEFORE the dismissal flag is honoured: a phone that has since
    // refused to show an alert overrides an earlier "don't show me again".
    let blocked = false
    try { blocked = (await CallAlarm.getAlertBlocked())?.blocked === true } catch {}
    setAlertBlocked(blocked)

    // Evidence beats the optimistic mark. If an alert was blocked then the
    // pop-up permission is off no matter who tapped what, so drop that row's
    // tick and let the list ask again.
    let marks = readVisited()
    if (blocked && marks.popup) {
      marks = { ...marks, popup: false }
      writeVisited(marks)
    }
    setVisited(marks)

    let dismissed = false
    try { dismissed = localStorage.getItem(STORAGE_KEY) === '1' } catch {}

    // The device is asked BEFORE the dismissal flag is honoured, because on MIUI
    // the pop-up permission is readable and a stored "setup complete" over a
    // permission Android will say is missing is simply wrong — that is the state
    // this phone was left in: flag set, alerts still refused.
    let device = null
    try { device = await SOSAlarm.getDeviceInfo() } catch { return }

    // A failed read must not read as "granted".
    //
    // This was `canOverlay = (await ...)?.granted !== false` with an empty
    // catch, so a rejected bridge call or a malformed reply both left it true:
    // the overlay row would silently drop out of the list and, with the other
    // rows done, the sheet would close AND write its never-show-again flag over
    // a permission nobody had checked. On a safety checklist the unknown case
    // has to fail towards asking, not towards done.
    //
    // `overlayKnown` is what carries that. An unknown reading still keeps the
    // row out of the list — a row nobody can clear would be worse, and
    // openOverlaySettings() would likely fail for the same reason the read did
    // — but it withholds the flag, so the next launch asks Android again
    // instead of trusting a guess forever.
    let canOverlay = true
    let overlayKnown = false
    try {
      const res = await CallAlarm.canDrawOverlays()
      if (typeof res?.granted === 'boolean') { canOverlay = res.granted; overlayKnown = true }
    } catch { /* left unknown on purpose */ }

    setInfo(device)
    setOverlayOk(canOverlay)

    // Closing without a tap, in both senses: everything is granted, or — when a
    // blocked alert was recorded on a phone that is not one of the restrictive
    // OEMs and already holds every permission Android will report on — there is
    // simply nothing left to ask for. Showing an empty checklist would be worse
    // than showing nothing, so the evidence is cleared and the sheet stays away.
    const rows = neededRows(device, canOverlay, marks)

    // A dismissal covers the rows we can only guess at. It does not cover one
    // Android will answer for: if a verifiable permission is off, the sheet
    // comes back — once per app start, not on every return to the foreground,
    // so it states the problem without hounding somebody who tapped Not now.
    const provableGap = rows.some(r => !r.done && r.verifiable)
    if (dismissed && !(provableGap && !reopenedThisLaunch)) { setVisible(false); return }
    if (provableGap) {
      reopenedThisLaunch = true
      // Reopening means the stored "complete" is no longer true, so drop it.
      // Without this the flag stayed set while the sheet was on screen, and the
      // very next foreground — the one where they return from Settings — took
      // the branch above and closed the sheet under them, whether or not they
      // had granted anything.
      try { localStorage.removeItem(STORAGE_KEY) } catch {}
    }

    if (rows.length === 0 || rows.every(r => r.done)) {
      // Only remember "setup complete" when every reading behind it was real.
      if (overlayKnown) { try { localStorage.setItem(STORAGE_KEY, '1') } catch {} }
      if (blocked) { try { CallAlarm.clearAlertBlocked() } catch {} }
      setVisible(false)
      return
    }

    setVisible(true)
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
    // The recorded failure is spent once it has been shown and acted on.
    // Leaving it set would make this sheet undismissable: evaluate() ignores the
    // never-show-again flag while a failure stands, by design, so it would come
    // back on every foreground for good. If the permission really is still off,
    // the next blocked alert records it again and the sheet returns on that.
    setAlertBlocked(false)
    try { CallAlarm.clearAlertBlocked() } catch {}
  }

  // Marked as we leave, not on return, because the unverifiable rows have
  // nothing to read on the way back — see the note at the top of the file.
  // Where a row IS verifiable (the MIUI pop-up ops, the overlay), the mark is
  // irrelevant: neededRows reads the permission itself and ignores it.
  const markVisited = (...keys) => {
    const next = { ...visited }
    keys.forEach(k => { next[k] = true })
    writeVisited(next)
    setVisited(next)
  }

  // The OEM permissions page: pop-up in background, show on lock screen, and
  // display over other apps all live here, which is why it is the one button.
  const openAppDetails = () => {
    markVisited('popup')
    try { SOSAlarm.openAppDetailsSettings() } catch {}
  }

  const openAutostart = () => {
    markVisited('autostart')
    try { SOSAlarm.openAutostartSettings() } catch {}
  }

  const rows = buildRows(t, info, overlayOk, visited)
  const remaining = rows.filter(r => !r.done).length

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100000,
      background: 'rgba(42,10,24,0.72)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div style={{
        width: '100%', maxWidth: 460, background: '#fff',
        borderRadius: '24px 24px 0 0', padding: '22px 20px 26px',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.25)',
        animation: 'sosSetupUp 0.28s ease',
      }}>
        <style>{`@keyframes sosSetupUp{from{transform:translateY(40px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>

        <div style={{
          width: 38, height: 4, borderRadius: 2, background: '#ECE0E5',
          margin: '0 auto 18px',
        }} />

        {/* Lead with what it buys, not with the word "permission". */}
        <div style={{ fontSize: 20, fontWeight: 800, color: '#2A0A18', marginBottom: 8, letterSpacing: -0.3 }}>
          {t('reliability.title')}
        </div>
        <p style={{ fontSize: 14, color: '#6B4152', lineHeight: 1.5, marginBottom: alertBlocked ? 14 : 18 }}>
          {t('reliability.intro', {
            oem: oemLabel(t, info),
            switches: remaining === 1
              ? t('reliability.oneSwitch')
              : t('reliability.someSwitches', { n: remaining }),
          })}
        </p>

        {/* Only when the phone has actually failed to show one — the concrete
            thing that happened, stated once, instead of a step of its own. */}
        {alertBlocked && (
          <div style={{
            background: '#FEF0F5', border: '1px solid #F5D6E1', borderRadius: 12,
            padding: '10px 13px', marginBottom: 16, fontSize: 13,
            color: '#8B0D3D', lineHeight: 1.5, fontWeight: 600,
          }}>
            {t('reliability.blocked')}
          </div>
        )}

        {/* One list, no per-row buttons.
            Every toggle below Autostart lives on the same OEM permissions page,
            so a button per row sent people to different screens for switches
            sitting side by side. That is how the wrong one kept getting
            flipped — on this phone an already-granted overlay permission got
            turned back off while hunting for another. The list says what to
            switch on; the single button opens the page holding them. */}
        <div style={{
          border: '1px solid #ECE0E5', borderRadius: 16, overflow: 'hidden', marginBottom: 16,
        }}>
          {rows.map((row, i) => (
            <div key={row.key} style={{
              display: 'flex', alignItems: 'flex-start', gap: 11,
              padding: '12px 14px',
              borderTop: i === 0 ? 'none' : '1px solid #F3E9ED',
              background: row.done ? '#F7FBF9' : '#fff',
            }}>
              <div style={{ paddingTop: 1 }}><RowIcon shape={row.icon} done={row.done} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 14, fontWeight: 700,
                  color: row.done ? '#3F7460' : '#2A0A18', marginBottom: 2,
                }}>
                  {row.label}
                </div>
                <div style={{ fontSize: 12.5, color: '#8A6675', lineHeight: 1.45 }}>
                  {row.done ? t('reliability.done') : row.sub}
                </div>
              </div>
            </div>
          ))}
        </div>

        <button onClick={() => openAppDetails()} style={{
          width: '100%', padding: 14, borderRadius: 14,
          background: 'var(--grad-maroon, linear-gradient(135deg,#8B0D3D,#A5124A))',
          border: 'none', color: '#fff', fontWeight: 800, fontSize: 15,
          fontFamily: 'inherit', cursor: 'pointer',
          boxShadow: '0 6px 18px rgba(139,13,61,0.28)',
        }}>
          {t('reliability.openSettings')}
        </button>

        {/* Autostart is the one switch that genuinely lives elsewhere — a
            separate activity in the OEM's security app. It gets a quiet link
            rather than a second loud button. */}
        {rows.some(r => r.key === 'autostart' && !r.done) && (
          <button onClick={() => openAutostart()} style={{
            width: '100%', marginTop: 10, padding: 9, background: 'none',
            border: 'none', color: '#8B0D3D', fontSize: 13.5, fontWeight: 700,
            fontFamily: 'inherit', cursor: 'pointer', textDecoration: 'underline',
          }}>
            {t('reliability.openAutostart')}
          </button>
        )}

        {/* No "Done": the sheet closes itself when the list is complete. This is
            only the way out for someone who does not want to do it now. */}
        <button onClick={dismiss} style={{
          width: '100%', padding: 10, background: 'none', border: 'none',
          color: '#836370', fontSize: 13.5, fontFamily: 'inherit',
          cursor: 'pointer', textDecoration: 'underline',
        }}>
          {t('reliability.notNow')}
        </button>
      </div>
    </div>
  )
}

function oemLabel(t, info) {
  return {
    xiaomi: 'Xiaomi / Redmi / POCO',
    oppo:   'OPPO / Realme',
    vivo:   'Vivo',
    huawei: 'Huawei / Honor',
  }[info.oem] || t('reliability.someAndroid')
}

// Which permissions this phone still needs — and nothing user-facing in it.
//
// evaluate() decides whether to close the sheet from this list, and keeping it
// free of translated text is what keeps evaluate() out of the render cycle:
// useT() hands back a new function identity every render, so a `t` in
// evaluate's dependency array would rebuild the callback each time and leave
// its effect adding and removing listeners forever.
//
// `verifiable` is the honest part: true means Android answered the question and
// `done` is a fact; false means nothing can read it back and `done` is only
// "they went to the page". Nothing in the UI distinguishes the two — to the
// person granting them it is the same job — but open() and the blocked-alert
// evidence both depend on knowing which is which.
function neededRows(info, overlayOk, visited) {
  const rows = []

  if (info.isRestrictive) {
    rows.push({ key: 'autostart', verifiable: false, done: visited.autostart === true })

    // On MIUI the pop-up permission IS readable, through two private AppOps —
    // see MainActivity.canPopupOverLockScreen. Where the ROM answers, this row
    // stops being a guess: it clears only when the alert can genuinely reach
    // the screen, and stays put otherwise no matter how many times the settings
    // page was opened.
    //
    // That distinction was not academic. On the test Redmi someone granted
    // "Display over other apps", which is a different permission on a different
    // screen; the row marked itself done, the overlay row correctly vanished
    // because that op really was allowed, and the sheet closed over a phone
    // that was still refusing every alert — appops recorded a fresh
    // "MIUIOP(10020): ignore; rejectTime" each time one tried.
    rows.push(info.popupKnown === true
      ? { key: 'popup', verifiable: true,  done: info.popupGranted === true }
      : { key: 'popup', verifiable: false, done: visited.popup === true })
  }

  // These two are only ever listed while they are off, because Android answers
  // for them: granting one simply removes it from the list next time round.
  if (!overlayOk) rows.push({ key: 'overlay', verifiable: true, done: false })
  if (info.canUseFullScreenIntent === false) rows.push({ key: 'fsi', verifiable: true, done: false })

  return rows
}

// Presentation for each key. Derived from neededRows rather than repeating its
// conditions, so the list the sheet shows and the list it closes on cannot
// drift apart.
function buildRows(t, info, overlayOk, visited) {
  const dress = {
    autostart: {
      icon: Icons.autostart,
      label: t('reliability.autostart'),
      sub: t('reliability.autostartSub'),
      fn: () => SOSAlarm.openAutostartSettings(),
    },
    popup: {
      icon: Icons.popup,
      label: t('reliability.popup'),
      sub: popupHint(info),
      fn: () => SOSAlarm.openAppDetailsSettings(),
    },
    overlay: {
      icon: Icons.overlay,
      label: t('reliability.overlay'),
      sub: t('reliability.overlaySub'),
      fn: () => CallAlarm.openOverlaySettings(),
    },
    fsi: {
      icon: Icons.fullscreen,
      label: t('reliability.fullscreen'),
      sub: t('reliability.fullscreenSub'),
      fn: () => SOSAlarm.openFullScreenIntentSettings(),
    },
  }

  return neededRows(info, overlayOk, visited).map(row => ({ ...row, ...dress[row.key] }))
}

/* i18n-exempt:start — these are the literal labels on the OEM's own settings
   screen, quoted so the person can match them by eye. Translating them would
   describe a toggle whose caption does not say that, which is worse than an
   English string: MIUI in India overwhelmingly runs in English even where the
   app is set to another language. The surrounding UI is translated; only the
   captions being hunted for are not. */

// The wording differs per OEM because the toggle is named differently on each,
// and a person hunting a settings screen needs the label their phone uses.
function popupHint(info) {
  return {
    // BOTH toggles, because canPopupOverLockScreen requires both ops (10021
    // and 10020). Naming only one would leave the row unclearable for someone
    // who did exactly as they were told.
    xiaomi: 'Other permissions → turn on "Display pop-up windows while running in background" AND "Show on lock screen"',
    oppo:   'Allow "Display pop-up window while running in background"',
    vivo:   'Allow "Display pop-up window while running in background"',
    huawei: 'Allow "Show pop-up windows while running in background"',
  }[info.oem] || 'Allow "Display over other apps"'
}
/* i18n-exempt:end */
