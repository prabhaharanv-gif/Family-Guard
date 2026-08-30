/**
 * DeleteAccountPage
 *
 * The public account-deletion route. Google Play requires a way to request
 * deletion from the open web — reachable without installing the app — so this
 * sits outside PrivateRoute, and ConsentGate already lets signed-out visitors
 * through. Someone who has uninstalled Famora can still land here and act.
 *
 * It deliberately holds no delete button of its own. The in-app path already
 * runs delete_my_account() behind a typed confirmation; duplicating that here,
 * on a page a signed-out stranger can open, would be a worse design. This page
 * explains the two routes and hands the second one to a human.
 */

import { useNavigate } from 'react-router-dom'
import { CONTACT_EMAIL } from '../lib/policy'
import { useT } from '../i18n'

function Card({ title, children }) {
  return (
    <div style={{
      background: '#fff', borderRadius: 16, padding: '16px 18px',
      marginBottom: 12, border: '1.5px solid #EFE9F5',
      boxShadow: '0 2px 12px rgba(149,19,69,0.06)',
    }}>
      <div style={{
        fontSize: 14, fontWeight: 800, color: '#951345',
        fontFamily: 'Sora, sans-serif', marginBottom: 6, lineHeight: 1.4,
      }}>
        {title}
      </div>
      <div style={{ fontSize: 13.5, color: '#3A1020', lineHeight: 1.65 }}>
        {children}
      </div>
    </div>
  )
}

export default function DeleteAccountPage() {
  const navigate = useNavigate()
  const t = useT()

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column',
      background: '#F8F7FF',
      zIndex: 100,
    }}>
      {/* Header — same shape as PrivacyPolicyPage so the two public pages match */}
      <div style={{
        background: 'linear-gradient(135deg, #951345 0%, #720D35 100%)',
        padding: '16px 16px 20px',
        flexShrink: 0,
        boxShadow: '0 2px 12px rgba(149,19,69,0.25)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Goes to the app root rather than back: this page is usually opened
              from a store listing or an email, where there is no history. */}
          <button onClick={() => navigate('/')} aria-label={t('deletePage.backToApp')} style={{
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: 10, width: 36, height: 36,
            cursor: 'pointer', fontSize: 18, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, fontFamily: 'inherit',
          }}>←</button>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 18, fontWeight: 900, color: '#fff',
              fontFamily: 'Sora, sans-serif', lineHeight: 1.35,
            }}>
              {t('deletePage.title')}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2, lineHeight: 1.5 }}>
              {t('deletePage.sub')}
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 16px 40px' }}>

        {/* Warning — deletion is irreversible, said before the how-to */}
        <div style={{
          background: '#FEF2F2', border: '1.5px solid #FCA5A5',
          borderRadius: 16, padding: '14px 16px', marginBottom: 14,
          display: 'flex', gap: 12, alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 22, flexShrink: 0, lineHeight: 1.2 }}>⚠️</span>
          <div style={{ fontSize: 13.5, color: '#7F1D1D', lineHeight: 1.6, fontWeight: 600 }}>
            {t('deletePage.cannotUndo')}
          </div>
        </div>

        <Card title={t('deletePage.optionInApp')}>
          {t('deletePage.optionInAppBody')}
        </Card>

        <Card title={t('deletePage.optionEmail')}>
          {t('deletePage.optionEmailBody', { email: CONTACT_EMAIL })}
          <div style={{ marginTop: 10 }}>
            <a href={`mailto:${CONTACT_EMAIL}?subject=Delete my Famora account`} style={{
              display: 'inline-block', background: 'var(--blue-light, #F1EEFF)',
              border: '1.5px solid #E8DFFF', borderRadius: 10,
              padding: '8px 14px', color: '#951345', fontWeight: 700,
              fontSize: 13, textDecoration: 'none',
            }}>
              ✉️ {CONTACT_EMAIL}
            </a>
          </div>
        </Card>

        <Card title={t('deletePage.whatGoes')}>
          {t('deletePage.whatGoesBody')}
        </Card>

        <Card title={t('deletePage.whatStays')}>
          {t('deletePage.whatStaysBody')}
        </Card>

        <button onClick={() => navigate('/')} style={{
          width: '100%', padding: 14, borderRadius: 14, marginTop: 4,
          background: 'linear-gradient(135deg,#951345,#720D35)', border: 'none',
          color: '#fff', fontWeight: 700, fontSize: 14.5,
          fontFamily: 'inherit', cursor: 'pointer',
        }}>
          {t('deletePage.backToApp')}
        </button>
      </div>
    </div>
  )
}
