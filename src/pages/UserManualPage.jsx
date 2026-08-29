import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { MANUAL, LANGUAGES, SECTION_META } from '../i18n/manual'

/**
 * UserManualPage
 *
 * In-app guide to every feature, in six languages. Follows the
 * PrivacyPolicyPage pattern — a full-screen page outside the tab Layout,
 * reached from Settings and Profile.
 *
 * Sections are collapsible and start with only the first open. A manual
 * covering the whole app is long, and an unbroken wall of text is one people
 * scroll past rather than read; collapsed headings let someone find the one
 * feature they came for.
 */

const LANG_KEY = 'famora_manual_lang'

function Section({ meta, content, topicsLabel, open, onToggle }) {
  return (
    <div style={{
      background: '#fff',
      borderRadius: 18,
      marginBottom: 12,
      border: '1px solid #F0EAF5',
      boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
      overflow: 'hidden',
    }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: '100%', padding: '16px 18px',
          background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: 'inherit', textAlign: 'left',
          display: 'flex', alignItems: 'center', gap: 10,
        }}
      >
        <div style={{
          width: 34, height: 34, borderRadius: 10, flexShrink: 0,
          background: `${meta.color}18`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 17,
        }}>{meta.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* line-height 1.4 rather than 1: Indic scripts stack marks above and
              below the base character and get clipped at tighter leading. */}
          <div style={{
            fontSize: 15, fontWeight: 800, color: '#0D0C1D',
            fontFamily: 'Sora, sans-serif', lineHeight: 1.4,
          }}>
            {content.title}
          </div>
          <div style={{ fontSize: 11, color: '#9C6B7A', marginTop: 2, lineHeight: 1.5 }}>
            {topicsLabel}
          </div>
        </div>
        <span style={{
          color: meta.color, fontSize: 13, fontWeight: 900, flexShrink: 0,
          transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s',
        }}>›</span>
      </button>

      {open && (
        <div style={{ padding: '0 18px 16px' }}>
          <div style={{
            fontSize: 12.5, color: '#5B4652', lineHeight: 1.75,
            paddingBottom: 12, marginBottom: 4,
            borderBottom: '1px solid #F5EEF2',
          }}>
            {content.intro}
          </div>
          {content.steps.map(([label, body], i) => (
            <div key={label} style={{ display: 'flex', gap: 10, paddingTop: 12 }}>
              <div style={{
                width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 3,
                background: meta.color, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 900,
              }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, color: '#0D0C1D', marginBottom: 3, lineHeight: 1.5 }}>
                  {label}
                </div>
                <div style={{ fontSize: 12.5, color: '#5B4652', lineHeight: 1.75 }}>
                  {body}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function UserManualPage() {
  const navigate = useNavigate()
  const [lang, setLang] = useState(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY)
      if (saved && MANUAL[saved]) return saved
    } catch (e) {}
    return 'en'
  })
  // First section open so the page does not read as an empty list of headings.
  const [openIdx, setOpenIdx] = useState(0)

  useEffect(() => {
    try { localStorage.setItem(LANG_KEY, lang) } catch (e) {}
  }, [lang])

  // Fall back to English per-field rather than per-page, so a partially
  // translated language still shows everything it does have.
  const t  = MANUAL[lang] || MANUAL.en
  const en = MANUAL.en

  return (
    <div style={{
      position: 'fixed', inset: 0,
      display: 'flex', flexDirection: 'column',
      background: '#F8F7FF',
      zIndex: 100,
    }}>
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #951345 0%, #720D35 100%)',
        padding: '16px 16px 14px',
        flexShrink: 0,
        boxShadow: '0 2px 12px rgba(149,19,69,0.25)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate(-1)} style={{
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: 10, width: 36, height: 36,
            cursor: 'pointer', fontSize: 18, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>←</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#fff', fontFamily: 'Sora, sans-serif', lineHeight: 1.35 }}>
              {t.title}
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', marginTop: 2, lineHeight: 1.5 }}>
              {t.subtitle}
            </div>
          </div>
        </div>

        {/* Language picker — horizontally scrollable so six options fit any
            screen width without wrapping into the header. */}
        <div style={{
          display: 'flex', gap: 7, marginTop: 12,
          overflowX: 'auto', paddingBottom: 2,
          scrollbarWidth: 'none',
        }}>
          {LANGUAGES.map((l) => {
            const active = l.code === lang
            return (
              <button
                key={l.code}
                onClick={() => setLang(l.code)}
                style={{
                  flexShrink: 0,
                  padding: '7px 13px', borderRadius: 999,
                  background: active ? '#fff' : 'rgba(255,255,255,0.14)',
                  border: `1px solid ${active ? '#fff' : 'rgba(255,255,255,0.28)'}`,
                  color: active ? '#951345' : 'rgba(255,255,255,0.92)',
                  fontWeight: active ? 800 : 600,
                  fontSize: 12.5, cursor: 'pointer', fontFamily: 'inherit',
                  whiteSpace: 'nowrap', lineHeight: 1.6,
                }}
              >
                {l.native}
              </button>
            )
          })}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 16px 40px' }}>

        <div style={{
          background: 'linear-gradient(135deg, #FDF0F5, #F0EEFF)',
          borderRadius: 18, padding: '18px 20px', marginBottom: 14,
          border: '1.5px solid #E8DFFF',
          boxShadow: '0 2px 12px rgba(149,19,69,0.08)',
        }}>
          <div style={{ fontSize: 22, marginBottom: 8 }}>📖</div>
          <div style={{ fontSize: 14, color: '#3A1020', lineHeight: 1.75, fontWeight: 500 }}>
            {t.introLead}{' '}
            <strong style={{ color: '#951345' }}>{t.introStrong}</strong>
            {' '}{t.introTail}
          </div>
        </div>

        {SECTION_META.map((meta, i) => {
          const content = t.sections?.[meta.key] || en.sections[meta.key]
          const topics  = (t.topics || en.topics)(content.steps.length)
          return (
            <Section
              key={meta.key}
              meta={meta}
              content={content}
              topicsLabel={topics}
              open={openIdx === i}
              onToggle={() => setOpenIdx(openIdx === i ? -1 : i)}
            />
          )
        })}

        <div style={{
          textAlign: 'center', fontSize: 11, color: '#9C6B7A',
          padding: '18px 10px 0', lineHeight: 1.8,
        }}>
          {t.footer}
        </div>
      </div>
    </div>
  )
}
