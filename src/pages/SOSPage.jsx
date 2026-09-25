import { useState, useEffect, useRef } from 'react'
import { Geolocation } from '@capacitor/geolocation'
import { Capacitor } from '@capacitor/core'
import { supabase } from '../lib/supabase'
import { avatarColor } from '../lib/avatarColor'
import { useAuthStore } from '../store/authStore'
import PullToRefresh from '../components/PullToRefresh'
import Dialog from '../components/Dialog'
import { useT } from '../i18n'
import { SOS } from '../lib/sosColors'
import Icon from '../components/Icon'
import { enterSosSilence, exitSosSilence } from '../lib/nativeSosAlarm'
import NearbySearchMap from '../components/map/NearbySearchMap'
import { SosSenderMedia, SosMediaPlayer } from '../components/SosMedia'
import { helpNumber } from '../lib/nearbyHelp'

// Rejects if `promise` has not settled after `ms`. Used around the two awaits in
// sendSOS that could otherwise never return and leave every SOS button disabled.
const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout after ' + ms + 'ms')), ms)
  Promise.resolve(promise).then(
    v => { clearTimeout(timer); resolve(v) },
    e => { clearTimeout(timer); reject(e) },
  )
})

// Famora Social's opt-in: shared by SOSPage's own Send tab below (where the
// switch now lives) and read by GlobalSOSAlert / NearbySearchMap wherever an
// alert reads it back. Kept here rather than a separate page — see the old
// FamoraSocialPage, removed in favour of this — because opting in belongs
// next to the thing it affects: sending an SOS.
const FAMORA_SOCIAL_CONSENT_TYPE = 'famora_social_visibility'

/**
 * The nearby-helper switch, drawn as a radar: on = a bright disc with a ring
 * that keeps rippling outward (you are "listening" for someone nearby),
 * off = a quiet, dim disc. Lives in the maroon header.
 */
function FamoraSocialToggle({ on, onToggle, label }) {
  return (
    <button
      onClick={onToggle}
      aria-pressed={on}
      aria-label={label}
      title={label}
      style={{
        width: 40, height: 40, borderRadius: '50%', padding: 0,
        background: on ? '#fff' : 'rgba(255,255,255,0.18)',
        color: on ? 'var(--maroon)' : 'rgba(255,255,255,0.85)',
        border: on ? '1.5px solid #fff' : '1.5px solid rgba(255,255,255,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', position: 'relative', flexShrink: 0,
        transition: 'background 0.25s, color 0.25s', boxShadow: 'none',
      }}
    >
      {on && <span className="radar-ripple" />}
      {on && <span className="radar-ripple radar-ripple-2" />}
      <Icon name="radar" size={22} />
    </button>
  )
}

// ── SVG Icon components — consistent outlined style ───────────────────────────
const Icons = {
  Ambulance: () => (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l2-4h10l2 4"/><rect x="1" y="9" width="20" height="11" rx="2"/>
      <path d="M16 20a2 2 0 1 0 4 0 2 2 0 0 0-4 0"/><path d="M4 20a2 2 0 1 0 4 0 2 2 0 0 0-4 0"/>
      <path d="M10 11v4M8 13h4"/>
    </svg>
  ),
  Police: () => (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.25C17.25 22.15 21 17.25 21 12V7L12 2z"/>
      <path d="M9 12l2 2 4-4"/>
    </svg>
  ),
  Fire: () => (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2c0 0-5 5-5 10a5 5 0 0 0 10 0c0-3-2-5-2-5s0 2-2 2c-1 0-1.5-1-1.5-2S12 2 12 2z"/>
      <path d="M10 16.5a2 2 0 0 0 4 0c0-1.5-2-2.5-2-2.5s-2 1-2 2.5z"/>
    </svg>
  ),
  Violence: () => (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      <line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="15" r="1" fill="currentColor"/>
    </svg>
  ),
  Harassment: () => (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="currentColor"/>
    </svg>
  ),
  // History fallback for rows whose reason has no tile any more ("Theft",
  // "Need Money") or never had one ("SOS! I need help!").
  Alert: () => (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="1" fill="currentColor"/>
    </svg>
  ),
  Disaster: () => (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 16.9A5 5 0 0 0 18 7h-1.26A8 8 0 1 0 4 15.25"/>
      <polyline points="13 11 9 17 15 17 11 23"/>
    </svg>
  ),
}

// `label` is the English text stored in sos_alerts.message and read by the
// send-sos-notification function. It stays English deliberately: one alert is
// read by a whole family, who may not share a language, and changing it would
// orphan every row already in the table. `key` is what the UI translates.
/* i18n-exempt:start — `label` is written to sos_alerts.message and read by
   the notification function, so it stays English on purpose; `key` is what
   the UI translates. */
const QUICK_MESSAGES = [
  { key: 'police',     label: 'Need Police Help',  Icon: Icons.Police,     call: '100', emergency: true  },
  { key: 'violence',   label: 'Under Violence',    Icon: Icons.Violence,   call: '100', emergency: true  },
  { key: 'harassment', label: 'Under Harassment',  Icon: Icons.Harassment, call: '100', emergency: true  },
  { key: 'ambulance',  label: 'Need Ambulance',    Icon: Icons.Ambulance,  call: '108', emergency: true  },
  { key: 'disaster',   label: 'Natural Disaster',  Icon: Icons.Disaster,   call: '108', emergency: true  },
  { key: 'fire',       label: 'Fire Around Me',    Icon: Icons.Fire,       call: '112', emergency: true  },
]
/* i18n-exempt:end */

// Alerts that can no longer be SENT but may still exist in a family's history.
//
// Both removed 2026-09-16. Every SOS sounds a max-volume siren that overrides
// silent mode on every family member's phone, and an SOS channel is only worth
// anything while every siren means drop everything. "Need Money" taught the
// family that a siren might be a money request. "Theft" was briefly promoted to
// an emergency first, then removed at the owner's call: the six that remain are
// the situations where somebody's safety is at stake right now.
//
// Kept here, not deleted, so rows already written still translate: without it a
// Tamil- or Hindi-speaking member would see those old alerts in raw English.
// The sos.msg.money and sos.msg.theft strings in ui.js stay for the same reason.
const RETIRED_MESSAGES = [
  { key: 'money', label: 'Need Money' },
  { key: 'theft', label: 'Theft' },
]

// Stored English label → translation key, so a history row written before the
// language switch (or by a relative using English) still shows translated.
const LABEL_TO_KEY = Object.fromEntries(
  [...QUICK_MESSAGES, ...RETIRED_MESSAGES].map(m => [m.label, m.key])
)
const translateReason = (t, stored) =>
  LABEL_TO_KEY[stored] ? t('sos.msg.' + LABEL_TO_KEY[stored]) : stored

// ── Alarm — factory returns start/stop bound to private refs ─────────────────
// Using a factory instead of module-level variables prevents stale audio context
// leaks when the component unmounts and remounts (e.g. tab switching).
function createSenderAlarm() {
  let intervalId = null
  let audioCtx = null

  function start() {
    stop()
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      const playOneCycle = () => {
        if (!audioCtx) return
        const beepAt = (t, freq, dur) => {
          try {
            const osc = audioCtx.createOscillator()
            const gain = audioCtx.createGain()
            osc.connect(gain); gain.connect(audioCtx.destination)
            osc.frequency.value = freq; osc.type = 'square'
            gain.gain.setValueAtTime(0.35, audioCtx.currentTime + t)
            gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + t + dur)
            osc.start(audioCtx.currentTime + t)
            osc.stop(audioCtx.currentTime + t + dur)
          } catch (e) {}
        }
        ;[0, 0.25, 0.5, 0.75, 1.0].forEach(t => beepAt(t, 880, 0.2))
        ;[0, 0.25, 0.5, 0.75, 1.0].forEach(t => beepAt(t + 0.12, 660, 0.12))
      }
      playOneCycle()
      intervalId = setInterval(playOneCycle, 1500)
    } catch (e) {}
  }

  function stop() {
    if (intervalId) { clearInterval(intervalId); intervalId = null }
    if (audioCtx) { try { audioCtx.close() } catch (e) {} audioCtx = null }
  }

  return { start, stop }
}

// ── Confirmation overlay ─────────────────────────────────────────────────────
function ConfirmSheet({ msg, onConfirm, onCancel }) {
  const t = useT()
  return (
    <div className="overlay" onClick={onCancel}>
      <div className="popup" onClick={e => e.stopPropagation()} style={{ padding: '24px 20px 36px' }}>
        <div className="popup-handle" />

        {/* Icon */}
        <div style={{
          width: 72, height: 72, borderRadius: 22, margin: '0 auto 20px',
          background: `linear-gradient(135deg, ${SOS.base}18, ${SOS.base}08)`,
          border: `2px solid ${SOS.base}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: SOS.base,
        }}>
          <msg.Icon />
        </div>

        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            fontFamily: 'Sora, sans-serif', fontSize: 20, fontWeight: 900,
            color: 'var(--text)', marginBottom: 8, letterSpacing: -0.4,
          }}>
            {t('sos.msg.' + msg.key)}
          </div>
          <div style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.5 }}>
            {msg.call ? t('sos.confirmBodyCall', { number: msg.call }) : t('sos.confirmBody')}
          </div>
        </div>

        {/* What happens */}
        <div style={{
          background: 'var(--bg2)', borderRadius: 14, padding: '14px 16px',
          marginBottom: 24, border: '1px solid var(--border)',
        }}>
          {[
            { icon: 'pin', text: t('sos.willShareLocation') },
            { icon: 'bell', text: t('sos.familyGetsAlert') },
            msg.call && { icon: 'phone', text: t('sos.willCall', { number: msg.call }) },
          ].filter(Boolean).map((item, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              marginBottom: i < 2 ? 10 : 0,
            }}>
              <span style={{ flexShrink: 0, display: 'flex', color: 'var(--maroon)' }}><Icon name={item.icon} size={16} /></span>
              <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 500 }}>{item.text}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={onCancel} style={{
            flex: 1, padding: '14px', borderRadius: 14,
            background: 'var(--bg2)', border: '1px solid var(--border)',
            color: 'var(--muted)', fontWeight: 700, fontSize: 14,
            fontFamily: 'inherit', cursor: 'pointer',
          }}>{t('common.cancel')}</button>
          <button onClick={onConfirm} style={{
            flex: 2, padding: '14px', borderRadius: 14,
            background: `linear-gradient(135deg, ${SOS.glow}, ${SOS.deep})`,
            border: 'none', color: '#fff', fontWeight: 800, fontSize: 15,
            fontFamily: 'inherit', cursor: 'pointer',
            boxShadow: `0 6px 20px ${SOS.base}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12.7 19.79 19.79 0 0 1 1.61 4.18 2 2 0 0 1 3.59 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
            {t('sos.sendNow')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Sent screen ───────────────────────────────────────────────────────────────
// `resolved` flips it once "I'm Safe Now" has actually reached the server:
// green shield instead of the live red badge, "SOS Resolved" instead of the
// running timer, and Done in place of the two buttons. Same layout otherwise.
function SOSSentScreen({ msg, onDismiss, onSafe, resolved, nearbyStatus, sentLoc, nearbyEscalationId, alertId }) {
  const t = useT()
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  // Cream, like the native SOS alert and call screens (it was a near-black
  // gradient with glowing red). Laid out as a proper confirmation screen:
  // header centred in the space above, ONE grouped status card with a real
  // edge — three loose white boxes vanished into the cream — and the main
  // action pinned at the bottom as a solid maroon button. The running timer
  // sits under the title rather than in the list: it is not a completed step,
  // so it should not wear a tick.
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: '#FFF8F0',
      display: 'flex', flexDirection: 'column',
      padding: '20px 20px 16px',
    }}>
      <style>{`
        @keyframes sos-ring { 0% { transform: scale(1); opacity: 0.35; } 100% { transform: scale(1.45); opacity: 0; } }
        /* Rows keep their height and the page scrolls instead of squeezing them; auto margins on the first and last child centre the content when it is short, without clipping the top when it is tall. */
        .sos-sent-body > * { flex-shrink: 0; }
        .sos-sent-body > :first-child { margin-top: auto; }
        .sos-sent-body > :last-child { margin-bottom: auto; }
      `}</style>

      <div className="sos-sent-body" style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'flex-start', minHeight: 0,
        // Scrollable: the Nearby map panel below can push this taller than a
        // small screen, and the badge/timer/status card above must stay
        // reachable rather than clipped by the fixed full-screen overlay.
        overflowY: 'auto', WebkitOverflowScrolling: 'touch',
      }}>
        {/* Badge, with a thin ring expanding from it to show the alert is live. */}
        <div style={{ position: 'relative', marginBottom: 12 }}>
          {!resolved && <div style={{
            position: 'absolute', inset: -14, borderRadius: '50%',
            border: '2px solid #D32F2F',
            animation: 'sos-ring 2s ease-out infinite',
          }} />}
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: resolved ? '#12925B' : '#D32F2F',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff',
          }}>
            {resolved ? <Icon name="shield" size={44} /> : <msg.Icon />}
          </div>
        </div>

        <div style={{
          fontFamily: 'Sora, sans-serif', fontSize: 24, fontWeight: 900,
          color: '#2A0A18', letterSpacing: -0.5, marginBottom: 6, textAlign: 'center',
        }}>{t(resolved ? 'sos.safeTitle' : 'sos.sentTitle')}</div>

        {/* The SOS type, as on the recipient's alert screen. */}
        <div style={{
          fontSize: 14, color: resolved ? '#0E7A4C' : '#B71C1C', background: resolved ? '#E3F4EC' : '#FDECEC',
          fontWeight: 700, lineHeight: 1.4, textAlign: 'center',
          padding: '6px 14px', borderRadius: 16, marginBottom: 8,
        }}>
          {t('sos.msg.' + msg.key)}
        </div>

        {/* Live timer — a small solid dot marks it as running. Green "SOS
            Resolved" once they are safe. */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          fontSize: 13, fontWeight: resolved ? 700 : 600, color: resolved ? '#0E7A4C' : '#6B4A57',
          fontVariantNumeric: 'tabular-nums', marginBottom: 12,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: resolved ? '#12925B' : '#D32F2F', display: 'inline-block' }} />
          {resolved ? t('sos.resolved') : t('sos.activeFor', { time: fmt(elapsed) })}
        </div>

        {/* One grouped status card: light rose (white read as washed out on the
            cream), maroon edge and dividers, maroon icon tiles. */}
        <div style={{
          width: '100%', background: '#F8E6ED',
          border: '1.5px solid #8B0D3D', borderRadius: 16,
          boxShadow: '0 2px 10px rgba(74,8,32,0.07)',
          overflow: 'hidden',
        }}>
          {[
            { icon: 'pin',  label: t('sos.locationShared') },
            { icon: 'bell', label: t(resolved ? 'sos.familyToldSafe' : 'sos.familyAlerted') },
            // Famora Social: a nearby stranger accepted and is calling 112 on
            // this sender's behalf. Count only, never who — see
            // useSosAlarm's _nearbyHelpStatus and the plan's safety boundary.
            // Only added once there is something to report; "exhausted" gets
            // its own Call 112 button below instead of a checkmark row, since
            // that state is an action to take, not a completed step.
            nearbyStatus === 'helper_found' && { icon: 'users', label: t('sos.nearbyHelping') },
          ].filter(Boolean).map((item, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '9px 16px',
              borderTop: i ? '1px solid rgba(139,13,61,0.3)' : 'none',
            }}>
              <span style={{
                width: 30, height: 30, borderRadius: 10, flexShrink: 0,
                background: '#8B0D3D', color: '#FFF8F0',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><Icon name={item.icon} size={18} /></span>
              <span style={{ fontSize: 15, color: '#2A0A18', fontWeight: 600, flex: 1 }}>{item.label}</span>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#12925B" strokeWidth="2.6"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" />
                <polyline points="16 9 10.5 15 8 12.5" />
              </svg>
            </div>
          ))}
        </div>

        {/* Famora Social found no one nearby within its ~6-minute search —
            an action to take, not a completed step, so it gets its own button
            rather than another row in the checklist above. Same tel: dialing
            mechanism ConfirmSheet already uses elsewhere on this page:
            prefilled, never auto-dialled. */}
        {!resolved && nearbyStatus === 'exhausted' && (
          <button
            onClick={() => window.open('tel:' + (msg.call || '100'), '_system')}
            style={{
              width: '100%', marginTop: 14, padding: '14px', borderRadius: 14,
              background: '#D32F2F', border: 'none', color: '#fff',
              fontFamily: 'Sora, sans-serif', fontWeight: 800, fontSize: 15,
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              justifyContent: 'center', gap: 8,
            }}
          >
            <Icon name="phone" size={17} /> {t('sos.callNow', { number: msg.call || '100' })}
          </button>
        )}

        {/* Famora Social: the sender's own read-only view of the search — the
            same map GlobalSOSAlert shows every other family member. Additive
            reassurance next to the "1 person nearby is helping" row above,
            not a replacement for it. Hidden once resolved, like the rest of
            this live status. */}
        {!resolved && nearbyStatus && (
          <div style={{ width: '100%', marginTop: 14 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
              fontSize: 12, fontWeight: 700, color: '#6B4A57',
            }}>
              <Icon name="users" size={14} /> {t('sos.nearbyMapTitle')}
            </div>
            <div style={{ height: 110, borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(139,13,61,0.25)' }}>
              <NearbySearchMap
                lat={sentLoc?.lat}
                lng={sentLoc?.lng}
                status={nearbyStatus}
                escalationId={nearbyEscalationId}
              />
            </div>
          </div>
        )}

        {/* Optional voice clip and photo for the family — below the map so the
            status, then who is nearby, then what you can add. */}
        {!resolved && <SosSenderMedia alertId={alertId} />}
      </div>

      {/* Actions, pinned to the bottom. */}
      {resolved ? (
        <button onClick={onDismiss} style={{
          width: '100%', padding: '16px', borderRadius: 16,
          background: '#8B0D3D', border: '1.5px solid #6B0B2C', color: '#FFF8F0',
          fontFamily: 'Sora, sans-serif', fontWeight: 800, fontSize: 17,
          cursor: 'pointer', marginTop: 20, marginBottom: 6,
        }}>
          {t('common.done')}
        </button>
      ) : (<>
      <button onClick={onSafe} style={{
        width: '100%', padding: '16px', borderRadius: 16,
        background: '#8B0D3D', border: '1.5px solid #6B0B2C', color: '#FFF8F0',
        fontFamily: 'Sora, sans-serif', fontWeight: 800, fontSize: 17,
        cursor: 'pointer', marginTop: 20, marginBottom: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
      }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <polyline points="9 12 11 14 15 10"/>
        </svg>
        {t('sos.imSafe')}
      </button>

      <button onClick={onDismiss} style={{
        background: 'none', border: 'none', padding: '12px',
        color: '#6B4A57', fontSize: 14, fontWeight: 600,
        fontFamily: 'inherit', cursor: 'pointer',
      }}>
        {t('sos.dismiss')}
      </button>
      </>)}
    </div>
  )
}

export default function SOSPage() {
  const t = useT()
  const { user, familyId } = useAuthStore()
  const [activeTab, setActiveTab]       = useState('send')
  const [alerts, setAlerts]             = useState([])
  const [sending, setSending]           = useState(false)
  const [members, setMembers]           = useState({})
  const [alarmOn, setAlarmOn]           = useState(false)
  const [confirmMsg, setConfirmMsg]     = useState(null)  // msg waiting for confirm
  const [sentMsg, setSentMsg]           = useState(null)  // msg successfully sent → show sent screen
  const [sentResolved, setSentResolved] = useState(false) // "I'm Safe" succeeded → sent screen shows resolved
  const [dialog, setDialog]             = useState(null)
  // The id `send_sos` returns, and the Famora Social nearby-help status for
  // it — 'searching' | 'helper_found' | 'exhausted' | 'resolved' | null
  // (null = no escalation row yet, e.g. a GPS-failed SOS at 0,0). See the
  // realtime subscription below and useSosAlarm.js's parallel one for the
  // family-side view of the same row.
  const [sentAlertId, setSentAlertId]   = useState(null)
  const [nearbyStatus, setNearbyStatus] = useState(null)
  // The alert's own coordinates (for NearbySearchMap, centred on them — not
  // on whoever is looking) and the escalation row's own id (for
  // get_accepted_helper_area, once nearbyStatus is 'helper_found').
  const [sentLoc, setSentLoc]                     = useState(null)
  const [nearbyEscalationId, setNearbyEscalationId] = useState(null)

  // Famora Social opt-in — moved here from the old FamoraSocialPage, next to
  // the Send tab it now lives on.
  const [socialOptedIn, setSocialOptedIn]   = useState(false)
  const [socialOptInReady, setSocialOptInReady] = useState(false)

  // This user's own pending nearby-help requests — the in-app fallback for
  // "someone nearby needs help", for when the native ring notification was
  // missed, dismissed, or the platform is web (no NearbyHelpRingService
  // there at all). Deliberately independent of any location state: unlike
  // the ambient dots on NearbySearchMap, showing "you have a request" never
  // needed to know where the viewer is.
  const [pendingHelp, setPendingHelp]     = useState([])
  const [revealedHelp, setRevealedHelp]   = useState({})  // notification id -> {lat,lng} | 'unavailable'
  const [respondingHelp, setRespondingHelp] = useState(null)  // notification id currently in flight
  const [helpHistory, setHelpHistory]     = useState([])    // answered requests, newest first
  const [socialView, setSocialView]     = useState('helped')  // which history the Nearby Help tab shows
  const [sentHistory, setSentHistory]     = useState([])    // this user's own SOS escalations, newest first

  const prevAlertIds = useRef(new Set())
  const alarmRef     = useRef(null)

  // Create alarm instance once per component mount; destroy on unmount
  useEffect(() => {
    alarmRef.current = createSenderAlarm()
    return () => alarmRef.current?.stop()
  }, [])

  // Famora Social opt-in — same read/upsert/delete against user_consents the
  // old FamoraSocialPage used, carried over unchanged.
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    supabase
      .from('user_consents')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('consent_type', FAMORA_SOCIAL_CONSENT_TYPE)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setSocialOptedIn(!!data)
        setSocialOptInReady(true)
      })
    return () => { cancelled = true }
  }, [user?.id])

  const handleToggleSocial = async () => {
    if (!user?.id) return
    const newVal = !socialOptedIn
    setSocialOptedIn(newVal)   // optimistic, same pattern as ProfilePage's toggles
    try {
      if (newVal) {
        const { error } = await supabase.from('user_consents').upsert({
          user_id: user.id, consent_type: FAMORA_SOCIAL_CONSENT_TYPE, agreed_at: new Date().toISOString(),
        }, { onConflict: 'user_id,consent_type' })
        if (error) throw error
      } else {
        const { error } = await supabase.from('user_consents')
          .delete().eq('user_id', user.id).eq('consent_type', FAMORA_SOCIAL_CONSENT_TYPE)
        if (error) throw error
        // A blocked DELETE (RLS) reports success and removes nothing — confirm
        // the row is really gone before telling the user they are opted out.
        const { data: still } = await supabase.from('user_consents')
          .select('user_id').eq('user_id', user.id).eq('consent_type', FAMORA_SOCIAL_CONSENT_TYPE).maybeSingle()
        if (still) throw new Error('opt-out not saved')
      }
      setDialog({
        type: 'info',
        title: t(newVal ? 'famoraSocial.onTitle' : 'famoraSocial.offTitle'),
        message: t(newVal ? 'famoraSocial.onBody' : 'famoraSocial.offBody'),
      })
    } catch (e) {
      setSocialOptedIn(!newVal)   // revert on failure
      setDialog({ type: 'error', message: t('famoraSocial.toggleFailed') })
    }
  }

  // Pending nearby-help requests for this user — fetch + realtime, same
  // resilience shape (poll fallback, visibilitychange refetch) as the other
  // subscriptions on this page.
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false

    const fetchPending = async () => {
      const { data, error } = await supabase
        .from('nearby_help_notifications')
        .select('id, escalation_id, distance_m, fuzzy_lat, fuzzy_lng, fuzzy_radius_m, notified_at, response, help_kind')
        .eq('helper_id', user.id)
        .is('response', null)
      if (cancelled || error || !data || data.length === 0) {
        if (!cancelled && (!data || data.length === 0)) setPendingHelp([])
        return
      }
      const escalationIds = [...new Set(data.map(n => n.escalation_id))]
      const { data: escalations } = await supabase
        .from('nearby_help_escalations')
        .select('id, status')
        .in('id', escalationIds)
      if (cancelled) return
      const searching = new Set((escalations || []).filter(e => e.status === 'searching').map(e => e.id))
      setPendingHelp(data.filter(n => searching.has(n.escalation_id)))
    }

    fetchPending()

    const channel = supabase
      .channel(`sos-page-pending-help:${user.id}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'nearby_help_notifications', filter: `helper_id=eq.${user.id}` },
        () => { if (!cancelled) fetchPending() })
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'nearby_help_escalations' },
        () => { if (!cancelled) fetchPending() })
      .subscribe()

    const pollTimer = setInterval(fetchPending, 30_000)
    const onVisible = () => { if (document.visibilityState === 'visible') fetchPending() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
      clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [user?.id])

  // History of the requests this user has answered. Refetched when the tab
  // opens and whenever a pending request appears or is answered.
  useEffect(() => {
    if (!user?.id || activeTab !== 'social') return
    let cancelled = false
    supabase
      .from('nearby_help_notifications')
      .select('id, distance_m, notified_at, response, help_kind')
      .eq('helper_id', user.id)
      .eq('hidden_by_helper', false)
      .not('response', 'is', null)
      .order('notified_at', { ascending: false })
      .limit(30)
      .then(({ data }) => { if (!cancelled && data) setHelpHistory(data) })
    // RLS lets the requester read their own escalation rows.
    supabase
      .from('nearby_help_escalations')
      .select('id, status, created_at, accepted_by, help_kind')
      .eq('requester_id', user.id)
      .eq('hidden_by_requester', false)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => { if (!cancelled && data) setSentHistory(data) })
    return () => { cancelled = true }
  }, [user?.id, activeTab, pendingHelp.length])

  // Remove one entry from the Nearby Help history (swipe right or long-press).
  // Hidden on the server, not deleted — see hide_nearby_help_* in
  // 20260924140000_nearby_help_hide_history.sql.
  const handleRemoveHistory = (view, id) => {
    setDialog({
      type: 'confirm',
      title: t('famoraSocial.removeTitle'),
      message: t('famoraSocial.removeBody'),
      confirmLabel: t('famoraSocial.remove'),
      onConfirm: async () => {
        const { error } = await supabase.rpc(
          view === 'helped' ? 'hide_nearby_help_notification' : 'hide_nearby_help_escalation',
          view === 'helped' ? { p_notification_id: id } : { p_escalation_id: id },
        )
        if (error) {
          setDialog({ type: 'error', message: t('famoraSocial.removeFailed') })
          return
        }
        if (view === 'helped') setHelpHistory(prev => prev.filter(h => h.id !== id))
        else setSentHistory(prev => prev.filter(e => e.id !== id))
      },
    })
  }

  const handleAcceptHelp = async (notificationId, escalationId) => {
    setRespondingHelp(notificationId)
    try {
      const { error: acceptErr } = await supabase.rpc('accept_nearby_help', { p_notification_id: notificationId })
      if (acceptErr) {
        setRevealedHelp(prev => ({ ...prev, [notificationId]: 'unavailable' }))
        return
      }
      const { data: loc, error: locErr } = await supabase.rpc('get_nearby_help_location', { p_escalation_id: escalationId })
      const row = Array.isArray(loc) ? loc[0] : loc
      setRevealedHelp(prev => ({
        ...prev,
        [notificationId]: (!locErr && row) ? { lat: row.lat, lng: row.lng } : 'unavailable',
      }))
    } finally {
      setRespondingHelp(null)
    }
  }

  const handleDeclineHelp = async (notificationId) => {
    setRespondingHelp(notificationId)
    try {
      await supabase.rpc('decline_nearby_help', { p_notification_id: notificationId })
      setPendingHelp(prev => prev.filter(n => n.id !== notificationId))
    } finally {
      setRespondingHelp(null)
    }
  }

  const reloadAlerts = async () => {
    if (!familyId) return
    const [memRes, alertRes] = await Promise.all([
      supabase.from('family_members').select('user_id, display_name, avatar_color').eq('family_id', familyId),
      supabase.from('sos_alerts').select('*').eq('family_id', familyId).order('created_at', { ascending: false }),
    ])
    if (memRes.data) { const m = {}; memRes.data.forEach(x => { m[x.user_id] = x }); setMembers(m) }
    if (alertRes.data) setAlerts(alertRes.data)
  }

  useEffect(() => {
    if (!familyId) return
    reloadAlerts()

    const channel = supabase.channel(`sos:${familyId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sos_alerts', filter: 'family_id=eq.' + familyId },
        (p) => {
          setAlerts(prev => [p.new, ...prev])
          if (p.new.user_id !== user?.id && !prevAlertIds.current.has(p.new.id)) {
            prevAlertIds.current.add(p.new.id)
            // Web only. On Android SOSSirenService already plays the siren and
            // SOSAlertActivity already shows the alert, so starting this too
            // gave a second, different-sounding alarm plus a banner the user had
            // to stop separately after dealing with the native one.
            if (!Capacitor.isNativePlatform()) { alarmRef.current?.start(); setAlarmOn(true) }
          }
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sos_alerts', filter: 'family_id=eq.' + familyId },
        (p) => setAlerts(prev => prev.map(a => a.id === p.new.id ? { ...a, ...p.new } : a)))
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [familyId])

  // ── Step 1: User taps a button → show confirm sheet
  const handleTap = (msg) => {
    if (sending) return
    setConfirmMsg(msg)
  }

  // ── Step 2: User confirms → send SOS → show sent screen
  const sendSOS = async () => {
    const msg = confirmMsg
    setConfirmMsg(null)
    setSending(true)

    if (msg.call) window.open(`tel:${msg.call}`, '_system')

    try {
      // Use Capacitor Geolocation on native (same as MapAllPage / LocationBroadcast).
      // navigator.geolocation falls back to network/IP on Android WebView and can
      // be several km off — Capacitor calls the native GPS API directly.
      let lat = 0, lng = 0
      try {
        if (Capacitor.isNativePlatform()) {
          // The plugin's own timeout is not a guarantee: a location request that
          // never answers would leave `sending` true, and every SOS button is
          // disabled while it is. Bound the wait ourselves; the fallback below
          // sends the alert with 0,0 rather than not at all.
          const pos = await withTimeout(Geolocation.getCurrentPosition({
            enableHighAccuracy: true, timeout: 8000, maximumAge: 30000,
          }), 12000)
          lat = pos.coords.latitude
          lng = pos.coords.longitude
        } else {
          // Web fallback
          const pos = await new Promise((res, rej) =>
            navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })
          )
          lat = pos.coords.latitude
          lng = pos.coords.longitude
        }
      } catch (gpsErr) {
        console.warn('[SOS] GPS unavailable, sending with 0,0:', gpsErr?.message)
      }

      const { data: sosData, error: sosErr } = await withTimeout(supabase.rpc('send_sos', {
        p_family_id: familyId,
        p_lat:       lat,
        p_lng:       lng,
        p_message:   msg.label,
      }), 25000)
      if (sosErr) throw sosErr
      // The family will start calling now. Silence this phone in case its
      // owner is hiding; "I'm Safe" gives the ringer back.
      enterSosSilence()
      setSentResolved(false)
      // The alert's id, for the Famora Social nearby-help subscription below.
      // send_sos returns it as a plain uuid; tolerate a row/array shape too
      // rather than assume one, since nothing here can change the RPC itself.
      const newAlertId = typeof sosData === 'string'
        ? sosData
        : sosData?.id || (Array.isArray(sosData) ? sosData[0]?.id : null)
      setNearbyStatus(null)
      setNearbyEscalationId(null)
      setSentLoc({ lat, lng })
      setSentAlertId(newAlertId || null)
      setSentMsg(msg)  // show the sent screen
    } catch (e) {
      console.error('SOS send error:', e)
      // This used to fail silently: the sheet closed and nothing else happened,
      // so the person believed help was on the way. Say it did not go, and let
      // them try again.
      setDialog({ type: 'error', title: t('common.error'), message: t('common.retry') })
    } finally {
      setSending(false)
    }
  }

  // ── Step 3: "I'm Safe" → resolve latest alert + dismiss sent screen
  const handleSafe = async () => {
    let myLatest = alerts.find(a => a.user_id === user?.id && !a.is_resolved)
    // The realtime INSERT may not have reached the list yet when "I'm Safe"
    // is tapped straight after sending. Ask the database rather than show
    // "SOS Resolved" over an alert that is still live on every family phone.
    if (!myLatest && user?.id && familyId) {
      const { data } = await supabase
        .from('sos_alerts').select('id')
        .eq('user_id', user.id).eq('family_id', familyId).eq('is_resolved', false)
        .order('created_at', { ascending: false }).limit(1)
      myLatest = data?.[0]
    }
    if (myLatest) {
      const { error } = await supabase.rpc('resolve_sos', { p_sos_id: myLatest.id })
      // Do not dismiss on failure. The alert is still standing on every other
      // phone in the family, and telling this user they are safe while their
      // family is still being called is the one wrong answer this screen can
      // give. Leaving the sent screen up keeps "I'm Safe" in reach to retry.
      // 22023 = already resolved (e.g. from the notification's Cancel): that
      // is the outcome being asked for, not a failure.
      if (error && error.code !== '22023') {
        console.error('Resolve SOS error:', error.code || 'unknown')
        setDialog({ type: 'error', title: t('common.error'), message: t('common.retry') })
        return
      }
    }
    // "I'm Safe" is the person saying they are not hiding, so the ringer comes
    // back unconditionally. This used to ask the database first whether any
    // other SOS of theirs was still open — and one forgotten test alert in the
    // history kept the phone silent after "I'm Safe" (Redmi, 2026-09-21). That
    // check now only runs as the automatic safety net in useSosAlarm.
    exitSosSilence()
    // Stay on the screen in its resolved state; Done closes it.
    setSentResolved(true)
  }

  // Famora Social: nearby-help status for the alert just sent. Subscribes
  // once sentAlertId is known and reads the row's current status straight
  // away too — the escalation is inserted synchronously by a trigger on
  // sos_alerts, so it usually already exists by the time this effect's
  // subscription call completes, and postgres_changes only reports rows
  // changing AFTER it is live.
  useEffect(() => {
    if (!sentAlertId) return
    let cancelled = false

    supabase
      .from('nearby_help_escalations')
      .select('id, status')
      .eq('sos_alert_id', sentAlertId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return
        setNearbyStatus(data.status)
        setNearbyEscalationId(data.id)
      })

    const channel = supabase
      .channel(`nearby-help-status:${sentAlertId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'nearby_help_escalations',
        filter: `sos_alert_id=eq.${sentAlertId}`,
      }, (payload) => {
        if (cancelled) return
        if (payload.new?.status) setNearbyStatus(payload.new.status)
        if (payload.new?.id) setNearbyEscalationId(payload.new.id)
      })
      .subscribe()

    return () => { cancelled = true; supabase.removeChannel(channel) }
  }, [sentAlertId])

  const resolveAlert = async (alertId) => {
    const { error } = await supabase.rpc('resolve_sos', { p_sos_id: alertId })
    if (error) console.error('Resolve error:', error.code || 'unknown')
    // Resolving your OWN alert from the history says the same as "I'm Safe".
    else if (alerts.find(a => a.id === alertId)?.user_id === user?.id) exitSosSilence()
  }

  const activeCount = alerts.filter(a => !a.is_resolved).length

  const emergencyMsgs = QUICK_MESSAGES.filter(m => m.emergency)
  const otherMsgs     = QUICK_MESSAGES.filter(m => !m.emergency)

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Sent screen — full screen takeover */}
      {sentMsg && (
        <SOSSentScreen
          msg={sentMsg}
          onSafe={handleSafe}
          resolved={sentResolved}
          nearbyStatus={nearbyStatus}
          sentLoc={sentLoc}
          nearbyEscalationId={nearbyEscalationId}
          alertId={sentAlertId}
          onDismiss={() => {
            setSentMsg(null); setSentResolved(false)
            setSentAlertId(null); setNearbyStatus(null)
            setSentLoc(null); setNearbyEscalationId(null)
          }}
        />
      )}

      {/* Confirm sheet */}
      {confirmMsg && (
        <ConfirmSheet
          msg={confirmMsg}
          onConfirm={sendSOS}
          onCancel={() => setConfirmMsg(null)}
        />
      )}

      {/* Fixed height: the right-hand control differs per tab (switch, Clear
          Resolved, nothing), and the bar used to resize with it. */}
      <div className="top-bar" style={{ boxSizing: 'border-box', height: 68 }}>
        <div>
          <div className="top-bar-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="1" fill="#fff"/>
            </svg>
            {t('sos.title')}
          </div>
        </div>

        {/* Nearby-helper opt-in lives in the header of its own tab, so it is
            always in reach without taking a card's worth of space. */}
        {activeTab === 'social' && (
          <FamoraSocialToggle
            on={socialOptedIn}
            onToggle={socialOptInReady ? handleToggleSocial : undefined}
            label={t('famoraSocial.toggleTitle')}
          />
        )}

        {/* Clear Resolved — right side, matches Switch / Sign Out style */}
        {activeTab === 'history' && alerts.some(a => a.is_resolved) && (
          <button
            onClick={() => {
              setDialog({
                type: 'confirm',
                title: t('sos.clearTitle'),
                message: t('sos.clearMsg'),
                confirmLabel: t('sos.clear'),
                onConfirm: async () => {
                  const { error } = await supabase.rpc('clear_sos_history', { p_family_id: familyId })
                  if (error) {
                    setDialog({ type: 'error', title: t('sos.adminOnly'), message: t('sos.adminOnlyMsg') })
                    return
                  }
                  setAlerts(prev => prev.filter(a => !a.is_resolved))
                },
              })
            }}
            style={{
              background: 'rgba(255,255,255,0.92)',
              border: '1.5px solid #fff',
              color: 'var(--maroon)',
              borderRadius: 10,
              padding: '7px 12px',
              fontWeight: 800,
              fontSize: 12,
              fontFamily: 'inherit',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 6,
              flexShrink: 0,
              zIndex: 1,
            }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--maroon)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            </svg>
            {t('sos.clearResolved', { n: alerts.filter(a => a.is_resolved).length })}
          </button>
        )}
      </div>

      {/* Alarm active banner */}
      {alarmOn && (
        <div style={{
          background: `linear-gradient(90deg, ${SOS.base}, ${SOS.deep})`,
          color: '#fff', padding: '10px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0, gap: 10,
        }}>
          <span style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.5 }}><Icon name="siren" /> {t('sos.alarmBanner')}</span>
          <button onClick={() => { alarmRef.current?.stop(); setAlarmOn(false) }} style={{
            background: 'rgba(255,255,255,0.2)', border: '1.5px solid #fff',
            color: '#fff', borderRadius: 20, padding: '6px 14px',
            fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
          }}><Icon name="bellOff" /> {t('sos.stop')}</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', background: '#fff', borderBottom: '1.5px solid var(--border)', flexShrink: 0 }}>
        {[
          { key: 'send',    label: t('sos.tabSend') },
          { key: 'social',  label: t('sos.tabNearby') + (pendingHelp.length > 0 ? ` (${pendingHelp.length})` : '') },
          { key: 'history', label: t('sos.tabHistory') + (activeCount > 0 ? ` (${activeCount})` : '') },
        ].map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
            flex: 1, padding: '13px 0', background: 'none', border: 'none',
            fontFamily: 'inherit', fontWeight: 700, fontSize: 14, cursor: 'pointer',
            color: activeTab === tab.key ? 'var(--maroon)' : 'var(--muted-soft)',
            borderBottom: activeTab === tab.key ? '2.5px solid var(--maroon)' : '2.5px solid transparent',
            transition: 'all 0.2s',
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* SEND TAB */}
      {activeTab === 'send' && (
        <PullToRefresh onRefresh={reloadAlerts}>
        <div style={{ padding: '16px 14px' }}>

          {/* No "Emergency" heading: every tile here is an emergency, so the
              label only restated the page title. */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
            {emergencyMsgs.map((msg, i) => (
              <SOSButton
                key={msg.key} msg={msg} onTap={handleTap} disabled={sending}
                // An odd count leaves the last button alone on its row at half
                // width, which reads as a gap where a button went missing. Let
                // it span the row instead.
                wide={emergencyMsgs.length % 2 === 1 && i === emergencyMsgs.length - 1}
              />
            ))}
          </div>

          {/* What a tap does, for someone opening this page for the first time.
              Below the tiles rather than above so the tiles keep their place. */}
          {/* Two deliberate lines, split at the dash every translation has. As
              one sentence it wrapped wherever the width ran out, and the icon
              beside a two-line block sat off to the left of it. */}
          {(() => {
            const [first, ...rest] = t('sos.tapHint').split(' — ')
            return (
              <div style={{
                margin: '4px 8px 16px', textAlign: 'center',
                fontSize: 13, fontWeight: 700, lineHeight: 1.5, color: 'var(--text)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--maroon)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span>{first}</span>
                </div>
                {rest.length > 0 && <div>{rest.join(' — ')}</div>}
              </div>
            )
          })()}

          {/* Other help section — only rendered when there is something in it.
              Every remaining alert is an emergency, so today it is empty; a bare
              heading over nothing looked broken. Kept conditional rather than
              deleted in case a non-emergency type is ever added back. */}
          {otherMsgs.length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted-soft)', letterSpacing: 0.3, marginBottom: 10 }}>
                {t('sos.otherHelp')}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {otherMsgs.map((msg) => (
                  <SOSButton key={msg.key} msg={msg} onTap={handleTap} disabled={sending} />
                ))}
              </div>
            </>
          )}

        </div>
        </PullToRefresh>
      )}

      {/* NEARBY HELP TAB — Famora Social: opt-in, requests addressed to this
          user, and their own history of them. */}
      {activeTab === 'social' && (
        <>
        {/* Fixed: the intro and counts stay put while the lists below scroll. */}
        <div style={{ padding: '16px 14px 0', flexShrink: 0 }}>

          {/* The why, in one breath, then two counts. Kept compact so the
              opt-in switch stays above the fold. */}
          <div className="settings-card" style={{ margin: '0 0 12px', padding: '12px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--maroon)', fontSize: 14, fontWeight: 800 }}>
              <Icon name="heart" size={18} />
              {t('famoraSocial.heroTitle')}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginTop: 4, lineHeight: 1.45 }}>
              {t('famoraSocial.heroBody')}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              {[
                { key: 'helped',   n: helpHistory.filter(h => h.response === 'accepted').length, label: t('famoraSocial.statHelped') },
                { key: 'received', n: sentHistory.filter(e => e.accepted_by).length,             label: t('famoraSocial.statReceived') },
              ].map(s => {
                const active = socialView === s.key
                return (
                  <button key={s.key} onClick={() => setSocialView(s.key)} aria-pressed={active} style={{
                    flex: 1, fontFamily: 'inherit', cursor: 'pointer',
                    background: active ? 'var(--maroon)' : '#fff', borderRadius: 10, padding: '7px 10px',
                    border: '1.5px solid var(--maroon)', justifyContent: 'center',
                    display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.2s',
                  }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: active ? '#fff' : 'var(--maroon)' }}>{s.n}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: active ? '#fff' : 'var(--maroon)', lineHeight: 1.25 }}>{s.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>

          <PullToRefresh onRefresh={reloadAlerts}>
          <div style={{ padding: '0 14px 16px' }}>

          {/* In-app fallback for a nearby-help request — for when the native
              ring notification was missed, dismissed, or this is a web
              session (no NearbyHelpRingService there). Carried over from the
              old FamoraSocialPage rather than dropped: without this, an
              opted-in helper whose push never arrived had no way at all to
              respond. */}
          {pendingHelp.map(n => {
            const revealed = revealedHelp[n.id]
            return (
              <div key={n.id} className="settings-card" style={{ margin: '0 0 16px', padding: '14px 16px' }}>
                {!revealed ? (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--maroon)', letterSpacing: 0.2 }}>
                      {t('famoraSocial.pendingTitle')}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
                      {t('famoraSocial.pendingBody', { need: t('famoraSocial.need.' + n.help_kind), number: helpNumber(n.help_kind) })}
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                      <button
                        onClick={() => handleAcceptHelp(n.id, n.escalation_id)}
                        disabled={respondingHelp === n.id}
                        style={{
                          flex: 1, padding: '10px', borderRadius: 12, border: 'none',
                          background: 'var(--maroon)', color: '#fff', fontWeight: 800, fontSize: 13,
                          opacity: respondingHelp === n.id ? 0.6 : 1,
                        }}
                      >
                        {t('famoraSocial.accept')}
                      </button>
                      <button
                        onClick={() => handleDeclineHelp(n.id)}
                        disabled={respondingHelp === n.id}
                        style={{
                          flex: 1, padding: '10px', borderRadius: 12, border: '1px solid var(--border)',
                          background: 'transparent', color: 'var(--text)', fontWeight: 800, fontSize: 13,
                          opacity: respondingHelp === n.id ? 0.6 : 1,
                        }}
                      >
                        {t('famoraSocial.decline')}
                      </button>
                    </div>
                  </>
                ) : revealed === 'unavailable' ? (
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>
                    {t('famoraSocial.locationFailed')}
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--maroon)', letterSpacing: 0.2 }}>
                      {t('famoraSocial.acceptedTitle', { number: helpNumber(n.help_kind) })}
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
                      {t('famoraSocial.acceptedBody', { number: helpNumber(n.help_kind) })}
                    </div>
                    <div style={{ display: 'flex', gap: 14, marginTop: 10 }}>
                      <a href={'tel:' + helpNumber(n.help_kind)} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--maroon)', fontWeight: 800, fontSize: 13, textDecoration: 'none' }}>
                        <Icon name="phone" /> {t('famoraSocial.callNumber', { number: helpNumber(n.help_kind) })}
                      </a>
                      <a
                        href={`https://www.google.com/maps?q=${revealed.lat},${revealed.lng}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--maroon)', fontWeight: 800, fontSize: 13, textDecoration: 'none' }}
                      >
                        <Icon name="pin" /> {t('famoraSocial.viewOnMaps')}
                      </a>
                    </div>
                  </>
                )}
              </div>
            )
          })}

          {/* One list at a time, picked with the two counts above, so the tab
              stays short instead of scrolling through two long histories.
              Anonymous by design: only when, and what kind of help. */}
          {(() => {
            const rows = socialView === 'helped'
              ? helpHistory.filter(h => h.response === 'accepted').map(h => ({ id: h.id, at: h.notified_at, kind: h.help_kind }))
              : sentHistory.filter(e => e.accepted_by).map(e => ({ id: e.id, at: e.created_at, kind: e.help_kind }))
            if (rows.length === 0) {
              return (
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', lineHeight: 1.5, padding: '8px 4px' }}>
                  {t(socialView === 'helped' ? 'famoraSocial.helpedEmpty' : 'famoraSocial.receivedEmpty')}
                </div>
              )
            }
            return (
              <>
                {rows.map(r => (
                  <HistoryRow key={r.id} onRemove={() => handleRemoveHistory(socialView, r.id)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: 'var(--maroon)' }}>
                      <Icon name="heart" size={15} />
                      {new Date(r.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    {r.kind && (
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)' }}>
                        {t('famoraSocial.kind.' + r.kind)}
                      </div>
                    )}
                  </HistoryRow>
                ))}
                <div style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted-soft)', textAlign: 'center', padding: '6px 0 2px' }}>
                  {t('famoraSocial.removeHint')}
                </div>
              </>
            )
          })()}

        </div>
        </PullToRefresh>
        </>
      )}

      {/* HISTORY TAB */}
      {activeTab === 'history' && (
        <PullToRefresh onRefresh={reloadAlerts}>
        <div style={{ padding: 16 }}>
          {alerts.length === 0 && (
            <div className="empty-state">
              <div style={{ margin: '0 auto 18px', width: 80, height: 80 }}>
                <svg viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect width="80" height="80" rx="24" fill="var(--maroon-wash)"/>
                  <path d="M40 12L16 22V40C16 54 26.4 67.2 40 70C53.6 67.2 64 54 64 40V22L40 12Z"
                    fill="url(#emptyShieldGrad)"/>
                  <path d="M40 16L20 25V40C20 52 28.8 63.6 40 66C51.2 63.6 60 52 60 40V25L40 16Z"
                    fill="none" stroke="rgba(212,175,55,0.6)" strokeWidth="1.5"/>
                  <path d="M32 40l5.5 5.5L50 33"
                    stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
                  <defs>
                    <linearGradient id="emptyShieldGrad" x1="16" y1="12" x2="64" y2="70" gradientUnits="userSpaceOnUse">
                      <stop offset="0%" stopColor="var(--maroon-rose)"/>
                      <stop offset="100%" stopColor="var(--maroon-darkest)"/>
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <div className="empty-text">{t('sos.allClear')}</div>
              <div className="empty-sub">{t('sos.noAlerts')}</div>
            </div>
          )}

          {alerts.map(alert => {
            const member = members[alert.user_id]
            const isOwn = alert.user_id === user?.id
            const d = new Date(alert.created_at)
            const now = new Date()
            const isToday = d.toDateString() === now.toDateString()
            const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
            const isYesterday = d.toDateString() === yesterday.toDateString()
            const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            const dateStr = isToday ? t('sos.today', { time }) : isYesterday ? t('sos.yesterday', { time }) : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`

            const active = !alert.is_resolved
            const who = isOwn ? t('common.you') : member?.display_name || t('sos.family')
            // Old rows carry a coordinate in `message`, or '0', instead of a reason.
            const hasReason = alert.message && alert.message !== '0' && !(/^-?\d+(\.\d+)?$/.test(alert.message))
            const Icon = QUICK_MESSAGES.find(m => m.key === LABEL_TO_KEY[alert.message])?.Icon || Icons.Alert
            // Number(), not `alert.lat &&`: a lat of 0 made that expression
            // evaluate to 0, and React rendered it as a stray "0" on the card.
            const hasLocation = alert.lat != null && alert.lng != null && Number(alert.lat) !== 0
            const canResolve = active && isOwn

            return (
              <div key={alert.id} style={{
                background: 'var(--grad-card)', borderRadius: 20, marginBottom: 12, overflow: 'hidden',
                // Active alerts carry a crimson edge and glow; resolved ones are
                // ordinary cards. No opacity fade — history must stay readable.
                // Maroon like the Send SOS tiles; an unresolved alert keeps a crimson
        // edge so it still stands out from the history around it.
        border: `1.5px solid ${active ? SOS.base : 'var(--maroon)'}`,
                boxShadow: active ? `var(--shadow-sm), 0 8px 22px ${SOS.base}1F` : 'var(--shadow-sm)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 16px 15px' }}>
                  <div style={{
                    width: 48, height: 48, borderRadius: 15, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: active ? `linear-gradient(135deg, ${SOS.glow}, ${SOS.deep})` : 'var(--maroon-wash)',
                    color: active ? '#fff' : 'var(--maroon)',
                    border: active ? 'none' : '1px solid var(--border)',
                    boxShadow: active ? `0 4px 12px ${SOS.base}47, inset 0 1px 0 rgba(255,255,255,0.25)` : 'var(--inset-top)',
                  }}>
                    <span style={{ display: 'flex', transform: 'scale(0.72)' }}><Icon /></span>
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: 'Sora, sans-serif', fontSize: 15, fontWeight: 800, color: 'var(--text)',
                      letterSpacing: -0.2, lineHeight: 1.3,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {hasReason ? translateReason(t, alert.message) : t('family.sosAlert')}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, fontSize: 12, color: 'var(--muted-soft)', fontWeight: 500, minWidth: 0 }}>
                      <span style={{
                        width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                        background: avatarColor(member?.avatar_color),
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontWeight: 800, fontSize: 9,
                      }}>
                        {(member?.display_name || 'F')?.[0]?.toUpperCase()}
                      </span>
                      <span style={{ fontWeight: 700, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{who}</span>
                      <span style={{ color: 'var(--muted3)' }}>•</span>
                      <span style={{ whiteSpace: 'nowrap' }}>{dateStr}</span>
                    </div>
                  </div>

                  <span style={{
                    alignSelf: 'flex-start', flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '5px 10px', borderRadius: 999,
                    fontSize: 11, fontWeight: 800, letterSpacing: 0.3,
                    background: active ? SOS.light : 'var(--emerald-light)',
                    color: active ? SOS.deep : '#047857',
                    boxShadow: `inset 0 0 0 1px ${active ? SOS.base + '33' : 'rgba(16,185,129,0.28)'}`,
                  }}>
                    {active
                      ? <span className="sos-live-dot" />
                      : <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                    {active ? t('sos.active') : t('sos.safe')}
                  </span>
                </div>

                {Date.now() - new Date(alert.created_at).getTime() < 7 * 86400000 && (
                  <div style={{ padding: '0 16px' }}>
                    <SosMediaPlayer groupId={alert.sos_group_id || alert.id} compact />
                  </div>
                )}

                {(hasLocation || canResolve) && (
                  <div style={{ borderTop: '1px solid var(--border)', padding: '11px 16px 13px', display: 'flex', flexDirection: 'column', gap: 11 }}>
                    {hasLocation && (
                      <a href={`https://www.google.com/maps?q=${alert.lat},${alert.lng}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--maroon)', textDecoration: 'none' }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                        </svg>
                        <span style={{ flex: 1 }}>{t('sos.viewOnMaps')}</span>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="9 18 15 12 9 6"/>
                        </svg>
                      </a>
                    )}
                    {canResolve && (
                      <button onClick={() => resolveAlert(alert.id)} className="resolve-btn" style={{ marginTop: 0, width: '100%' }}>
                        {t('sos.markSafe')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        </PullToRefresh>
      )}

      {dialog && (
        <Dialog
          type={dialog.type}
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          onConfirm={dialog.onConfirm}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

// ── A history row you can remove: swipe right, or press and hold ─────────────
// Both routes only ask for removal (the caller shows a confirm), so a stray
// brush of the finger never deletes anything. touch-action keeps vertical
// scrolling of the list working.
function HistoryRow({ onRemove, children }) {
  const start = useRef(null)
  const timer = useRef(null)
  const [dx, setDx] = useState(0)

  const clearTimer = () => { clearTimeout(timer.current); timer.current = null }

  const onTouchStart = (e) => {
    start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, fired: false }
    timer.current = setTimeout(() => {
      if (start.current) { start.current.fired = true; setDx(0); onRemove() }
    }, 550)
  }
  const onTouchMove = (e) => {
    const s = start.current
    if (!s || s.fired) return
    const mx = e.touches[0].clientX - s.x
    const my = e.touches[0].clientY - s.y
    if (Math.abs(mx) > 8 || Math.abs(my) > 8) clearTimer()   // moving, not holding
    if (Math.abs(mx) > Math.abs(my) && mx > 0) setDx(Math.min(mx, 110))
  }
  const onTouchEnd = () => {
    clearTimer()
    const s = start.current
    start.current = null
    if (s && !s.fired && dx > 70) onRemove()
    setDx(0)
  }

  return (
    <div
      onTouchStart={onTouchStart} onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
      onContextMenu={(e) => { e.preventDefault(); onRemove() }}
      style={{
        position: 'relative', margin: '0 0 8px', borderRadius: 16,
        touchAction: 'pan-y', userSelect: 'none', WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
    >
      {/* The bin the row slides away from (left edge) */}
      <div style={{
        position: 'absolute', inset: 0, borderRadius: 16, background: '#B3261E',
        display: 'flex', alignItems: 'center', justifyContent: 'flex-start', paddingLeft: 22,
        color: '#fff', opacity: dx > 0 ? 1 : 0,
      }}>
        <Icon name="trash" size={18} />
      </div>
      <div className="settings-card" style={{
        margin: 0, padding: '10px 16px', position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        transform: `translateX(${dx}px)`, transition: start.current ? 'none' : 'transform 0.2s',
      }}>
        {children}
      </div>
    </div>
  )
}

// ── Individual SOS button ─────────────────────────────────────────────────────
function SOSButton({ msg, onTap, disabled, wide = false }) {
  const t = useT()
  return (
    <button
      onClick={() => !disabled && onTap(msg)}
      disabled={disabled}
      style={{
        gridColumn: wide ? '1 / -1' : undefined,
        // A plain white card like the rest of the app. The crimson lives only
        // on the icon and the badge; a tinted tile turned the page peach.
        background: disabled ? 'var(--bg2)' : 'var(--grad-card)',
        border: `1.5px solid ${disabled ? 'var(--border)' : 'var(--maroon)'}`,
        borderRadius: 18, padding: '18px 12px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'space-between',
        gap: 10, fontFamily: 'inherit', height: '100%',
        boxShadow: disabled ? 'none' : 'var(--shadow-sm)',
        position: 'relative',
        transition: 'all 0.18s ease',
      }}>
      {msg.call && (
        <div style={{
          position: 'absolute', top: 8, right: 8,
          background: SOS.deep, borderRadius: 999,
          minWidth: 30, height: 20, padding: '0 8px',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, fontWeight: 800, letterSpacing: 0.6,
          fontVariantNumeric: 'tabular-nums',
          color: '#fff',
          // Ringed in white and shadowed so the pill separates from the card
          // behind it — at 9px on a bare fill it read as dark-on-dark.
          border: '1.5px solid rgba(255,255,255,0.95)',
          boxShadow: '0 2px 6px rgba(110,10,30,0.34), inset 0 1px 0 rgba(255,255,255,0.28)',
          textShadow: '0 1px 1px rgba(110,10,30,0.45)',
        }}>
          {msg.call}
        </div>
      )}
      <div style={{ color: disabled ? 'var(--muted3)' : SOS.base, marginTop: 4 }}>
        <msg.Icon />
      </div>
      <span style={{
        fontSize: 12, fontWeight: 700, lineHeight: 1.3,
        color: disabled ? 'var(--muted3)' : 'var(--text)',
        textAlign: 'center', width: '100%',
      }}>
        {t('sos.msg.' + msg.key)}
      </span>
    </button>
  )
}
