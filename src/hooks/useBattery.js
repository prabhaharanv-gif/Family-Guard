export function startBatteryReporting(onUpdate) {
  if (typeof navigator === 'undefined') return () => {}
  let battery = null
  let interval = null
  let cancelled = false
  const report = () => {
    if (!battery || cancelled) return
    onUpdate({ level: Math.round(battery.level * 100), charging: battery.charging })
  }
  navigator.getBattery?.().then(b => {
    // getBattery() is async. If teardown lands before it resolves, the cleanup
    // below sees battery/interval still null and clears nothing — then this
    // callback attaches the listeners and the 60s interval anyway, with nothing
    // left holding a handle to them. That orphaned reporter kept calling
    // onUpdate for a family the user had already left, once per mount, forever.
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
