// Voice clip and photo attached to an SOS — see
// supabase/migrations/20260924160000_sos_media.sql for who can see them and
// how long they are kept.
//
// The clip is recorded in the WebView (the app already uses the microphone
// for calls, so the permission path exists) and only from the in-app SOS
// screen, where the app is in the foreground. Recording from a pocket-gesture
// SOS is a separate problem: Android does not let a background app start the
// microphone.
import { supabase } from './supabase'

export const VOICE_MAX_MS = 15000
const BUCKET = 'sos-media'
const PREF_KEY = 'famora_sos_voice_clip'

// ── The sender's own switch (per device) ────────────────────────────────────
export function voiceClipEnabled() {
  try { return localStorage.getItem(PREF_KEY) === '1' } catch { return false }
}
export function setVoiceClipEnabled(on) {
  try { localStorage.setItem(PREF_KEY, on ? '1' : '0') } catch { /* private mode */ }
}

// ── Recording ───────────────────────────────────────────────────────────────
function pickMime() {
  const wanted = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
  if (typeof MediaRecorder === 'undefined') return null
  return wanted.find(m => MediaRecorder.isTypeSupported?.(m)) || ''
}

/**
 * Starts recording. Resolves to { stop(), done } where `done` resolves with
 * { blob, mime, durationMs } once stopped (by stop() or after maxMs).
 * Rejects if the microphone is unavailable or refused.
 */
export async function startVoiceRecording(maxMs = VOICE_MAX_MS) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('recording not supported')
  }
  // Voice-call processing is tuned to hide background sound, which is the
  // opposite of what a family needs from an SOS clip: noise suppression and
  // echo cancellation dull quiet or distant speech. Automatic gain stays on so
  // a whisper or a muffled pocket is still lifted to an audible level.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
  })
  const mime = pickMime()
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 })
  const chunks = []
  const startedAt = Date.now()
  let timer = null

  const done = new Promise((resolve) => {
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
    rec.onstop = () => {
      clearTimeout(timer)
      stream.getTracks().forEach(tr => tr.stop())
      const type = rec.mimeType || mime || 'audio/webm'
      resolve({ blob: new Blob(chunks, { type }), mime: type.split(';')[0], durationMs: Date.now() - startedAt })
    }
  })
  rec.start()
  timer = setTimeout(() => { if (rec.state !== 'inactive') rec.stop() }, maxMs)
  return { stop: () => { if (rec.state !== 'inactive') rec.stop() }, done }
}

// ── Photos: shrink a phone-camera JPEG before it goes over mobile data ──────
export async function shrinkImage(file, maxSide = 1600, quality = 0.8) {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bmp.width * scale)
  canvas.height = Math.round(bmp.height * scale)
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality))
  if (!blob) throw new Error('could not encode image')
  return blob
}

// ── Upload + register ───────────────────────────────────────────────────────
const EXT = { 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'image/jpeg': 'jpg' }

/** The key every family the SOS went to shares: sos_group_id, or the alert's own id. */
export async function groupIdForAlert(alertId) {
  const { data, error } = await supabase
    .from('sos_alerts').select('id, sos_group_id').eq('id', alertId).single()
  if (error || !data) throw error || new Error('alert not found')
  return data.sos_group_id || data.id
}

// A mobile connection in an emergency is exactly when a request drops, and one
// gateway error (a 520 was seen in testing) should not lose the clip. Each step
// is retried with a short pause.
async function withRetry(fn, tries = 3) {
  let last
  for (let i = 0; i < tries; i++) {
    try { return await fn() } catch (e) { last = e; await new Promise(r => setTimeout(r, 1200 * (i + 1))) }
  }
  throw last
}

export async function uploadSosMedia({ userId, alertId, kind, blob, mime, durationMs }) {
  const group = await withRetry(() => groupIdForAlert(alertId))
  const path = `${userId}/${group}/${kind}-${Date.now()}.${EXT[mime] || 'bin'}`
  await withRetry(async () => {
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: false })
    // Already there means an earlier try landed and only its reply was lost.
    if (error && !/already exists|Duplicate/i.test(error.message || '') && String(error.statusCode) !== '409') throw error
  })
  await withRetry(async () => {
    const { error } = await supabase.rpc('attach_sos_media', {
      p_sos_alert_id: alertId, p_kind: kind, p_path: path, p_mime: mime, p_duration_ms: durationMs ?? null,
    })
    // 22023 here can only mean an earlier try already registered it.
    if (error && error.code !== '22023') throw error
  })
}

// ── Reading (family side) ───────────────────────────────────────────────────
/** Rows for one SOS with a short-lived signed URL each. */
export async function listSosMedia(groupId) {
  const { data, error } = await supabase
    .from('sos_media').select('id, kind, path, mime, duration_ms, created_at')
    .eq('sos_group_id', groupId).order('created_at', { ascending: true })
  if (error || !data?.length) return []
  const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(data.map(r => r.path), 3600)
  const byPath = Object.fromEntries((signed || []).map(s => [s.path, s.signedUrl]))
  return data.map(r => ({ ...r, url: byPath[r.path] || null })).filter(r => r.url)
}
