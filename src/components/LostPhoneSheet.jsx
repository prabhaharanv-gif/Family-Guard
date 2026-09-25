import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '../i18n'
import { useBackButton } from '../hooks/useBackButton'

/**
 * Confirmation before marking a member's phone lost. Asks for an optional short
 * message that will be shown on that phone's lock screen (a number to call, say).
 * Portalled to the page root so the card it is opened from cannot clip it.
 */
export default function LostPhoneSheet({ name, busy, onStart, onClose }) {
  const t = useT()
  const [msg, setMsg] = useState('')
  useBackButton(true, onClose)

  return createPortal(
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(40,8,24,0.45)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 480, background: 'var(--bg)', borderRadius: '22px 22px 0 0',
        padding: '20px 18px calc(20px + env(safe-area-inset-bottom))',
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--maroon)', lineHeight: 1.4 }}>
          {t('lostPhone.sheetTitle', { name })}
        </div>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--muted)', marginTop: 8, lineHeight: 1.6 }}>
          {t('lostPhone.sheetBody')}
        </div>
        <input className="input" value={msg} maxLength={100}
          onChange={e => setMsg(e.target.value)} placeholder={t('lostPhone.placeholder')}
          style={{ marginTop: 14, width: '100%', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: 14, borderRadius: 14, background: '#fff', border: '1.5px solid var(--maroon)',
            color: 'var(--maroon)', fontWeight: 800, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
          }}>{t('common.cancel')}</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => onStart(msg.trim())}
            style={{ flex: 1 }}>
            {t('lostPhone.start')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
