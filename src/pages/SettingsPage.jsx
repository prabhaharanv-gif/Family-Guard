import { useState } from 'react'
import { useAuthStore } from '../store/authStore'
import Dialog from '../components/Dialog'
import { useT, useLangStore, UI_LANGUAGES } from '../i18n'
import Icon from '../components/Icon'

export default function SettingsPage() {
  const { user, familyName, inviteCode, signOut } = useAuthStore()
  const [dialog, setDialog] = useState(null)
  const t = useT()
  const setLang = useLangStore(s => s.setLang)

  const handleCopyCode = () => {
    navigator.clipboard.writeText(inviteCode)
    setDialog({ type: 'alert', title: t('settings.codeCopied'), message: t('settings.codeCopiedMsg') })
  }

  const handleSignOut = () => {
    setDialog({
      type: 'confirm',
      title: t('settings.signOut'),
      message: t('settings.signOutConfirm'),
      confirmLabel: t('settings.signOut'),
      onConfirm: signOut,
    })
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="top-bar">
        <div>
          <div className="top-bar-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            {t('settings.title')}
          </div>
          <div className="top-bar-sub">{t('settings.sub')}</div>
        </div>
      </div>

      <div className="page-content">
        {/* Profile Card */}
        <div style={{
          background: 'linear-gradient(135deg, var(--maroon-deep) 0%, var(--maroon-darkest) 100%)',
          borderRadius: 20, padding: 20, marginBottom: 16,
          display: 'flex', alignItems: 'center', gap: 16,
          boxShadow: '0 8px 32px rgba(139,13,61,0.25)',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, fontWeight: 800, color: '#fff',
            border: '2px solid rgba(255,255,255,0.3)',
            flexShrink: 0,
          }}>
            {user?.email?.[0]?.toUpperCase()}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 16, lineHeight: 1.4 }}>
              {user?.user_metadata?.display_name || t('common.you')}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, marginTop: 2 }}>
              {user?.email}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>
              {familyName}
            </div>
          </div>
        </div>

        {/* Language — first card, because someone who cannot read the rest of
            this screen needs to reach it without understanding any of it. The
            options are written in their own script for the same reason. */}
        <div className="settings-card">
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
            {t('settings.language')}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted-soft)', marginBottom: 10, lineHeight: 1.5 }}>
            {t('settings.languageSub')}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {UI_LANGUAGES.map(l => {
              const active = l.code === t.lang
              return (
                <button
                  key={l.code}
                  onClick={() => setLang(l.code)}
                  aria-pressed={active}
                  style={{
                    padding: '9px 16px', borderRadius: 999,
                    background: active ? 'linear-gradient(135deg,var(--maroon),var(--maroon-deep))' : 'var(--bg2)',
                    border: `1.5px solid ${active ? 'transparent' : 'var(--border)'}`,
                    color: active ? '#fff' : '#5B4652',
                    fontWeight: active ? 800 : 600,
                    fontSize: 13.5, cursor: 'pointer', fontFamily: 'inherit',
                    lineHeight: 1.6,
                  }}
                >
                  {l.native}
                </button>
              )
            })}
          </div>
        </div>

        {/* Family Code */}
        <div className="settings-card">
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            {t('settings.inviteCodeLabel')}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontSize: 24, fontWeight: 900, letterSpacing: 6, color: '#000000' }}>
              {inviteCode}
            </div>
            <button onClick={handleCopyCode}
              style={{
                background: 'var(--blue-light)', border: 'none', borderRadius: 10,
                padding: '8px 14px', color: '#000000', fontWeight: 700,
                fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                flexShrink: 0,
              }}>
              <Icon name="copy" /> {t('settings.copy')}
            </button>
          </div>
        </div>

        {/* App Info */}
        <div className="settings-card">
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
            {t('settings.about')}
          </div>
          {[
            { label: t('settings.app'), value: 'Famora' },
            { label: t('settings.version'), value: import.meta.env.VITE_APP_VERSION || '1.1.0' },
            { label: t('settings.platform'), value: t('settings.platformValue') },
          ].map(item => (
            <div key={item.label} style={{
              display: 'flex', justifyContent: 'space-between', gap: 12,
              padding: '8px 0', borderBottom: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: 14, color: 'var(--text2)', lineHeight: 1.5 }}>{item.label}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)', textAlign: 'right', lineHeight: 1.5 }}>{item.value}</span>
            </div>
          ))}
        </div>

        {/* User Guide */}
        <div className="settings-card" style={{ cursor: 'pointer' }} onClick={() => window.location.href = '/manual'}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ flexShrink: 0, display: 'flex', color: 'var(--maroon)' }}><Icon name="book" size={20} /></span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#000', lineHeight: 1.45 }}>{t('settings.userGuide')}</div>
                <div style={{ fontSize: 11, color: 'var(--muted-soft)', marginTop: 1, lineHeight: 1.5 }}>{t('settings.userGuideSub')}</div>
              </div>
            </div>
            <span style={{ color: 'var(--muted-soft)', fontSize: 16, flexShrink: 0 }}>›</span>
          </div>
        </div>

        {/* Privacy Policy */}
        <div className="settings-card" style={{ cursor: 'pointer' }} onClick={() => window.location.href = '/privacy'}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ flexShrink: 0, display: 'flex', color: 'var(--maroon)' }}><Icon name="lock" size={20} /></span>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#000', lineHeight: 1.45 }}>{t('settings.privacyPolicy')}</span>
            </div>
            <span style={{ color: 'var(--muted-soft)', fontSize: 16, flexShrink: 0 }}>›</span>
          </div>
        </div>

        {/* Sign Out */}
        <button onClick={handleSignOut}
          style={{
            width: '100%', padding: 15, borderRadius: 16,
            background: 'var(--red-light)', border: '1.5px solid rgba(245,59,87,0.2)',
            color: 'var(--red)', fontWeight: 700, fontSize: 15,
            fontFamily: 'inherit', cursor: 'pointer', marginTop: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            lineHeight: 1.5,
          }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
            <polyline points="16 17 21 12 16 7"/>
            <line x1="21" y1="12" x2="9" y2="12"/>
          </svg>
          {t('settings.signOut')}
        </button>
      </div>

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
