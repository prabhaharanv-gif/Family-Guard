import { useCallback, useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { useBackButton } from '../hooks/useBackButton'
import { MEDIA_MAX_BYTES, formatBytes, mediaKindOf, signedMediaUrl } from '../lib/chatMedia'

/**
 * Attachments in chat: choosing one, recording a voice note, and drawing the
 * result inside a message bubble.
 *
 * Shared by the family room and the private threads so the two cannot drift,
 * the same reasoning as MessageActions.
 *
 * Nothing here talks to the database. A picked file is handed up as
 * { file, kind, durationMs, previewUrl } and the page uploads it as part of
 * sending, so a failed send never leaves an orphaned object in storage.
 */

const MAROON = '#951345'

// ── A private-bucket file needs a signed URL, and signing is async ──────────
// Null until it resolves, so every consumer draws a placeholder first.
function useSignedUrl(path) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!path) { setUrl(null); return }
    let cancelled = false
    signedMediaUrl(path).then((u) => { if (!cancelled) setUrl(u) })
    return () => { cancelled = true }
  }, [path])
  return url
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round((ms || 0) / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── Full-screen image viewer ────────────────────────────────────────────────
function ImageViewer({ url, onClose }) {
  useBackButton(true, onClose)
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 4000,
        background: 'rgba(8,4,10,0.94)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <img src={url} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
    </div>
  )
}

// ── The attachment inside a bubble ──────────────────────────────────────────
export function MediaBubble({ msg, isOwn }) {
  const t = useT()
  const url = useSignedUrl(msg?.media_path)
  const [viewing, setViewing] = useState(false)
  if (!msg?.media_path) return null

  // Sized so a portrait photo and a landscape one both sit inside the bubble
  // without the list jumping as each signed URL resolves.
  const frame = {
    width: '100%', maxWidth: 230, borderRadius: 12,
    display: 'block', background: isOwn ? 'rgba(255,255,255,0.16)' : '#F5EEF1',
  }

  if (!url) {
    return (
      <div style={{ ...frame, height: msg.media_type === 'audio' ? 42 : 150 }} className="skeleton" />
    )
  }

  if (msg.media_type === 'image') {
    return (
      <>
        <img
          src={url} alt={t('messages.mediaPhoto')}
          onClick={() => setViewing(true)}
          style={{ ...frame, maxHeight: 280, objectFit: 'cover', cursor: 'pointer' }}
        />
        {viewing && <ImageViewer url={url} onClose={() => setViewing(false)} />}
      </>
    )
  }

  if (msg.media_type === 'video') {
    return <video src={url} controls playsInline preload="metadata" style={{ ...frame, maxHeight: 280 }} />
  }

  if (msg.media_type === 'audio') {
    return (
      <audio
        src={url} controls preload="metadata"
        style={{ width: 220, maxWidth: '100%', height: 40, display: 'block' }}
      />
    )
  }

  // A document is a link, not a player. Opening an external https URL from the
  // WebView hands it to the phone's browser, which is what knows how to show a
  // PDF or pass a .docx to Office.
  return (
    <a
      href={url} target="_blank" rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: 220, maxWidth: '100%', boxSizing: 'border-box',
        padding: '8px 10px', borderRadius: 10, textDecoration: 'none',
        background: isOwn ? 'rgba(255,255,255,0.16)' : '#F8EEF3',
        border: isOwn ? '1px solid rgba(255,255,255,0.25)' : '1px solid #F0E4EA',
        color: 'inherit',
      }}
    >
      <span style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: isOwn ? 'rgba(255,255,255,0.22)' : '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
          stroke={isOwn ? '#fff' : MAROON} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{
          display: 'block', fontSize: 12.5, fontWeight: 700,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{msg.media_name || t('messages.mediaDocument')}</span>
        <span style={{ display: 'block', fontSize: 10.5, opacity: 0.75 }}>
          {formatBytes(msg.media_size)}
        </span>
      </span>
    </a>
  )
}

// ── Picking a file ──────────────────────────────────────────────────────────
// A small menu anchored to the + button, not a bottom sheet: this is a list of
// four one-word choices, and a half-screen panel with a drag handle made it
// feel like a much bigger decision than it is.
//
// One hidden input, re-pointed by `accept` — four inputs would each have to be
// reset separately, and a WebView will happily reuse a stale one.
//
// Documents are picked by an explicit list of types rather than a wildcard:
// Android's picker offers "every file on the phone" for */*, and the bucket
// would then reject most of what came back.
const DOC_ACCEPT = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv', 'application/zip',
  // Extensions as well: a file manager that reports application/octet-stream
  // for a .docx will still match on the suffix.
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv', '.zip',
].join(',')

const MENU_WIDTH = 184
const MENU_ROW_H = 44

export function AttachButton({ onPick, onError, disabled }) {
  const t = useT()
  const inputRef  = useRef(null)
  const buttonRef = useRef(null)
  const [accept, setAccept] = useState('image/*')
  // The button's position at the moment it was tapped, or null when closed.
  const [anchor, setAnchor] = useState(null)

  useBackButton(!!anchor, () => setAnchor(null))

  const choose = (mime) => {
    setAccept(mime)
    setAnchor(null)
    // The accept attribute has to be on the element before it opens, and React
    // has not flushed the state change yet at this point.
    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.accept = mime
        inputRef.current.click()
      }
    })
  }

  const handleChange = (e) => {
    const file = e.target.files && e.target.files[0]
    // Reset first: picking the SAME file twice in a row fires no change event
    // otherwise, which reads as the button being broken.
    e.target.value = ''
    if (!file) return
    const kind = mediaKindOf(file)
    if (!kind) { onError?.(t('messages.mediaUnsupported')); return }
    if (file.size > MEDIA_MAX_BYTES) { onError?.(t('messages.mediaTooBig')); return }
    onPick({ file, kind, previewUrl: kind === 'image' ? URL.createObjectURL(file) : null })
  }

  const items = [
    {
      kind: 'image', label: t('messages.mediaPhoto'), mime: 'image/*', color: '#0EA5E9',
      icon: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>,
    },
    {
      kind: 'video', label: t('messages.mediaVideo'), mime: 'video/*', color: '#7C3AED',
      icon: <><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></>,
    },
    {
      kind: 'audio', label: t('messages.mediaAudio'), mime: 'audio/*', color: '#059669',
      icon: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
    },
    {
      kind: 'document', label: t('messages.mediaDocument'), mime: DOC_ACCEPT, color: '#D97706',
      icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></>,
    },
  ]

  // Opens upwards from the button, since the composer sits at the bottom of the
  // screen. Both axes are clamped so it stays fully on screen on a narrow phone.
  const vw = typeof window === 'undefined' ? 360 : window.innerWidth
  const vh = typeof window === 'undefined' ? 640 : window.innerHeight
  const M = 8
  const height = items.length * MENU_ROW_H + 12
  const left = anchor
    ? Math.max(M, Math.min(anchor.left, vw - MENU_WIDTH - M))
    : 0
  const top = anchor
    ? Math.max(M, Math.min(anchor.top - height - 8, vh - height - M))
    : 0

  return (
    <>
      <input
        ref={inputRef} type="file" accept={accept}
        onChange={handleChange} style={{ display: 'none' }}
      />
      <button
        ref={buttonRef}
        onClick={() => setAnchor(buttonRef.current?.getBoundingClientRect() ?? null)}
        disabled={disabled}
        aria-label={t('messages.attach')}
        style={{
          width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
          background: anchor ? MAROON : '#F8EEF3',
          border: `1.5px solid ${anchor ? MAROON : '#F0E4EA'}`,
          color: anchor ? '#fff' : MAROON,
          cursor: disabled ? 'default' : 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: disabled ? 0.5 : 1,
          transition: 'background 0.15s, transform 0.15s',
          transform: anchor ? 'rotate(45deg)' : 'none',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.2" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>

      {anchor && (
        <div
          onClick={() => setAnchor(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(13,12,29,0.16)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed', top, left, width: MENU_WIDTH,
              background: '#fff', borderRadius: 14,
              border: '1px solid #F0E4EA',
              boxShadow: '0 14px 36px rgba(20,8,24,0.24)',
              padding: 6, overflow: 'hidden',
            }}
          >
            {items.map((it, i) => (
              <div key={it.kind}>
                {i > 0 && <div style={{ height: 1, background: '#F7EFF3', margin: '0 6px' }} />}
                <button
                  onClick={() => choose(it.mime)}
                  style={{
                    width: '100%', height: MENU_ROW_H, padding: '0 8px',
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontFamily: 'inherit', textAlign: 'left',
                    display: 'flex', alignItems: 'center', gap: 10,
                    color: '#0D0C1D', fontSize: 13.5, fontWeight: 700,
                  }}
                >
                  <span style={{
                    width: 28, height: 28, borderRadius: 9, flexShrink: 0,
                    background: `${it.color}1A`, color: it.color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {it.icon}
                    </svg>
                  </span>
                  {it.label}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ── Voice note ──────────────────────────────────────────────────────────────
// Tap to start, tap to stop — not press-and-hold: a long press is already the
// message action sheet everywhere else in this chat, and holding a button
// while the WebView scrolls is unreliable on Android.
const MAX_RECORDING_MS = 5 * 60 * 1000

export function VoiceRecorder({ onRecorded, onError, disabled }) {
  const t = useT()
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed]     = useState(0)
  const recRef      = useRef(null)
  const chunksRef   = useRef([])
  const startedRef  = useRef(0)
  const cancelRef   = useRef(false)
  const timerRef    = useRef(null)

  const cleanup = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setRecording(false)
    setElapsed(0)
  }, [])

  // A recorder left running when the tab unmounts keeps the microphone (and
  // the red status bar dot) alive for the life of the process.
  useEffect(() => () => {
    try {
      if (recRef.current && recRef.current.state !== 'inactive') {
        cancelRef.current = true
        recRef.current.stop()
      }
    } catch (e) { /* already gone */ }
    if (timerRef.current) clearInterval(timerRef.current)
  }, [])

  const start = async () => {
    if (disabled || recording) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const preferred = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        .find((m) => { try { return MediaRecorder.isTypeSupported(m) } catch (e) { return false } })
      const rec = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined)

      chunksRef.current = []
      cancelRef.current = false
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        stream.getTracks().forEach((tr) => tr.stop())
        const durationMs = Date.now() - startedRef.current
        cleanup()
        if (cancelRef.current) return
        const mime = (rec.mimeType || 'audio/webm').split(';')[0]
        const blob = new Blob(chunksRef.current, { type: mime })
        if (!blob.size) { onError?.(t('messages.micFailed')); return }
        const ext  = mime === 'audio/mp4' ? 'm4a' : 'weba'
        const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mime })
        onRecorded({ file, kind: 'audio', durationMs, previewUrl: null })
      }

      recRef.current  = rec
      startedRef.current = Date.now()
      rec.start()
      setRecording(true)
      setElapsed(0)
      timerRef.current = setInterval(() => {
        const ms = Date.now() - startedRef.current
        setElapsed(ms)
        if (ms >= MAX_RECORDING_MS) { try { rec.stop() } catch (e) {} }
      }, 200)
    } catch (e) {
      // Permission refused, or no microphone. Either way there is nothing the
      // app can do beyond saying so.
      onError?.(t('messages.micFailed'))
      cleanup()
    }
  }

  const stop = (cancel) => {
    cancelRef.current = !!cancel
    try {
      if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop()
      else cleanup()
    } catch (e) { cleanup() }
  }

  if (recording) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, flex: 1,
        background: '#FDF2F6', border: '1.5px solid #F0D8E2',
        borderRadius: 22, padding: '6px 8px 6px 14px', minWidth: 0,
      }}>
        <span style={{
          width: 9, height: 9, borderRadius: '50%', background: '#E11D48',
          animation: 'recpulse 1s ease-in-out infinite', flexShrink: 0,
        }} />
        <style>{'@keyframes recpulse{0%,100%{opacity:1}50%{opacity:.25}}'}</style>
        <span style={{ fontSize: 13, fontWeight: 800, color: MAROON, flex: 1 }}>
          {formatDuration(elapsed)}
        </span>
        <button
          onClick={() => stop(true)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: '#9C6B7A', fontSize: 13, fontWeight: 700,
            fontFamily: 'inherit', padding: '0 6px',
          }}
        >{t('common.cancel')}</button>
        <button
          onClick={() => stop(false)}
          aria-label={t('messages.stopRecording')}
          style={{
            width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
            background: MAROON, border: 'none', color: '#fff', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={start}
      disabled={disabled}
      aria-label={t('messages.recordVoice')}
      style={{
        width: 40, height: 40, borderRadius: '50%', flexShrink: 0,
        background: '#F8EEF3', border: '1.5px solid #F0E4EA',
        color: MAROON, cursor: disabled ? 'default' : 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
      </svg>
    </button>
  )
}

// ── The strip above the composer holding a picked file ──────────────────────
export function PendingMediaBar({ pending, uploading, onCancel }) {
  const t = useT()
  if (!pending) return null
  const label = pending.kind === 'image' ? t('messages.mediaPhoto')
    : pending.kind === 'video' ? t('messages.mediaVideo')
    : pending.kind === 'document' ? t('messages.mediaDocument')
    : t('messages.mediaAudio')
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 16px', background: '#F8EEF3',
      borderTop: '1px solid #F0D8E2',
    }}>
      {pending.previewUrl ? (
        <img src={pending.previewUrl} alt="" style={{
          width: 40, height: 40, borderRadius: 8, objectFit: 'cover', flexShrink: 0,
        }} />
      ) : (
        <div style={{
          width: 40, height: 40, borderRadius: 8, flexShrink: 0,
          background: '#fff', border: '1px solid #F0D8E2',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: MAROON, fontSize: 18,
        }}>{pending.kind === 'video' ? '🎬' : pending.kind === 'document' ? '📄' : '🎵'}</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: MAROON }}>
          {uploading ? t('messages.mediaUploading') : label}
        </div>
        <div style={{
          fontSize: 11, color: '#9C6B7A', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {pending.durationMs ? formatDuration(pending.durationMs) : pending.file?.name}
        </div>
      </div>
      <button
        onClick={onCancel} disabled={uploading}
        style={{
          background: 'none', border: 'none',
          cursor: uploading ? 'default' : 'pointer',
          fontSize: 18, color: '#8480B0', padding: '0 4px', flexShrink: 0,
        }}
      >✕</button>
    </div>
  )
}
