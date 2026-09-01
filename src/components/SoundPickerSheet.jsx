import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import { useBackButton } from '../hooks/useBackButton'
import {
  listRingtones, previewRingtone, setRingtone, stopPreview, pickAudioFile,
} from '../lib/ringtones'

/**
 * The app's own sound picker.
 *
 * Android's system picker (com.android.soundpicker) belongs to another package
 * and cannot be themed, so this draws the same choice in the app's colours and
 * only asks the native side for the sounds themselves.
 *
 * Tapping a row selects it AND plays it, which is the whole point of a sound
 * list — choosing without hearing is guesswork. Nothing is saved until Save, so
 * backing out leaves the previous choice alone.
 *
 * The bottom row opens the phone's own apps rather than the system ringtone
 * picker: that one lists exactly the same registered ringtones this sheet
 * already shows, so it added nothing. A song, a download or a recording is what
 * is genuinely missing here, and Music/Files is where those live. The two icons
 * are two buttons, not one — the music note opens the music app's song list,
 * the folder opens the file manager, and a single button could only ever have
 * opened one of them.
 */
export default function SoundPickerSheet({ type, title, onClose, onSaved }) {
  const t = useT()
  const [items, setItems]       = useState(null)   // null = still loading
  const [selected, setSelected] = useState(null)   // uri, or '' for Default
  const [saving, setSaving]     = useState(false)
  const listRef = useRef(null)

  useBackButton(true, () => { stopPreview(); onClose() })

  useEffect(() => {
    let cancelled = false
    listRingtones(type).then((res) => {
      if (cancelled) return
      setItems(res?.items || [])
      setSelected(res?.current || '')
    })
    // Nothing may keep playing after the sheet is gone.
    return () => { cancelled = true; stopPreview() }
  }, [type])

  // Bring the current choice into view once the list is there, so a sound far
  // down the alphabet does not look unselected.
  useEffect(() => {
    if (!items || !listRef.current) return
    const el = listRef.current.querySelector('[data-selected="1"]')
    if (el) el.scrollIntoView({ block: 'center' })
  }, [items])

  const choose = (uri) => {
    setSelected(uri)
    previewRingtone(uri)          // '' stops playback, which is right for Default
  }

  const handleSave = async () => {
    setSaving(true)
    const res = await setRingtone(type, selected)
    setSaving(false)
    stopPreview()
    onSaved?.(res?.title || null)
    onClose()
  }

  // Music / Files — everything that is not a registered ringtone. The chosen
  // file is saved by the native side (it has to take a persistable read grant
  // at the same moment), so this closes on success rather than waiting for Save.
  const handlePick = async (source) => {
    stopPreview()
    const res = await pickAudioFile(type, source)
    if (res?.changed) { onSaved?.(res.title || null); onClose() }
  }

  const Row = ({ uri, label, isDefault }) => {
    const on = selected === uri
    return (
      <button
        data-selected={on ? '1' : '0'}
        onClick={() => choose(uri)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 6px', background: 'none', border: 'none',
          borderBottom: '1px solid #F8F0F4', cursor: 'pointer',
          fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        <span style={{
          width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
          border: on ? '6px solid #951345' : '2px solid #DDC6D1',
          boxSizing: 'border-box', transition: 'border 0.12s',
        }} />
        <span style={{
          flex: 1, minWidth: 0, fontSize: 14,
          fontWeight: on ? 800 : 600,
          color: on ? '#951345' : '#0D0C1D',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {label}
        </span>
        {isDefault && (
          <span style={{ fontSize: 11, color: '#9C6B7A', flexShrink: 0 }}>
            {t('profile.appSound')}
          </span>
        )}
      </button>
    )
  }

  // One of the two sources under the list. Each is its own tap target: the
  // music note opens the music app, the folder the file manager.
  const SourceButton = ({ source, label, icon }) => (
    <button
      onClick={() => handlePick(source)}
      aria-label={label}
      title={label}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '13px 6px', background: 'none', border: 'none',
        cursor: 'pointer', fontFamily: 'inherit', color: '#951345',
      }}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {icon}
      </svg>
    </button>
  )

  return (
    <div className="overlay" onClick={() => { stopPreview(); onClose() }}>
      <div className="popup" onClick={(e) => e.stopPropagation()} style={{ paddingBottom: 16 }}>
        <div className="popup-handle" />

        <div style={{
          fontSize: 11, fontWeight: 800, color: '#951345',
          textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2,
        }}>{t('profile.chooseSound')}</div>
        <div style={{ fontSize: 15, fontWeight: 800, color: '#0D0C1D', marginBottom: 10 }}>
          {title}
        </div>

        <div ref={listRef} style={{ maxHeight: '46vh', overflowY: 'auto', marginBottom: 14 }}>
          {items === null ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: '#9C6B7A', fontSize: 13 }}>
              {t('common.loading')}
            </div>
          ) : (
            <>
              <Row uri="" label={t('profile.default')} isDefault />
              {items.map((it) => (
                <Row key={it.uri} uri={it.uri} label={it.title} />
              ))}
            </>
          )}
        </div>

        {/* Icons only — the two sources speak for themselves, and a sentence
            of explanation under a list of 90 sounds was the longest thing on
            the sheet. The label survives as the accessible name. */}
        <div style={{
          display: 'flex', borderTop: '1px solid #F0E4EA', marginBottom: 12,
        }}>
          <SourceButton
            source="music"
            label={t('profile.soundFromMusic')}
            icon={
              <>
                <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
              </>
            }
          />
          {/* A hairline between them, so two tap targets do not read as one. */}
          <div style={{ width: 1, background: '#F0E4EA', margin: '8px 0' }} />
          <SourceButton
            source="files"
            label={t('profile.soundFromFiles')}
            icon={
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            }
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => { stopPreview(); onClose() }}
            style={{
              flex: 1, padding: 14, borderRadius: 14,
              background: '#F5F4FB', border: '1px solid #E9E6FB',
              color: '#3A1020', fontWeight: 700, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 14,
            }}
          >{t('common.cancel')}</button>
          <button
            onClick={handleSave}
            disabled={saving || items === null}
            style={{
              flex: 1, padding: 14, borderRadius: 14,
              background: '#951345', border: 'none',
              color: '#fff', fontWeight: 700, cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 14,
            }}
          >{saving ? t('common.saving') : t('common.save')}</button>
        </div>
      </div>
    </div>
  )
}
