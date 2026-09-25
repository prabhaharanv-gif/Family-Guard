import { useState, useEffect } from 'react'
import { listMyPlaces, saveCurrentLocationAsPlace, renamePlace, deletePlace } from '../lib/places'
import { useT } from '../i18n'
import Icon from './Icon'
import Dialog from './Dialog'

/**
 * Profile → Places. Home, Office, ... — saved by standing there and tapping
 * "Save current location", not by dropping a pin on a map. Each is private to
 * this member (RLS is owner-only); the family only ever sees the arrival/
 * departure event, never the coordinates.
 *
 * Collapsed by default, same as Fake Call / SOS Tile. Renaming is inline
 * (tap the name, it becomes an input, blur or Enter saves) rather than a
 * separate modal — there is no explicit Save button anywhere else in this
 * settings screen either.
 */
export default function PlacesCard() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [places, setPlaces] = useState(null)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [dialog, setDialog] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [editingName, setEditingName] = useState('')

  useEffect(() => {
    if (open && places === null) listMyPlaces().then(setPlaces)
  }, [open, places])

  const handleSave = async () => {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    const res = await saveCurrentLocationAsPlace(name)
    setSaving(false)
    if (!res.ok) {
      setDialog({
        type: 'error',
        message: t(res.error === 'no-fix' ? 'places.noFix' : 'places.saveFailed'),
      })
      return
    }
    setNewName('')
    setPlaces(await listMyPlaces())
  }

  const startRename = (place) => { setEditingId(place.id); setEditingName(place.name) }

  const commitRename = async () => {
    const id = editingId
    const name = editingName.trim()
    setEditingId(null)
    if (!id || !name) return
    const ok = await renamePlace(id, name)
    if (ok) setPlaces(await listMyPlaces())
  }

  const handleDelete = (place) => {
    setDialog({
      type: 'confirm',
      title: t('places.deletePlace'),
      message: t('places.deleteConfirm', { name: place.name }),
      confirmLabel: t('common.remove'),
      onConfirm: async () => {
        const ok = await deletePlace(place.id)
        if (ok) setPlaces(prev => (prev || []).filter(p => p.id !== place.id))
      },
    })
  }

  return (
    <div className="settings-card" style={{ marginBottom: 10, padding: '14px 16px' }}>
      <button
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
            {t('places.title')}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
            {t('places.subtitle')}
          </div>
        </div>
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="#C9A3B4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.18s' }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>

      {open && (
        <div style={{ marginTop: 14 }}>
          {places && places.length === 0 && (
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>
              {t('places.empty')}
            </div>
          )}

          {places && places.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {places.map((p, i) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
                    borderTop: i > 0 ? '1px solid #F5EEF2' : 'none',
                  }}
                >
                  <Icon name="pin" size={16} color="var(--maroon)" style={{ flexShrink: 0 }} />
                  {editingId === p.id ? (
                    <input
                      className="input"
                      autoFocus
                      value={editingName}
                      maxLength={60}
                      onChange={e => setEditingName(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                      style={{ flex: 1, minWidth: 0, padding: '4px 8px', fontSize: 14 }}
                    />
                  ) : (
                    <button
                      onClick={() => startRename(p)}
                      aria-label={t('places.rename')}
                      style={{
                        flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none',
                        padding: 0, cursor: 'pointer', fontFamily: 'inherit',
                        fontSize: 14, fontWeight: 700, color: 'var(--text)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {p.name}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(p)}
                    aria-label={t('common.remove')}
                    style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', flexShrink: 0 }}
                  >
                    <Icon name="trash" size={16} color="var(--muted)" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="input"
              value={newName}
              maxLength={60}
              placeholder={t('places.namePlaceholder')}
              aria-label={t('places.namePlaceholder')}
              onChange={e => setNewName(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button
              onClick={handleSave}
              disabled={saving || !newName.trim()}
              style={{
                background: 'var(--maroon-wash)', border: '1.5px solid #F0D8E3', color: 'var(--maroon)',
                borderRadius: 10, padding: '10px 14px', fontWeight: 800, fontSize: 13, fontFamily: 'inherit',
                cursor: saving || !newName.trim() ? 'default' : 'pointer',
                opacity: saving || !newName.trim() ? 0.6 : 1, flexShrink: 0, whiteSpace: 'nowrap',
              }}
            >
              {saving ? t('places.saving') : t('places.saveHere')}
            </button>
          </div>
        </div>
      )}

      {dialog && <Dialog {...dialog} onClose={() => setDialog(null)} />}
    </div>
  )
}
