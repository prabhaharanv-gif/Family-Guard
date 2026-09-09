import { registerPlugin, Capacitor } from '@capacitor/core'

const LocationService = registerPlugin('LocationService')

/**
 * Reports battery level and charging state to onUpdate.
 *
 * On Android the reading comes from BatteryManager through the native plugin.
 * navigator.getBattery() is used only on the web, because Chromium has
 * deprecated the Battery Status API and reports it unreliably inside a
 * WebView — the charging flag can stay stuck at whatever it was when the page
 * loaded, which kept a phone showing as charging after it had been unplugged.
 *
 * Returns a stop() that is safe to call at any point, including before the
 * first reading has arrived.
 */
export function startBatteryReporting(onUpdate) {
  let cancelled = false
  let interval = null

  if (Capacitor.isNativePlatform()) {
    const read = async () => {
      try {
        const b = await LocationService.getBatteryStatus()
        if (cancelled) return
        onUpdate({ level: b?.level ?? null, charging: !!b?.charging })
      } catch { /* best effort — never break location writes over battery */ }
    }
    read()
    // 20s, matching the location write cadence, so an unplug shows up on the
    // next write rather than up to a minute later.
    interval = setInterval(read, 20000)
    return () => { cancelled = true; if (interval) clearInterval(interval) }
  }

  // ── Web fallback ────────────────────────────────────────────────────────
  if (typeof navigator === 'undefined') return () => {}
  let battery = null
  const report = () => {
    if (!battery || cancelled) return
    onUpdate({ level: Math.round(battery.level * 100), charging: battery.charging })
  }
  navigator.getBattery?.().then(b => {
    // getBattery() is async. If teardown lands before it resolves, the cleanup
    // below sees battery/interval still null and clears nothing — then this
    // callback attaches the listeners and the interval anyway, with nothing
    // left holding a handle to them.
    if (cancelled) return
    battery = b; report()
    b.addEventListener('levelchange', report)
    b.addEventListener('chargingchange', report)
    interval = setInterval(report, 60000)
  }).catch(() => {})
  return () => {
    cancelled = true
    if (battery) { battery.removeEventListener('levelchange', report); battery.removeEventListener('chargingchange', report) }
    if (interval) clearInterval(interval)
  }
}
