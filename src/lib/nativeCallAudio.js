/**
 * nativeCallAudio.js
 *
 * Capacitor bridge to the native CallAudio plugin — routes call audio through
 * the earpiece (voice) or speaker (video) and engages the device's proper
 * in-call audio path (echo cancellation/gain), which the WebView's WebRTC
 * stack doesn't do on its own.
 */

import { registerPlugin, Capacitor } from '@capacitor/core'

const CallAudio = registerPlugin('CallAudio')

export async function startNativeCallAudio(speakerOn) {
  if (!Capacitor.isNativePlatform()) return
  try { await CallAudio.start({ speakerOn: !!speakerOn }) } catch (e) {
    console.warn('[nativeCallAudio] start failed:', e)
  }
}

export async function setNativeSpeakerOn(speakerOn) {
  if (!Capacitor.isNativePlatform()) return
  try { await CallAudio.setSpeakerOn({ speakerOn: !!speakerOn }) } catch (e) {
    console.warn('[nativeCallAudio] setSpeakerOn failed:', e)
  }
}

export async function stopNativeCallAudio() {
  if (!Capacitor.isNativePlatform()) return
  try { await CallAudio.stop() } catch (e) {
    console.warn('[nativeCallAudio] stop failed:', e)
  }
}
