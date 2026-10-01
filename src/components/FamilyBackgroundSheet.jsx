import { useState } from 'react'
import { useT } from '../i18n'
import { useBackButton } from '../hooks/useBackButton'
import { useFamilyBackground } from '../hooks/useFamilyBackground'
import { MEMBER_TYPES, SCENES, MAX_MEMBERS, cleanAge, cleanMembers } from '../lib/familyBackground'
import FamilyScene from './FamilyScene'

/**
 * FamilyBackgroundSheet
 *
 * Where a family admin says who is in the family (a type and an age for each person)
 * and picks a scene. The picture above updates as they go, so they see the family before
 * saving. Saving changes only the picture; nothing about the real members or their
 * accounts is touched.
 */
export default function FamilyBackgroundSheet({ familyId, onClose }) {
  const t = useT()
  useBackButton(true, onClose)
  const { background, save } = useFamilyBackground(familyId)

  const [members, setMembers] = useState(() => (background?.members || []).map(m => ({ type: m.type, age: m.age == null ? '' : String(m.age) })))
  const [scene, setScene] = useState(background?.scene || SCENES[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const people = members.map(m => ({ type: m.type, age: cleanAge(m.age) }))
  const label = { fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: 0.3, margin: '16px 2px 7px', textTransform: 'uppercase' }
  const chip = (on) => ({
    fontSize: 12.5, fontWeight: 700, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', fontFamily: 'inherit',
    border: '1.5px solid var(--maroon)', background: on ? 'var(--maroon)' : '#fff', color: on ? '#fff' : 'var(--maroon)',
  })

  const add = (type) => { if (members.length < MAX_MEMBERS) { setMembers([...members, { type, age: '' }]); setError(null) } }
  const setAge = (i, v) => setMembers(members.map((m, k) => (k === i ? { ...m, age: v.replace(/\D/g, '').slice(0, 2) } : m)))
  const remove = (i) => setMembers(members.filter((_, k) => k !== i))

  const run = async (value) => {
    setBusy(true); setError(null)
    try { await save(value); onClose() }
    catch (e) { setError(e.code === 'notReady' ? t('familyBg.notReady') : t('familyBg.failed')); setBusy(false) }
  }
  const submit = () => {
    const clean = cleanMembers(people)
    if (!clean.length) { setError(t('familyBg.needOne')); return }
    run({ scene, members: clean })
  }

  return (
    <div className="overlay" onClick={busy ? undefined : onClose}>
      <div className="popup" onClick={e => e.stopPropagation()}
        style={{ background: '#FFF8F0', padding: '4px 16px max(26px, calc(18px + env(safe-area-inset-bottom, 0px)))', maxHeight: '92vh', overflowY: 'auto' }}>
        <div className="popup-handle" style={{ margin: '9px auto 12px' }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text)' }}>{t('familyBg.chooseTitle')}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600, marginTop: 3, lineHeight: 1.4 }}>{t('familyBg.intro')}</div>
          </div>
          <button onClick={onClose} aria-label={t('common.close')} style={{
            width: 34, height: 34, borderRadius: '50%', border: '1px solid var(--border)', background: '#fff',
            color: 'var(--muted)', fontSize: 20, lineHeight: '32px', padding: 0, cursor: 'pointer', flexShrink: 0, fontFamily: 'inherit',
          }}>×</button>
        </div>

        {/* The picture, as the Family page will show it. */}
        <div style={{ marginTop: 12, border: '1.5px solid var(--maroon)', borderRadius: 16, overflow: 'hidden', background: '#FFF3E6' }}>
          <FamilyScene members={people} scene={scene} />
        </div>

        <div style={label}>{t('familyBg.who')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {MEMBER_TYPES.map(type => (
            <button key={type} onClick={() => add(type)} disabled={members.length >= MAX_MEMBERS} style={chip(false)}>+ {t('familyBg.' + type)}</button>
          ))}
        </div>

        {members.length > 0 && (
          <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
            {members.map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1.5px solid var(--maroon)', borderRadius: 12, padding: '6px 8px 6px 12px' }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{t('familyBg.' + m.type)}</div>
                <input className="input" inputMode="numeric" value={m.age} onChange={e => setAge(i, e.target.value)}
                  placeholder={t('familyBg.age')} aria-label={t('familyBg.age')}
                  style={{ width: 74, padding: '6px 10px', fontSize: 14, textAlign: 'center' }} />
                <button onClick={() => remove(i)} aria-label={t('common.close')} style={{
                  width: 30, height: 30, border: 'none', background: 'transparent', color: 'var(--maroon)', cursor: 'pointer', padding: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </div>
            ))}
            <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, margin: '0 2px' }}>{t('familyBg.ageHint')}</div>
          </div>
        )}

        <div style={label}>{t('familyBg.scene')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {SCENES.map(s => (
            <button key={s} onClick={() => setScene(s)} aria-pressed={s === scene} style={chip(s === scene)}>{t('familyBg.' + s)}</button>
          ))}
        </div>

        <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, margin: '16px 2px 0', lineHeight: 1.4 }}>{t('familyBg.privacy')}</div>
        {error && <div role="alert" style={{ fontSize: 12.5, color: '#B42318', fontWeight: 700, margin: '10px 2px 0' }}>{error}</div>}

        <button onClick={submit} disabled={busy} style={{
          width: '100%', marginTop: 14, height: 46, borderRadius: 999, border: 'none', cursor: busy ? 'default' : 'pointer',
          background: 'linear-gradient(135deg, var(--maroon), var(--maroon-deep))', color: '#fff', fontWeight: 800, fontSize: 14.5, fontFamily: 'inherit',
          opacity: busy ? 0.7 : 1,
        }}>{busy ? t('familyBg.saving') : t('familyBg.use')}</button>
        {background && (
          <button onClick={() => run(null)} disabled={busy} style={{
            width: '100%', marginTop: 6, height: 40, border: 'none', background: 'transparent', color: 'var(--maroon)',
            fontWeight: 700, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
          }}>{t('familyBg.remove')}</button>
        )}
      </div>
    </div>
  )
}
