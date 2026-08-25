export function startBatteryReporting(onUpdate) {
  if (typeof navigator === 'undefined') return () => {}
  let battery = null
  let interval = null
  const report = () => {
    if (!battery) return
    onUpdate({ level: Math.round(battery.level * 100), charging: battery.charging })
  }
  navigator.getBattery?.().then(b => {
    battery = b; report()
    b.addEventListener('levelchange', report)
    b.addEventListener('chargingchange', report)
    interval = setInterval(report, 60000)
  }).catch(() => {})
  return () => {
    if (battery) { battery.removeEventListener('levelchange', report); battery.removeEventListener('chargingchange', report) }
    if (interval) clearInterval(interval)
  }
}
