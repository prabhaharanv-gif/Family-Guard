/**
 * sosAudio.js
 *
 * Web Audio API alarm engine for in-app SOS alerts.
 * Extracted from App.jsx — no React dependency, pure JS module.
 *
 * Usage:
 *   import { playSOSAlarm, stopSOSAlarm } from '../lib/sosAudio'
 */

let sosAlarmInterval = null
let sosAudioCtx = null

export function playSOSAlarm() {
  stopSOSAlarm()

  try {
    sosAudioCtx = new (window.AudioContext || window.webkitAudioContext)()

    const playOneCycle = () => {
      if (!sosAudioCtx) return
      const beepAt = (t, freq, dur) => {
        try {
          const osc  = sosAudioCtx.createOscillator()
          const gain = sosAudioCtx.createGain()
          osc.connect(gain)
          gain.connect(sosAudioCtx.destination)
          osc.frequency.value = freq
          osc.type = 'square'
          gain.gain.setValueAtTime(0.4, sosAudioCtx.currentTime + t)
          gain.gain.exponentialRampToValueAtTime(0.001, sosAudioCtx.currentTime + t + dur)
          osc.start(sosAudioCtx.currentTime + t)
          osc.stop(sosAudioCtx.currentTime + t + dur)
        } catch (e) {}
      }
      // Two-tone urgent pattern: 880 Hz + 660 Hz
      const pattern = [0, 0.25, 0.5, 0.75, 1.0]
      pattern.forEach(t => beepAt(t, 880, 0.2))
      pattern.forEach(t => beepAt(t + 0.12, 660, 0.12))
    }

    playOneCycle()
    sosAlarmInterval = setInterval(playOneCycle, 1500)

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('🆘 SOS Alert!', { body: 'A family member needs help NOW!' })
    }
  } catch (e) {
    console.warn('[sosAudio] Alarm error:', e)
  }
}

export function stopSOSAlarm() {
  if (sosAlarmInterval) {
    clearInterval(sosAlarmInterval)
    sosAlarmInterval = null
  }
  if (sosAudioCtx) {
    try { sosAudioCtx.close() } catch (e) {}
    sosAudioCtx = null
  }
}
