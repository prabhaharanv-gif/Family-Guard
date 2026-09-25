// The voice clip and photo on an SOS.
//   SosSenderMedia — on the sender's own "SOS sent" screen: records the clip
//                    (if the sender switched that on) and takes an optional photo.
//   SosMediaPlayer — on the family's side: plays the clip, shows the photos.
// Visibility and retention are enforced in the database; see
// supabase/migrations/20260924160000_sos_media.sql.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useT } from '../i18n'
import Icon from './Icon'
import {
  voiceClipEnabled, startVoiceRecording, uploadSosMedia, shrinkImage, listSosMedia, VOICE_MAX_MS,
} from '../lib/sosMedia'

const row = {
  display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px',
  borderTop: '1px solid rgba(139,13,61,0.3)',
}
const tile = {
  width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: '#8B0D3D', color: '#FFF8F0',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}

export function SosSenderMedia({ alertId }) {
  const t = useT()
  const user = useAuthStore(s => s.user)
  const [voice, setVoice] = useState(voiceClipEnabled() ? 'starting' : 'off')  // off|starting|recording|uploading|sent|failed
  const [secs, setSecs] = useState(0)
  const [photos, setPhotos] = useState(0)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoFailed, setPhotoFailed] = useState(false)
  const recRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => {
    if (!alertId || !user?.id || !voiceClipEnabled()) return
    let alive = true
    let tick = null
    ;(async () => {
      try {
        const rec = await startVoiceRecording(VOICE_MAX_MS)
        if (!alive) { rec.stop(); return }
        recRef.current = rec
        setVoice('recording')
        const t0 = Date.now()
        tick = setInterval(() => setSecs(Math.floor((Date.now() - t0) / 1000)), 500)
        const out = await rec.done
        clearInterval(tick)
        if (alive) setVoice('uploading')
        await uploadSosMedia({ userId: user.id, alertId, kind: 'voice', ...out })
        if (alive) setVoice('sent')
      } catch (e) {
        console.warn('[sos-media] voice clip failed:', e?.message || e)
        clearInterval(tick)
        if (alive) setVoice('failed')
      }
    })()
    // Leaving the screen stops the recording but still lets the upload finish.
    return () => { alive = false; clearInterval(tick); recRef.current?.stop() }
  }, [alertId, user?.id])

  const onPhoto = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !alertId || !user?.id) return
    setPhotoBusy(true); setPhotoFailed(false)
    try {
      const blob = await shrinkImage(file)
      await uploadSosMedia({ userId: user.id, alertId, kind: 'photo', blob, mime: 'image/jpeg' })
      setPhotos(n => n + 1)
    } catch (err) {
      console.warn('[sos-media] photo failed:', err?.message || err)
      setPhotoFailed(true)
    } finally {
      setPhotoBusy(false)
    }
  }

  if (!alertId) return null
  const voiceLabel = {
    starting:  t('sosMedia.voiceStarting'),
    recording: t('sosMedia.voiceRecording', { s: secs, max: VOICE_MAX_MS / 1000 }),
    uploading: t('sosMedia.voiceUploading'),
    sent:      t('sosMedia.voiceSent'),
    failed:    t('sosMedia.voiceFailed'),
  }[voice]

  return (
    <div style={{
      width: '100%', marginTop: 14, background: '#F8E6ED', border: '1.5px solid #8B0D3D',
      borderRadius: 16, overflow: 'hidden',
    }}>
      {voice !== 'off' && (
        <div style={{ ...row, borderTop: 'none' }}>
          <span style={tile}><Icon name="mic" size={18} /></span>
          <span style={{ fontSize: 14, color: '#2A0A18', fontWeight: 600, flex: 1 }}>{voiceLabel}</span>
          {voice === 'recording' && (
            <button onClick={() => recRef.current?.stop()} style={{
              background: '#8B0D3D', color: '#fff', border: 'none', borderRadius: 10,
              padding: '7px 12px', fontWeight: 800, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
            }}>{t('sosMedia.stop')}</button>
          )}
        </div>
      )}
      <div style={{ ...row, borderTop: voice === 'off' ? 'none' : row.borderTop }}>
        <span style={tile}><Icon name="camera" size={18} /></span>
        <span style={{ fontSize: 14, color: '#2A0A18', fontWeight: 600, flex: 1 }}>
          {photoFailed ? t('sosMedia.photoFailed')
            : photoBusy ? t('sosMedia.photoUploading')
            : photos > 0 ? t('sosMedia.photoSent', { n: photos })
            : t('sosMedia.photoAdd')}
        </span>
        {photos < 3 && (
          <button onClick={() => fileRef.current?.click()} disabled={photoBusy} style={{
            background: '#fff', color: '#8B0D3D', border: '1.5px solid #8B0D3D', borderRadius: 10,
            padding: '7px 12px', fontWeight: 800, fontSize: 12, fontFamily: 'inherit',
            cursor: 'pointer', opacity: photoBusy ? 0.6 : 1,
          }}>{t('sosMedia.takePhoto')}</button>
        )}
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: 'none' }} />
      </div>
    </div>
  )
}

/** Family side. `groupId` is alert.sos_group_id, or the alert's own id when it has none. */
export function SosMediaPlayer({ groupId, compact = false, live = false }) {
  const t = useT()
  const [items, setItems] = useState([])

  useEffect(() => {
    if (!groupId) return
    let cancelled = false
    const load = () => listSosMedia(groupId).then(r => { if (!cancelled) setItems(r) }).catch(() => {})
    load()
    if (!live) return () => { cancelled = true }
    const ch = supabase
      .channel(`sos-media:${groupId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'sos_media', filter: `sos_group_id=eq.${groupId}` },
        load)
      .subscribe()
    return () => { cancelled = true; supabase.removeChannel(ch) }
  }, [groupId, live])

  if (!items.length) return null
  const voice = items.find(i => i.kind === 'voice')
  const photos = items.filter(i => i.kind === 'photo')
  return (
    <div style={{ marginTop: compact ? 8 : 10 }}>
      {voice && (
        <div style={{ marginBottom: photos.length ? 8 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, opacity: 0.85, marginBottom: 4 }}>
            <Icon name="mic" size={14} /> {t('sosMedia.voiceFrom')}
          </div>
          <audio controls preload="none" src={voice.url} style={{ width: '100%', height: 36 }} />
        </div>
      )}
      {photos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {photos.map(p => (
            <img key={p.id} src={p.url} alt={t('sosMedia.photoAlt')}
              onClick={() => window.open(p.url, '_system')}
              style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 10, cursor: 'pointer', border: '1.5px solid rgba(255,255,255,0.6)' }} />
          ))}
        </div>
      )}
    </div>
  )
}
