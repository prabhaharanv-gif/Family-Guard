import { useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Geolocation } from '@capacitor/geolocation'
import { useAuthStore } from '../store/authStore'
import { useLocations } from '../hooks/useLocations'
import { supabase } from '../lib/supabase'
import { startBatteryReporting } from '../hooks/useBattery'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

function createIcon(color, initial, avatarUrl) {
  const content = avatarUrl
    ? `<img src="${avatarUrl}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:3px solid #fff;box-shadow:0 2px 12px rgba(0,0,0,0.25);" />`
    : `<div style="
        width:44px;height:44px;border-radius:50%;
        background:${color};border:3px solid #fff;
        display:flex;align-items:center;justify-content:center;
        font-weight:800;font-size:18px;color:#fff;
        box-shadow:0 2px 12px rgba(0,0,0,0.25);
        font-family:Inter,sans-serif;
      ">${initial}</div>`
  return L.divIcon({
    className: '',
    html: content,
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
  const watchRef   = useRef(null)
  const batteryRef = useRef({ level: null, charging: false })

  useEffect(() => {
    const stop = startBatteryReporting(b => { batteryRef.current = b })
    return stop
  }, [])
  const [refreshing, setRefreshing] = useState(false)
  // null   = not yet tried (no banner)
  // 'perm' = permission denied
  // 'fail' = GPS failed AND no locations in DB yet (only show if map is empty)
  const [locErrorType, setLocErrorType] = useState(null)

  const updateLocation = async (lat, lng, accuracy, speed) => {
    const { data: memberPref } = await supabase.from('family_members').select('show_location')
      .eq('user_id', user.id).eq('family_id', familyId).single()
    const sharingOn = !(memberPref && memberPref.show_location === false)

    if (!sharingOn) {
      await supabase.from('locations').upsert({
        user_id: user.id, family_id: familyId,
        is_sharing: false, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,family_id' })
      return
    }

    await supabase.rpc('upsert_location_with_battery', {
      p_family_id:   familyId,
      p_lat:         lat,
      p_lng:         lng,
      p_accuracy:    accuracy || 0,
      p_speed:       speed ?? null,
      p_battery:     batteryRef.current.level ?? null,
      p_is_charging: batteryRef.current.charging ?? false,
    })
  }

  const getPositionRobust = async () => {
    // Attempt 1: high accuracy native GPS
    try {
      return await Geolocation.getCurrentPosition({
        enableHighAccuracy: true, timeout: 20000, maximumAge: 30000,
      })
    } catch (e1) {
      console.warn('[Map] High-accuracy fix failed:', e1?.message)
    }
    // Attempt 2: low accuracy, accept up to 5-min cached fix
    // (covers battery-optimised devices that throttle GPS cold start)
    try {
      return await Geolocation.getCurrentPosition({
        enableHighAccuracy: false, timeout: 25000, maximumAge: 300000,
      })
    } catch (e2) {
      console.warn('[Map] Low-accuracy fix failed:', e2?.message)
    }
    // Attempt 3: browser geolocation (fallback for web/desktop)
    return await new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('Geolocation unavailable')); return }
      navigator.geolocation.getCurrentPosition(
        resolve,
        reject,
        { enableHighAccuracy: false, timeout: 25000, maximumAge: 300000 }
      )
    })
  }

  const startTracking = async () => {
    setLocErrorType(null)
    try {
      const perm = await Geolocation.requestPermissions()
      if (perm.location !== 'granted') {
        setLocErrorType('perm')
        return
      }

      const pos = await getPositionRobust()
      // Got a fix — clear any previous error
      setLocErrorType(null)
      await updateLocation(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.speed)

      // Start watching for continuous updates
      if (!watchRef.current) {
        watchRef.current = await Geolocation.watchPosition(
          { enableHighAccuracy: true },
          async (p, err) => {
            if (err) { console.warn('[Map] Watch error:', err); return }
            if (p) {
              setLocErrorType(null) // clear error once watch delivers a fix
              await updateLocation(p.coords.latitude, p.coords.longitude, p.coords.accuracy, p.coords.speed)
            }
          }
        )
      }
    } catch (e) {
      console.warn('[Map] GPS failed:', e?.message)
      // Only show the error banner if the map itself is also empty.
      // If other members' locations ARE visible, GPS failing for our own
      // position update is a background issue — the map is still useful.
      setLocErrorType('fail')
    }
  }

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      await startTracking()
    } finally {
      setTimeout(() => setRefreshing(false), 600)
    }
  }

  useEffect(() => {
    if (!user || !familyId) return
    startTracking()

    // ── Background location timeout ───────────────────────────────────────
    // Stop silently updating location if the app has been idle/backgrounded
    // for more than 2 hours. Protects user privacy and battery.
    // The watch restarts next time the user actively opens the Map tab.
    const IDLE_TIMEOUT = 2 * 60 * 60 * 1000 // 2 hours
    const idleTimer = setTimeout(() => {
      if (watchRef.current) {
        Geolocation.clearWatch({ id: watchRef.current })
        watchRef.current = null
        console.log('[Map] Location watch stopped after 2h idle')
      }
    }, IDLE_TIMEOUT)

    return () => {
      clearTimeout(idleTimer)
      if (watchRef.current) { Geolocation.clearWatch({ id: watchRef.current }); watchRef.current = null }
    }
  }, [user, familyId])

  const memberCount = Object.keys(locations).length

  // Only show the GPS error banner when the map is empty AND we have an error.
  // If locations are already visible, the GPS error is a background update
  // failure — showing a red banner while the map works perfectly is misleading.
  const showPermError = locErrorType === 'perm'
  const showGpsError  = locErrorType === 'fail' && memberCount === 0

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Top Bar */}
      <div className="top-bar" style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <div className="top-bar-title">🗺️ Family Map</div>
          <div className="top-bar-sub">{memberCount} member{memberCount !== 1 ? 's' : ''} sharing location</div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh map"
          style={{
            background: 'rgba(255,255,255,0.92)',
            border: '1.5px solid #fff',
            color: '#951345', borderRadius: 10,
            padding: '8px 14px', fontWeight: 800, fontSize: 13,
            fontFamily: 'inherit', cursor: refreshing ? 'wait' : 'pointer',
            whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span style={{
            display: 'inline-block',
            animation: refreshing ? 'famguard-spin 0.7s linear infinite' : 'none',
          }}>🔄</span>
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>

      <style>{`@keyframes famguard-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>

      {/* Permission denied — always show (user must fix it) */}
      {showPermError && (
        <div style={{
          background: '#FEF2F2', color: '#B91C1C',
          borderBottom: '1px solid #FCA5A5',
          padding: '9px 16px', fontSize: 12.5, fontWeight: 600,
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          ⚠️ Location permission is required. Allow it in Android Settings → Apps → FamilyGuard → Permissions.
        </div>
      )}

      {/* GPS fail — only show when map is empty so it's not shown over a working map */}
      {showGpsError && (
        <div style={{
          background: '#FEF2F2', color: '#B91C1C',
          borderBottom: '1px solid #FCA5A5',
          padding: '9px 16px', fontSize: 12.5, fontWeight: 600,
          flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          ⚠️ Couldn't get location — check GPS is on and tap Refresh.
        </div>
      )}

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
              icon={createIcon(
                loc.avatarColor || '#951345',
                loc.displayName?.[0]?.toUpperCase() || '?',
                loc.avatarUrl || null
              )}
            >
              <Popup>
                <div style={{ minWidth: 160, fontFamily: 'Inter, sans-serif', padding: '2px 0' }}>
                  {/* Avatar + name row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    {loc.avatarUrl ? (
                      <img src={loc.avatarUrl} alt={loc.displayName} style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', border: '2px solid #951345' }} />
                    ) : (
                      <div style={{
                        width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                        background: loc.avatarColor || '#951345',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: '#fff', fontWeight: 800, fontSize: 15, border: '2px solid #951345',
                      }}>
                        {loc.displayName?.[0]?.toUpperCase()}
                      </div>
                    )}
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 14, color: '#0D0C1D' }}>{loc.displayName}</div>
                      <div style={{ fontSize: 11, color: '#9C6B7A', marginTop: 1 }}>
                        🕐 {new Date(loc.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </div>
                    </div>
                  </div>
                  {/* Google Maps button */}
                  <a
                    href={`https://www.google.com/maps?q=${loc.lat},${loc.lng}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      background: 'linear-gradient(135deg, #951345, #720D35)',
                      color: '#fff', padding: '8px 14px', borderRadius: 10,
                      fontWeight: 700, fontSize: 12, textDecoration: 'none',
                      boxShadow: '0 3px 10px rgba(149,19,69,0.3)',
                    }}
                  >
                    🗺️ Open in Google Maps
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
