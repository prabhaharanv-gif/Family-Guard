import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { useAuthStore } from '../store/authStore'
import { useLocations } from '../hooks/useLocations'
import { supabase } from '../lib/supabase'

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

function FitAll({ locations }) {
  const map = useMap()
  useEffect(() => {
    const coords = Object.values(locations).map(l => [l.lat, l.lng])
    if (coords.length === 1) map.setView(coords[0], 15)
    else if (coords.length > 1) map.fitBounds(coords, { padding: [60, 60] })
  }, [locations])
  return null
}

export default function MapAllPage() {
  const { user, familyId } = useAuthStore()
  const { locations } = useLocations(familyId)
  const watchRef = useRef(null)

  // Share own location
  useEffect(() => {
    if (!user || !familyId) return
    const update = async (pos) => {
      await supabase.from('locations').upsert({
        user_id: user.id, family_id: familyId,
        lat: pos.coords.latitude, lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        is_sharing: true, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
    }
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(update)
      watchRef.current = navigator.geolocation.watchPosition(update, null, { enableHighAccuracy: true })
    }
    return () => { if (watchRef.current) navigator.geolocation.clearWatch(watchRef.current) }
  }, [user, familyId])

  const memberCount = Object.keys(locations).length

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Top Bar */}
      <div className="top-bar" style={{ flexShrink: 0 }}>
        <div>
          <div className="top-bar-title">🗺️ Family Map</div>
          <div className="top-bar-sub">{memberCount} member{memberCount !== 1 ? 's' : ''} sharing location</div>
        </div>
      </div>

      {/* Map */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <MapContainer
          center={[11.0168, 76.9558]}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <FitAll locations={locations} />

          {Object.entries(locations).map(([uid, loc]) => (
            <Marker
              key={uid}
              position={[loc.lat, loc.lng]}
              icon={createIcon(loc.avatarColor || '#4F8EF7', loc.displayName?.[0]?.toUpperCase() || '?')}
            >
              <Popup>
                <div style={{ textAlign: 'center', minWidth: 140 }}>
                  <strong>{loc.displayName}</strong><br />
                  <small style={{ color: '#888' }}>
                    Last seen: {new Date(loc.updatedAt).toLocaleTimeString()}
                  </small>
                  <br /><br />
                  <a
                    href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{
                      display: 'inline-block', background: '#4F8EF7',
                      color: '#fff', padding: '6px 14px', borderRadius: 8,
                      fontWeight: 700, fontSize: 13, textDecoration: 'none',
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
    </div>
  )
}
