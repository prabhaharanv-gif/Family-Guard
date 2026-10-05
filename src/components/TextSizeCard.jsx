import { useState, useEffect } from 'react'
import { TEXT_SIZES, getTextSize, setTextSize, isTextSizeAvailable } from '../lib/textSize'
import { useT } from '../i18n'

/**
 * Profile -> Settings -> Text size.
 *
 * Makes Kinest's text smaller or larger on its own. Useful when the phone's
 * system font is big enough that words wrap and the cards feel cramped: the
 * person can bring Kinest down without shrinking everything else on the phone.
 * Android only.
 *
 * Collapsed like Alert Sounds beside it: the row says which size is in use, and
 * the choices open when it is tapped.
 */
const LABEL_KEY = {
  small:  'profile.textSizeSmall',
  normal: 'profile.textSizeNormal',
  large:  'profile.textSizeLarge',
}

export default function TextSizeCard() {
  const t = useT()
  const [level, setLevel] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!isTextSizeAvailable()) return
    getTextSize().then(setLevel)
  }, [])

  if (!level) return null

  const choose = async (id) => {
    setLevel(id)                       // the buttons respond at once
    setLevel(await setTextSize(id))    // then settle on what actually took effect
  }

  return (
    <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          width: '100%', background: 'none', border: 'none', padding: 0,
          cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
          display: 'flex', alignItems: 'center', gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--maroon)', letterSpacing: 0.2 }}>
            {t('profile.textSize')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
            {open ? t('profile.textSizeSub') : t(LABEL_KEY[level])}
          </div>
        </div>
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="#C9A3B4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{
            flexShrink: 0,
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 0.18s',
          }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {open && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {TEXT_SIZES.map(s => {
            const on = s.id === level
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => choose(s.id)}
                aria-pressed={on}
                style={{
                  flex: '1 1 auto', minWidth: 0,
                  padding: '9px 12px', borderRadius: 10, cursor: 'pointer',
                  fontFamily: 'inherit', fontWeight: 800, fontSize: 13, lineHeight: 1.3,
                  background: on ? 'var(--maroon)' : '#fff',
                  color: on ? '#fff' : 'var(--maroon)',
                  border: '1.5px solid var(--maroon)',
                }}
              >
                {t(LABEL_KEY[s.id])}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
