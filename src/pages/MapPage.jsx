import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Geolocation } from '@capacitor/geolocation'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useLocations } from '../hooks/useLocations'
import SmoothMarker from '../components/SmoothMarker'

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
  const hasFlown = useRef(false)
  useEffect(() => {
    // Center on the member once when their location first appears. After that,
    // let the SmoothMarker glide handle movement so the map doesn't keep
    // yanking the viewport on every GPS update.
    if (hasFlown.current) return
    if (lat && lng) {
      hasFlown.current = true
      map.flyTo([lat, lng], 16, { animate: true, duration: 1.2 })
    }
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

  // Share own location using Capacitor (native GPS) — same as MapAllPage
  useEffect(() => {
    if (!user || !familyId) return

    const update = async (lat, lng, accuracy) => {
      const now = new Date().toISOString()
      // FIX: onConflict must include family_id so multi-family users
      // upsert into the correct row (was 'user_id' only — wrong).
      await supabase.from('locations').upsert({
        user_id: user.id, family_id: familyId,
        lat, lng, accuracy: accuracy || 0,
        is_sharing: true, updated_at: now,
      }, { onConflict: 'user_id,family_id' })
      await supabase.from('family_members')
        .update({ last_active: now })
        .eq('user_id', user.id)
        .eq('family_id', familyId)
    }

    // FIX: Use Capacitor Geolocation (native GPS) instead of navigator.geolocation
    // (browser API). On Android WebView, navigator.geolocation falls back to
    // network/IP location which can be several km off. Capacitor calls the
    // native Android GPS API directly — same source WhatsApp uses.
    const startTracking = async () => {
      try {
        const perm = await Geolocation.requestPermissions()
        if (perm.location !== 'granted') return

        // Get an immediate fix
        const pos = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true, timeout: 20000, maximumAge: 30000,
        })
        await update(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy)

        // Watch for continuous updates
        if (!watchRef.current) {
          watchRef.current = await Geolocation.watchPosition(
            { enableHighAccuracy: true },
            async (p, err) => {
              if (err) { console.warn('Watch error:', err); return }
              if (p) await update(p.coords.latitude, p.coords.longitude, p.coords.accuracy)
            }
          )
        }
      } catch (e) {
        console.warn('MapPage GPS error:', e)
        // Fallback: browser geolocation (web/desktop)
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (pos) => update(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy),
            null,
            { enableHighAccuracy: true, timeout: 15000 }
          )
        }
      }
    }

    startTracking()

    return () => {
      if (watchRef.current) {
        Geolocation.clearWatch({ id: watchRef.current })
        watchRef.current = null
      }
    }
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
