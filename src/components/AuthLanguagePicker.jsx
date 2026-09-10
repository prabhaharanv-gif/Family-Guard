import { useState, useRef, useEffect } from 'react'
import { useT, useLangStore, UI_LANGUAGES } from '../i18n'

/**
 * AuthLanguagePicker — the language control on the signed-out screens.
 *
 * It exists because the other one cannot be reached. Profile's picker is behind
 * PrivateRoute, and so is onboarding, so the only screen a new install can show
 * is the login page. Since the app now opens in English regardless of what the
 * phone is set to (see initialLang), somebody whose phone is in Tamil otherwise
 * has to read an English form, pass an OTP and set a password before reaching
 * the control that would have made any of it readable.
 *
 * Every option is written in its OWN script, never translated. Someone hunting
 * for their language cannot, by definition, read the language currently on
 * screen — "Tamil" is no use to a person looking for தமிழ். For the same reason
 * the closed button shows the current language's own name beside a globe rather
 * than a word like "Language".
 *
 * The choice writes straight through to the same store Profile uses, which is
 * localStorage-backed and needs no session, so it survives registration and is
 * still in force after the first sign-in.
 */
export default function AuthLanguagePicker() {
  const t = useT()
  const setLang = useLangStore(s => s.setLang)
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

  // Tap anywhere else to close. Pointerdown rather than click so it closes on
  // the press that starts an interaction with the form underneath, instead of
  // swallowing that first tap.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const current = UI_LANGUAGES.find(l => l.code === t.lang) || UI_LANGUAGES[0]

  return (
    <div ref={boxRef} style={{ position: 'absolute', top: 14, right: 14, zIndex: 50 }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('settings.language')}
        style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '9px 14px', borderRadius: 999,
          // White fill, maroon text — the only combination that is obvious on
          // both surfaces this can land on.
          //
          // It was translucent white first, which vanished where the centred
          // auth card reaches the top of a short screen and the pill sits on
          // its white corner. Fixing that with a maroon fill traded one
          // invisibility for a worse one: maroon on the maroon page background,
          // which is where it sits on nearly every phone. White reads against
          // the page; the maroon-tinted border and shadow keep its edge when it
          // happens to overlap the card.
          background: '#FFFFFF',
          border: '1.5px solid rgba(139,13,61,0.22)',
          boxShadow: '0 4px 14px rgba(42,10,24,0.30)',
          color: '#8B0D3D', fontFamily: 'inherit', fontSize: 13.5, fontWeight: 800,
          cursor: 'pointer', lineHeight: 1.6,
        }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
        </svg>
        {current.native}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
             style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            background: '#fff', borderRadius: 14, overflow: 'hidden',
            border: '1px solid #ECE0E5',
            boxShadow: '0 12px 34px rgba(42,10,24,0.30)',
            minWidth: 150,
          }}
        >
          {UI_LANGUAGES.map((l, i) => {
            const active = l.code === t.lang
            return (
              <button
                key={l.code}
                role="option"
                aria-selected={active}
                onClick={() => { setLang(l.code); setOpen(false) }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '11px 16px',
                  borderTop: i === 0 ? 'none' : '1px solid #F3E9ED',
                  background: active ? '#F8F0F3' : '#fff',
                  border: 'none',
                  color: active ? '#8B0D3D' : '#3B2430',
                  fontWeight: active ? 800 : 600,
                  fontSize: 14.5, fontFamily: 'inherit', cursor: 'pointer',
                  // Indic scripts need the headroom; at a tighter line-height
                  // the vowel marks above and below the line get clipped.
                  lineHeight: 1.7,
                }}
              >
                {l.native}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
