import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useLocations } from '../hooks/useLocations'

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

function FlyTo({ lat, lng }) {
  const map = useMap()
  useEffect(() => {
    if (lat && lng) map.flyTo([lat, lng], 16, { animate: true, duration: 1.2 })
  }, [lat, lng])
  return null
}

export default function MapPage() {
  const { userId: targetUserId } = useParams()
  const navigate = useNavigate()
  const { user, familyId } = useAuthStore()
  const { locations } = useLocations(familyId)
  const [member, setMember] = useState(null)
  const watchRef = useRef(null)

  useEffect(() => {
    if (!targetUserId || !familyId) return
    supabase.from('family_members').select('*')
      .eq('user_id', targetUserId).eq('family_id', familyId).single()
      .then(({ data }) => { if (data) setMember(data) })
  }, [targetUserId, familyId])

  // Share own location continuously
  useEffect(() => {
    if (!user || !familyId) return
    const update = async (pos) => {
      await supabase.from('locations').upsert({
        user_id: user.id, family_id: familyId,
        lat: pos.coords.latitude, lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        is_sharing: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
    }
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(update)
      watchRef.current = navigator.geolocation.watchPosition(update, null, { enableHighAccuracy: true })
    }
    return () => { if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current) }
  }, [user, familyId])

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

          {targetLoc && <FlyTo lat={targetLoc.lat} lng={targetLoc.lng} />}

          {/* Target member marker */}
          {targetLoc && (
            <Marker
              position={[targetLoc.lat, targetLoc.lng]}
              icon={createIcon(member?.avatar_color || '#4F8EF7', member?.display_name?.[0] || '?')}
            >
              <Popup>
                <div style={{ textAlign: 'center', minWidth: 140 }}>
                  <strong>{member?.display_name}</strong><br />
                  <small style={{ color: '#888' }}>
                    Last seen: {new Date(targetLoc.updatedAt).toLocaleTimeString()}
                  </small>
                  <br /><br />
                  <a
                    href={`https://www.google.com/maps?q=${targetLoc.lat},${targetLoc.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'inline-block',
                      background: '#4F8EF7',
                      color: '#fff',
                      padding: '6px 14px',
                      borderRadius: 8,
                      fontWeight: 700,
                      fontSize: 13,
                      textDecoration: 'none',
                    }}
                  >
                    Open in Google Maps 🗺️
                  </a>
                </div>
              </Popup>
            </Marker>
          )}

          {/* Other family members */}
          {Object.entries(locations)
            .filter(([uid]) => uid !== targetUserId)
            .map(([uid, loc]) => (
              <Marker key={uid} position={[loc.lat, loc.lng]}
                icon={createIcon(loc.avatarColor || '#ccc', loc.displayName?.[0] || '?')}>
                <Popup>
                  <div style={{ textAlign: 'center', minWidth: 140 }}>
                    <strong>{loc.displayName}</strong><br />
                    <small style={{ color: '#888' }}>
                      Last seen: {new Date(loc.updatedAt).toLocaleTimeString()}
                    </small>
                    <br /><br />
                    <a
                      href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: 'inline-block',
                        background: '#4F8EF7',
                        color: '#fff',
                        padding: '6px 14px',
                        borderRadius: 8,
                        fontWeight: 700,
                        fontSize: 13,
                        textDecoration: 'none',
                      }}
                    >
                      Open in Google Maps 🗺️
                    </a>
                  </div>
                </Popup>
              </Marker>
            ))}
        </MapContainer>
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
