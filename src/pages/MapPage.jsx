import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useAuthStore } from '../store/authStore'
import { useLocations } from '../hooks/useLocations'
import { supabase } from '../lib/supabase'
import SmoothMarker from '../components/SmoothMarker'
import { useT } from '../i18n'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

function createIcon(color, initial) {
  return L.divIcon({
    className: '',
    html: `<div style="
      width:44px;height:44px;border-radius:50%;
      background:${color};border:3px solid #fff;
      display:flex;align-items:center;justify-content:center;
      font-weight:800;font-size:18px;color:#fff;
      box-shadow:0 2px 12px rgba(0,0,0,0.25);
      font-family:Inter,sans-serif;
    ">${initial}</div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
  })
}

function FollowTarget({ lat, lng, following, onUserTakeover }) {
  const map = useMap()
  const centred = useRef(false)

  // First fix: centre once when their location appears, as before.
  useEffect(() => {
    if (centred.current) return
    if (lat && lng) {
      centred.current = true
      map.flyTo([lat, lng], 16, { animate: true, duration: 1.2 })
    }
  }, [lat, lng, map])

  // A drag is unambiguously the user taking over the viewport. Leaflet's own
  // flyTo/panTo never fire dragstart, so our animations cannot trip this.
  useEffect(() => {
    const stop = () => onUserTakeover()
    map.on('dragstart', stop)
    return () => { map.off('dragstart', stop) }
  }, [map, onUserTakeover])

  // Follow, but only once the marker approaches an edge. Re-centring on every
  // GPS update is what the previous once-only version was avoiding: a phone
  // sitting still wanders a few metres and the viewport would twitch
  // continuously. Panning at the 25% margin keeps a moving member on screen
  // without chasing noise, and panTo keeps the zoom the user chose.
  useEffect(() => {
    if (!following || !centred.current) return
    if (!lat || !lng) return
    const p    = map.latLngToContainerPoint([lat, lng])
    const size = map.getSize()
    const marginX = size.x * 0.25
    const marginY = size.y * 0.25
    const nearEdge =
      p.x < marginX || p.x > size.x - marginX ||
      p.y < marginY || p.y > size.y - marginY
    if (nearEdge) map.panTo([lat, lng], { animate: true, duration: 0.8 })
  }, [lat, lng, following, map])

  return null
}

export default function MapPage() {
  const { userId: targetUserId } = useParams()
  const navigate = useNavigate()
  const { user, familyId } = useAuthStore()
  const { locations } = useLocations(familyId)
  const [member, setMember] = useState(null)
  const t = useT()
  // Follow is on until the user drags the map away; then it stays off until
  // they ask for it back, so panning to look at something is never fought.
  const [following, setFollowing] = useState(true)
  const stopFollowing = useCallback(() => setFollowing(false), [])

  useEffect(() => {
    if (!targetUserId || !familyId) return
    supabase.from('family_members').select('*')
      .eq('user_id', targetUserId).eq('family_id', familyId).single()
      .then(({ data }) => { if (data) setMember(data) })
  }, [targetUserId, familyId])
  // NOTE: own location is handled globally by useLocationBroadcast in App.jsx —
  // no duplicate writer needed here.

  const targetLoc = targetUserId ? locations[targetUserId] : null

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* MAP */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        <MapContainer
          center={[11.0168, 76.9558]}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {targetLoc && (
            <FollowTarget
              lat={targetLoc.lat}
              lng={targetLoc.lng}
              following={following}
              onUserTakeover={stopFollowing}
            />
          )}

          {/* Target member marker */}
          {targetLoc && (
            <SmoothMarker
              position={[targetLoc.lat, targetLoc.lng]}
              icon={createIcon(member?.avatar_color || '#4F8EF7', member?.display_name?.[0] || '?')}
            >
              <div style={{ minWidth: 160, fontFamily: 'Inter, sans-serif', padding: '2px 0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                      background: member?.avatar_color || '#951345',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#fff', fontWeight: 800, fontSize: 15, border: '2px solid #951345',
                    }}>
                      {member?.display_name?.[0]?.toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 14, color: '#0D0C1D' }}>{member?.display_name}</div>
                      <div style={{ fontSize: 11, color: '#9C6B7A', marginTop: 1 }}>
                        🕐 {new Date(targetLoc.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                  <a href={`https://www.google.com/maps?q=${targetLoc.lat},${targetLoc.lng}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      background: 'linear-gradient(135deg, #951345, #720D35)',
                      color: '#fff', padding: '8px 14px', borderRadius: 10,
                      fontWeight: 700, fontSize: 12, textDecoration: 'none',
                      boxShadow: '0 3px 10px rgba(149,19,69,0.3)',
                    }}>🗺️ Open in Google Maps</a>
                </div>
            </SmoothMarker>
          )}

          {/* Other family members */}
          {Object.entries(locations)
            .filter(([uid]) => uid !== targetUserId)
            .map(([uid, loc]) => (
              <SmoothMarker key={uid} position={[loc.lat, loc.lng]}
                icon={createIcon(loc.avatarColor || '#ccc', loc.displayName?.[0] || '?')}>
                <div style={{ minWidth: 160, fontFamily: 'Inter, sans-serif', padding: '2px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                        background: loc.avatarColor || '#4F8EF7',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontWeight: 800, fontSize: 15, border: '2px solid #4F8EF7',
                      }}>
                        {loc.displayName?.[0]?.toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 14, color: '#0D0C1D' }}>{loc.displayName}</div>
                        <div style={{ fontSize: 11, color: '#9C6B7A', marginTop: 1 }}>
                          🕐 {new Date(loc.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                    <a href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`}
                      target="_blank" rel="noopener noreferrer"
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
                        color: '#fff', padding: '8px 14px', borderRadius: 10,
                        fontWeight: 700, fontSize: 12, textDecoration: 'none',
                        boxShadow: '0 3px 10px rgba(79,70,229,0.3)',
                      }}>🗺️ Open in Google Maps</a>
                  </div>
              </SmoothMarker>
            ))}
        </MapContainer>

        {/* Only shown once the user has taken the viewport over, so it never
            competes for attention while the map is already following. */}
        {targetLoc && !following && (
          <button
            onClick={() => setFollowing(true)}
            style={{
              position: 'absolute', right: 14, bottom: 18, zIndex: 1000,
              display: 'flex', alignItems: 'center', gap: 7,
              background: 'linear-gradient(135deg,#951345,#720D35)',
              border: 'none', borderRadius: 999, padding: '10px 16px',
              color: '#fff', fontWeight: 700, fontSize: 13,
              fontFamily: 'inherit', cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(149,19,69,0.4)',
            }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
            {t('map.recenter')}
          </button>
        )}
      </div>

      {/* Bottom info bar */}
      <div style={{
        background: '#fff', padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: 12,
        borderTop: '1px solid #E4EAF8', flexShrink: 0,
      }}>
        <button onClick={() => navigate(-1)} style={{
          width: 38, height: 38, borderRadius: '50%',
          border: 'none', background: '#F0F4FF',
          fontSize: 18, cursor: 'pointer', flexShrink: 0,
        }}>←</button>

        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: member?.avatar_color || '#4F8EF7',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 800, fontSize: 16, flexShrink: 0,
        }}>
          {member?.display_name?.[0]?.toUpperCase()}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{member?.display_name || 'Loading...'}</div>
          <div style={{ fontSize: 12, color: '#8892A4', marginTop: 2 }}>
            {targetLoc
              ? `📍 Updated ${new Date(targetLoc.updatedAt).toLocaleTimeString()}`
              : '⚠️ Location not shared yet — allow location access'}
          </div>
        </div>
      </div>
    </div>
  )
}
