/**
 * agora.js
 *
 * Thin wrapper around agora-rtc-sdk-ng for 1:1 voice/video calls. Runs inside
 * the Capacitor Android WebView via the browser's native getUserMedia/
 * RTCPeerConnection — no native Agora Android SDK needed.
 */

import AgoraRTC from 'agora-rtc-sdk-ng'

let client = null
let localAudioTrack = null
let localVideoTrack = null
// Which way the camera currently points. Tracked here rather than read back
// from the track because MediaStreamTrack settings don't reliably report
// facingMode in the Android WebView.
let currentFacing = 'user'
// Camera list, resolved once and reused. Enumerating on every flip put a full
// SDK round-trip in front of the camera open, which is the part the user
// actually waits on. The set of cameras cannot change mid-call on a phone.
let cameraListPromise = null
// Guards against a second tap landing while a switch is still in flight —
// queued camera opens make the flip feel far slower than it is.
let switching = false

function loadCameras(force = false) {
  if (force || !cameraListPromise) {
    cameraListPromise = AgoraRTC.getCameras().catch((e) => {
      console.warn('[agora] getCameras failed:', e)
      cameraListPromise = null   // don't cache a failure
      return []
    })
  }
  return cameraListPromise
}

export function getClient() {
  if (!client) {
    client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
  }
  return client
}

/**
 * Opens the FRONT camera for a call.
 *
 * createCameraVideoTrack() with no config lets the SDK take whatever
 * enumerateDevices() lists first. Chromium's Android WebView enumerates every
 * rear sensor a multi-camera phone exposes — wide, ultra-wide, macro, depth —
 * and the auxiliary ones deliver no usable frames, so the call opened to a
 * completely black picture with no way to change camera. Devices that happen
 * to list the front camera first were unaffected, which is why this looked
 * device-specific rather than like a missing constraint.
 *
 * A video call between family members always wants the selfie camera, so ask
 * for it explicitly instead of relying on enumeration order.
 */
async function createFrontCameraTrack() {
  // Preferred path — let the browser resolve "front" itself. This also
  // triggers the camera permission prompt, which is what populates device
  // labels for the fallback below.
  try {
    const t = await AgoraRTC.createCameraVideoTrack({ facingMode: 'user' })
    currentFacing = 'user'
    // Warm the camera list now, while the call is still connecting and nobody
    // is waiting on it. Permission is granted by this point, so labels are
    // populated. Deliberately not awaited.
    loadCameras(true)
    return t
  } catch (e) {
    console.warn('[agora] facingMode:user failed, falling back to device list:', e)
  }

  // Fallback — pick by label. Android WebView labels cameras
  // "camera2 1, facing front" / "camera2 0, facing back", so this is reliable
  // here even though labels are free-form in general.
  try {
    const cams = await AgoraRTC.getCameras()
    const front = cams.find(c => /front|user/i.test(c.label || ''))
    if (front) {
      return await AgoraRTC.createCameraVideoTrack({ cameraId: front.deviceId })
    }
  } catch (e) {
    console.warn('[agora] camera enumeration failed:', e)
  }

  // Last resort — the original unconstrained behaviour. Worse than the two
  // paths above, but a call with a bad camera beats a call with no video.
  return AgoraRTC.createCameraVideoTrack()
}

/**
 * Joins the channel, publishes local mic (+ camera for video calls).
 * `onRemoteUser(remoteUser, mediaType)` fires once the other participant's
 * track is subscribed — caller renders/plays it from there.
 */
export async function joinChannel({ appId, token, channelName, uid, callType, onRemoteUser, onRemoteLeft }) {
  const c = getClient()

  c.on('user-published', async (remoteUser, mediaType) => {
    await c.subscribe(remoteUser, mediaType)
    onRemoteUser?.(remoteUser, mediaType)
  })
  c.on('user-left', (remoteUser) => {
    onRemoteLeft?.(remoteUser)
  })

  await c.join(appId, channelName, token || null, uid || null)

  localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack()
  const tracksToPublish = [localAudioTrack]

  if (callType === 'video') {
    localVideoTrack = await createFrontCameraTrack()
    tracksToPublish.push(localVideoTrack)
  }

  await c.publish(tracksToPublish)

  return { localAudioTrack, localVideoTrack }
}

export function setMuted(muted) {
  if (localAudioTrack) localAudioTrack.setEnabled(!muted)
}

export function setCameraOff(off) {
  if (localVideoTrack) localVideoTrack.setEnabled(!off)
}

export function getCameraFacing() {
  return currentFacing
}

/**
 * Flips between the front and back camera during a call.
 *
 * Uses setDevice() on the live track so the switch happens in place — the
 * track stays published and the remote side sees a seamless change, with no
 * unpublish/republish round-trip.
 *
 * Multi-camera phones expose several "facing back" entries (wide, ultra-wide,
 * macro, depth) and the auxiliary ones deliver no usable frames. Chromium
 * enumerates them in camera-id order, so the FIRST back-facing device is the
 * main rear camera — taking any other match is how you end up with a black
 * picture. Same reasoning for the front.
 *
 * Returns the facing actually in effect, so the caller can reflect it in the
 * UI even when the switch was refused.
 */
export async function switchCamera() {
  if (!localVideoTrack || switching) return currentFacing

  const target = currentFacing === 'user' ? 'environment' : 'user'
  const match  = target === 'user' ? /front|user/i : /back|rear|environment/i
  const pick   = (cams) => cams.find(c => match.test(c.label || ''))

  switching = true
  try {
    // Normally already resolved — warmed when the track was created.
    let cams = await loadCameras()
    let cam  = pick(cams)

    // Labels are empty until camera permission is granted, so a list cached
    // from before the grant can be unusable. Re-enumerate once before failing.
    if (!cam) {
      cams = await loadCameras(true)
      cam  = pick(cams)
    }
    if (!cam) {
      console.warn(`[agora] no ${target}-facing camera in`, cams.map(c => c.label))
      return currentFacing
    }

    await localVideoTrack.setDevice(cam.deviceId)
    currentFacing = target
  } catch (e) {
    console.warn('[agora] switchCamera failed:', e)
  } finally {
    switching = false
  }
  return currentFacing
}

export function getLocalVideoTrack() {
  return localVideoTrack
}

export async function leaveChannel() {
  try { localAudioTrack?.close() } catch (e) {}
  try { localVideoTrack?.close() } catch (e) {}
  localAudioTrack = null
  localVideoTrack = null
  // deviceIds are not stable across sessions — start the next call clean.
  cameraListPromise = null
  currentFacing = 'user'
  switching = false
  if (client) {
    try { client.removeAllListeners() } catch (e) {}
    try { await client.leave() } catch (e) {}
  }
}
