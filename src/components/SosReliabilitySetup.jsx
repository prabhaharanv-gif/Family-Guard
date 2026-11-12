import { useState, useEffect, useCallback } from 'react'
import { registerPlugin, Capacitor } from '@capacitor/core'
import { useT } from '../i18n'

const SOSAlarm  = registerPlugin('SOSAlarm')
const CallAlarm = registerPlugin('CallAlarm')

const STORAGE_KEY = 'sos_oem_setup_done_v1'
const VISITED_KEY = 'sos_oem_visited_v1'
// Skips the very first time this sheet would otherwise appear, which used to
// be the moment someone first opened the app after signup — a full-screen
// permission wall before they had seen a single other screen. One skip is
// enough: it costs nothing on returning users (already past this key) and
// gives a first-time user one look at the app before being asked for OS
// settings most of them have never heard of.
const FIRST_SHOWN_KEY = 'sos_oem_first_shown_v1'

/**
 * SosReliabilitySetup
 *
 * On restrictive OEMs (Xiaomi/Redmi/POCO, OPPO/Realme, Vivo, Huawei/Honor), a
 * killed app cannot show the full-screen SOS alert over the lock screen unless
 * the user manually enables "Autostart" and "Display pop-up windows while
 * running in background". These live on OEM-specific settings pages.
 *
 * ── One prompt at a time (changed 2026-10-13) ───────────────────────────────
 * Now a centred system-style dialog showing one permission at a time, with
 * Allow / Not now / Don't ask again. The history below explains why it was a
 * checklist before; the user asked for the one-by-one prompt back, kept to a
 * single small dialog with a "2 of 4" count rather than full sheets.
 *
 * ── Why this was one checklist and not a wizard ───────────────────────────────
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
// Steps the person passed on with "Not now" — held for this app start only, so
// a skipped step is asked again next launch but not on every return from Settings.
const skippedThisLaunch = new Set()

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
  fullscreen:<><path d="M4 9V5a1 1 0 0 1 1-1h4" /><path d="M20 9V5a1 1 0 0 0-1-1h-4" /><path d="M4 15v4a1 1 0 0 0 1 1h4" /><path d="M20 15v4a1 1 0 0 1-1 1h-4" /></>,
  // Crossed-out bell — Do Not Disturb.
  dnd:       <><path d="M9 19a3 3 0 0 0 6 0" /><path d="M6 15V10a6 6 0 0 1 9.3-5" /><path d="M18 11v4l2 3H8" /><path d="m4 4 16 16" /></>,
}

// The row's own identity icon (autostart/popup/overlay/…), always drawn the
// same way regardless of status.
function RowIcon({ shape, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--maroon)"
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
  const [skipped, setSkipped]     = useState(() => new Set(skippedThisLaunch))

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

    // Closing without a tap: everything is granted, or — when a blocked alert
    // was recorded on a phone that is not one of the restrictive OEMs and
    // already holds every permission Android will report on — there is simply
    // nothing left to ask for.
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

    if (rows.every(r => r.done)) {
      // Only remember "setup complete" when every reading behind it was real.
      if (overlayKnown) { try { localStorage.setItem(STORAGE_KEY, '1') } catch {} }
      if (blocked) { try { CallAlarm.clearAlertBlocked() } catch {} }
      setVisible(false)
      return
    }

    // Give a brand-new install one pass before ever showing this: skip the
    // very first time it would appear, but not the state that led here — the
    // next evaluate() (next return to the app) shows it normally.
    let firstShown = true
    try { firstShown = localStorage.getItem(FIRST_SHOWN_KEY) === '1' } catch {}
    if (!firstShown) {
      try { localStorage.setItem(FIRST_SHOWN_KEY, '1') } catch {}
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

  // The standard App Details page — where MIUI keeps "Other permissions" and
  // the pop-up-in-background / show-on-lock-screen toggles inside it.
  const openAppDetails = () => {
    markVisited('popup')
    try { SOSAlarm.openAppDetailsSettings() } catch {}
  }

  const openAutostart = () => {
    markVisited('autostart')
    try { SOSAlarm.openAutostartSettings() } catch {}
  }

  // Overlay, full-screen-intent and DND each live on their own OS settings
  // screen — none of them are on the App Details page. The sheet used to have
  // one button that always called openAppDetails() regardless of which row
  // was pending, so on a phone where DND was the only thing left, tapping it
  // landed on App Details with no DND toggle anywhere on it — a dead end that
  // looked like the app was broken.
  const openOverlay = () => { try { CallAlarm.openOverlaySettings() } catch {} }
  const openFullScreen = () => { try { SOSAlarm.openFullScreenIntentSettings() } catch {} }
  const openDnd = () => { try { SOSAlarm.openDndAccessSettings() } catch {} }

  // Where tapping a row goes. Popup and autostart genuinely share the OEM
  // permissions page family but live on two different activities within it.
  // The merged "fullscreen" row can mean either of two screens depending on
  // which of its two underlying permissions Android still says is missing
  // (see neededRows) — needsOverlay carries that, so the row resolves to the
  // right one instead of always defaulting to overlay.
  const simpleRowActions = { autostart: openAutostart, popup: openAppDetails, dnd: openDnd }
  const handleRowTap = (row) => {
    if (row.key === 'fullscreen') { (row.needsOverlay ? openOverlay : openFullScreen)(); return }
    simpleRowActions[row.key]?.()
  }

  const rows = buildRows(t, info, overlayOk, visited)

  // One permission at a time, like a system prompt: the first row still to do
  // and not passed over. Granting it (verified on return, or marked on leaving
  // the settings page) moves straight to the next; when nothing is left the
  // dialog simply isn't drawn.
  const current = rows.find(r => !r.done && !skipped.has(r.key))
  if (!current) return null
  const step = rows.indexOf(current) + 1

  const skip = () => {
    skippedThisLaunch.add(current.key)
    setSkipped(new Set(skippedThisLaunch))
  }

  const total = rows.length

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100000,
      background: 'rgba(42,10,24,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 22,
    }}>
      <div role="dialog" aria-modal="true" style={{
        width: '100%', maxWidth: 330, background: '#fff', borderRadius: 24,
        padding: '24px 22px 14px', textAlign: 'center',
        animation: 'sosSetupPop 0.2s ease',
      }}>
        <style>{`@keyframes sosSetupPop{from{transform:scale(0.94);opacity:0}to{transform:scale(1);opacity:1}}`}</style>

        {/* Soft tinted disc behind the line icon — the same treatment as the
            other prompts, so it reads as part of the app and not a system wall. */}
        <div style={{
          width: 68, height: 68, borderRadius: 34, margin: '0 auto 16px',
          background: '#FCE7F0', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <RowIcon shape={current.icon} size={32} />
        </div>

        {/* Lead with what the person gets, not the Android permission name. */}
        <div style={{ fontSize: 19, fontWeight: 800, color: 'var(--text)', lineHeight: 1.25, marginBottom: 8, letterSpacing: -0.2 }}>
          {current.title}
        </div>
        <div style={{ fontSize: 14.5, color: '#5E3A4B', lineHeight: 1.5, marginBottom: 14 }}>
          {current.why}
        </div>

        {alertBlocked && (current.key === 'popup' || current.key === 'fullscreen') && (
          <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--maroon)', fontWeight: 600, lineHeight: 1.45 }}>
            {t('reliability.blocked')}
          </div>
        )}

        {/* The fear is "what is this really letting it do". Say plainly what it
            is for and that it can be undone — inside a soft box, not a popup. */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 9, textAlign: 'left',
          background: '#F4F9F6', border: '1px solid #D5EADF', borderRadius: 14,
          padding: '10px 12px', marginBottom: 8,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2F7D5B"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z" /><path d="m9 12 2.2 2.2L15.5 10" />
          </svg>
          <div style={{ fontSize: 13, color: '#2F5D49', lineHeight: 1.45 }}>
            {t('reliability.reassure')}
          </div>
        </div>
        <div style={{ fontSize: 12.5, color: '#7A5565', lineHeight: 1.45, marginBottom: 16 }}>
          {t(current.key === 'popup' ? 'reliability.howOther' : 'reliability.how')}
        </div>

        <button onClick={() => handleRowTap(current)} style={{
          width: '100%', padding: '14px 10px', borderRadius: 14, border: 'none',
          background: 'linear-gradient(135deg, var(--maroon), var(--maroon-deep))',
          color: '#fff', fontSize: 16, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
        }}>
          {t('reliability.allow')}
        </button>
        <button onClick={skip} style={{
          width: '100%', padding: '12px 10px', marginTop: 4, background: 'none', border: 'none',
          color: 'var(--maroon)', fontSize: 15, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
        }}>
          {t('reliability.notNow')}
        </button>

        {/* Progress as dots, not "2 of 4" — shows the job is small and moving. */}
        {total > 1 && (
          <div aria-label={t('reliability.stepOf', { n: step, total })}
               style={{ display: 'flex', justifyContent: 'center', gap: 6, margin: '4px 0 6px' }}>
            {rows.map((r, i) => (
              <span key={r.key} style={{
                width: i + 1 === step ? 18 : 6, height: 6, borderRadius: 3,
                background: i + 1 === step ? 'var(--maroon)' : (r.done ? '#2F7D5B' : '#E6D3DB'),
              }} />
            ))}
          </div>
        )}
        <button onClick={dismiss} style={{
          background: 'none', border: 'none', padding: '8px 10px', color: '#8A6675',
          fontSize: 12.5, fontFamily: 'inherit', cursor: 'pointer', textDecoration: 'underline',
        }}>
          {t('reliability.dontAsk')}
        </button>
      </div>
    </div>
  )
}

// Which permissions this phone needs, and their current status — nothing
// user-facing in it.
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
//
// Rows for the permissions Android can verify (fullscreen, dnd) are always
// returned, granted or not, so a row that gets fixed while the sheet is open
// flips to a checkmark and stays visible instead of vanishing from the list —
// the person can see what they just did, not just that the list got shorter.
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

  // Full-screen delivery genuinely depends on TWO permissions, not one, and
  // both are load-bearing — this isn't a legacy ask that a newer API made
  // redundant. SYSTEM_ALERT_WINDOW is what lets SOSSirenService/
  // CallRingingService launch the alert Activity directly from the
  // background when the OS would otherwise block it ("Abort background
  // activity starts" in logcat); USE_FULL_SCREEN_INTENT (Android 14+) is what
  // the notification's own setFullScreenIntent() needs, and is the belt to
  // the overlay permission's suspenders on OEMs where full-screen intents get
  // silently demoted to a quiet notification. One row either way — the person
  // is being asked for "full-screen alerts" once, not twice — but it resolves
  // to whichever of the two Android still says is missing.
  const overlayMissing = !overlayOk
  const fsiMissing = info.canUseFullScreenIntent === false
  rows.push({
    key: 'fullscreen',
    verifiable: true,
    done: !overlayMissing && !fsiMissing,
    needsOverlay: overlayMissing,
  })

  // Do Not Disturb access. Listed on every phone, not just the restrictive
  // OEMs, because this one is plain Android: while DND is on, zen mutes
  // USAGE_ALARM above the app, so the SOS siren plays into a muted stream and
  // the alert lands in silence. Nothing in the app can work around it — the
  // access is the workaround.
  //
  // `!== false` rather than a plain boolean: an older native build that
  // predates dndAccess sends undefined, and a missing field must not read as
  // a missing permission and park an unclearable row on the checklist.
  rows.push({ key: 'dnd', verifiable: true, done: info.dndAccess !== false })

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
      title: t('reliability.autostartTitle'),
      why: t('reliability.autostartWhy'),
    },
    popup: {
      icon: Icons.popup,
      label: t('reliability.popup'),
      sub: t('reliability.popupSub'),
      title: t('reliability.popupTitle'),
      why: t('reliability.popupWhy'),
    },
    fullscreen: {
      icon: Icons.fullscreen,
      label: t('reliability.fullscreen'),
      sub: t('reliability.fullscreenSub'),
      title: t('reliability.fullscreenTitle'),
      why: t('reliability.fullscreenWhy'),
    },
    dnd: {
      icon: Icons.dnd,
      label: t('reliability.dnd'),
      sub: t('reliability.dndSub'),
      title: t('reliability.dndTitle'),
      why: t('reliability.dndWhy'),
    },
  }

  return neededRows(info, overlayOk, visited).map(row => ({ ...row, ...dress[row.key] }))
}
